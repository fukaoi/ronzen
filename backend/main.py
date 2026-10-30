"""FastAPI backend for LLM Council."""

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Deque
from collections import defaultdict, deque
from pathlib import Path
import os
import time
import uuid
import json
import asyncio

from . import storage, missions
from .config import (
    HOST,
    PORT,
    EXTRA_ALLOWED_ORIGINS,
    RATE_LIMIT_PER_MINUTE,
    MAX_TEXT_BYTES_PER_MESSAGE,
    CONTEXT_WARNING_CHARS,
)
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings, build_user_content

app = FastAPI(title="LLM Council API")

# CORS.
#
# Any loopback origin is allowed for local development, because Vite falls back
# to another port (5174, 5175, ...) whenever 5173 is already taken, and a
# hard-coded list would turn that into an opaque preflight failure.
#
# In production the built frontend is served from this same app (see the mount
# at the bottom of this file), so the browser never makes a cross-origin
# request and nothing extra is needed. ALLOWED_ORIGINS only matters if the
# frontend is hosted somewhere else.
app.add_middleware(
    CORSMiddleware,
    allow_origins=EXTRA_ALLOWED_ORIGINS,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|\[::1\]):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Recent council runs per client, for the rate limit below
_recent_runs: Dict[str, Deque[float]] = defaultdict(deque)

class CouncilRun:
    """
    A council run that outlives the request that started it.

    The run owns the work and the saving; a request only watches it. That is
    what makes a reload survivable: closing the page drops the viewer, not the
    deliberation, and the answer is still written when it finishes.
    """

    def __init__(self, conversation_id: str):
        self.conversation_id = conversation_id
        self.events: List[Dict[str, Any]] = []
        self.done = False
        self.task: Optional[asyncio.Task] = None
        # Replaced on every emit, so a watcher that captured the previous one
        # is woken even if the event lands while it is between checks
        self._next = asyncio.Event()

    def emit(self, event: Dict[str, Any]):
        self.events.append(event)
        waiting, self._next = self._next, asyncio.Event()
        waiting.set()

    def finish(self):
        self.done = True
        waiting, self._next = self._next, asyncio.Event()
        waiting.set()

    async def watch(self):
        """Yield every event from the beginning, then follow until it ends."""
        cursor = 0
        while True:
            waiting = self._next
            while cursor < len(self.events):
                yield self.events[cursor]
                cursor += 1
            if self.done:
                return
            await waiting.wait()


# Council runs in flight, by conversation. Also the edit guard: saving an
# answer is a read-modify-write of the conversation file, so editing the last
# turn meanwhile would be silently overwritten when the run finishes.
_active_runs: Dict[str, CouncilRun] = {}


def sse(event: Dict[str, Any]) -> str:
    """Format one event for the wire."""
    return f"data: {json.dumps(event)}\n\n"


def sse_response(generator) -> StreamingResponse:
    """A Server-Sent Events response with the headers proxies need."""
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Tell intermediate proxies (cloudflared, nginx) to pass each
            # stage through as it is produced instead of buffering the stream
            "X-Accel-Buffering": "no",
        },
    )


def enforce_rate_limit(request: Request):
    """
    Throttle council runs.

    Every run fans out to each council model twice plus the chairman, so an
    unattended client in a retry loop burns through OpenRouter credits fast.
    Access puts an authenticated identity in front of this, so prefer that as
    the key and fall back to the peer address.
    """
    if RATE_LIMIT_PER_MINUTE <= 0:
        return

    client = (
        request.headers.get("cf-access-authenticated-user-email")
        or (request.client.host if request.client else "unknown")
    )

    now = time.monotonic()
    runs = _recent_runs[client]
    while runs and now - runs[0] > 60:
        runs.popleft()

    if len(runs) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit reached ({RATE_LIMIT_PER_MINUTE} messages per "
                "minute). Please wait a moment."
            ),
        )

    runs.append(now)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str = ""
    images: List[str] = []
    files: List[str] = []


class UploadItem(BaseModel):
    """One file being uploaded, as a base64 data URL."""
    data_url: str
    name: str = ""


class UploadRequest(BaseModel):
    """Request to upload one or more attachments."""
    files: List[UploadItem]


class UploadedFile(BaseModel):
    """An attachment that has been stored on the server."""
    filename: str
    name: str
    kind: str
    size: int
    url: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int
    running: bool = False


class RenameConversationRequest(BaseModel):
    """Request to give a conversation a new title."""
    title: str


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]
    running: bool = False
    # Characters of history the next question will carry, and whether that is
    # now large enough to be worth starting fresh
    context_chars: int = 0
    context_heavy: bool = False


class HandoffResult(BaseModel):
    """A fresh conversation, plus the summary to open it with."""
    conversation: Conversation
    attachment: UploadedFile


def resolve_images(filenames: List[str]) -> List[str]:
    """
    Turn stored image filenames into data URLs for the LLM request.

    Missing files are skipped so a lost upload never breaks the conversation.
    """
    resolved = []
    for filename in filenames:
        data_url = storage.read_image_as_data_url(filename)
        if data_url:
            resolved.append(data_url)
    return resolved


def resolve_files(filenames: List[str]) -> List[Dict[str, str]]:
    """
    Read stored text attachments back for inlining into the prompt.

    Missing or no longer readable files are skipped, so a lost upload never
    breaks the conversation. The combined size is capped: each attachment is
    sent to every council model twice plus the chairman.
    """
    resolved: List[Dict[str, str]] = []
    total = 0

    for filename in filenames:
        content = storage.read_text_file(filename)
        if content is None:
            continue

        total += len(content.encode('utf-8'))
        if total > MAX_TEXT_BYTES_PER_MESSAGE:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Attached files are too large in total "
                    f"(limit is {MAX_TEXT_BYTES_PER_MESSAGE} bytes)"
                ),
            )

        resolved.append({
            "name": storage.display_name(filename),
            "content": content,
        })

    return resolved


def attachment_title(files: List[Dict[str, str]]) -> str:
    """Name a conversation after its first attachment, when there is no text."""
    return files[0]["name"] if files else ""


def message_attachments(message: Dict[str, Any]) -> List[str]:
    """Stored filenames of the text attachments on a saved user message."""
    return [
        entry["filename"]
        for entry in message.get("files", [])
        if isinstance(entry, dict) and entry.get("filename")
    ]


def build_history_messages(conversation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Build the prior turns of a conversation as OpenRouter messages.

    User turns keep what was attached to them; assistant turns are represented
    by the chairman's final answer, which is what the user actually replied to.
    """
    history: List[Dict[str, Any]] = []

    for message in conversation.get("messages", []):
        if message.get("role") == "user":
            images = resolve_images(message.get("images", []))
            files = resolve_files(message_attachments(message))
            history.append({
                "role": "user",
                "content": build_user_content(
                    message.get("content", ""), images, files
                )
            })
        elif message.get("role") == "assistant":
            final_response = (message.get("stage3") or {}).get("response")
            if final_response:
                history.append({
                    "role": "assistant",
                    "content": final_response
                })

    return history


def conversation_context_size(conversation: Dict[str, Any]) -> int:
    """
    Characters of history the next question in this conversation will carry.

    Counts exactly what build_history_messages sends: the questions with their
    text attachments inlined, and the chairman's answers. Images are left out,
    since their cost does not track their length.
    """
    total = 0

    for message in conversation.get("messages", []):
        if message.get("role") == "user":
            total += len(message.get("content", ""))
            for filename in message_attachments(message):
                content = storage.read_text_file(filename)
                if content:
                    total += len(content)
        else:
            total += len((message.get("stage3") or {}).get("response", ""))

    return total


def with_context_size(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """Annotate a conversation with how much history it now carries."""
    size = conversation_context_size(conversation)
    return {
        **conversation,
        "context_chars": size,
        "context_heavy": size >= CONTEXT_WARNING_CHARS,
    }


def build_handoff_summary(conversation: Dict[str, Any]) -> Optional[str]:
    """
    The part of a conversation worth carrying into a fresh one.

    The last question and the council's answer to it: enough to pick the
    thread back up, without dragging the whole history along at seven times
    its size.
    """
    messages = conversation.get("messages", [])

    answer_at = next(
        (
            index
            for index in range(len(messages) - 1, -1, -1)
            if messages[index].get("role") == "assistant"
            and (messages[index].get("stage3") or {}).get("response")
        ),
        None,
    )
    if answer_at is None:
        return None

    question = next(
        (
            messages[index].get("content", "")
            for index in range(answer_at - 1, -1, -1)
            if messages[index].get("role") == "user"
        ),
        "",
    )
    answer = messages[answer_at]["stage3"]["response"]
    title = conversation.get("title", "an earlier conversation")

    return (
        f"# Carried over from: {title}\n\n"
        f"## The question that was asked\n\n{question}\n\n"
        f"## What the council concluded\n\n{answer}\n"
    )


def validate_message_request(request: SendMessageRequest):
    """Reject a message that has neither text nor attachments."""
    if not request.content.strip() and not request.images and not request.files:
        raise HTTPException(
            status_code=400,
            detail="A message must have text or at least one attachment"
        )


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.post("/api/uploads", response_model=List[UploadedFile])
async def upload_files(request: UploadRequest):
    """
    Store attachments and return the handles to reference them by.

    Images are kept as images; anything else has to be readable as UTF-8 text,
    because text attachments reach the models inlined in the prompt.
    """
    uploaded = []
    for item in request.files:
        try:
            saved = storage.save_upload_from_data_url(item.data_url, item.name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        uploaded.append({
            "filename": saved["filename"],
            "name": saved["name"],
            "kind": saved["kind"],
            "size": saved["size"],
            "url": f"/api/uploads/{saved['filename']}",
        })

    return uploaded


@app.get("/api/uploads/{filename}")
async def get_upload(filename: str):
    """
    Serve an uploaded attachment.

    Images render inline; everything else is sent as a download, so an
    uploaded .html or .svg can never run as a page on this origin.
    """
    path = storage.get_upload_path(filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Attachment not found")

    extension = os.path.splitext(path)[1].lower()
    if extension in storage.EXTENSION_TO_MIME:
        return FileResponse(path)

    return FileResponse(
        path,
        media_type="text/plain; charset=utf-8",
        filename=storage.display_name(filename),
        content_disposition_type="attachment",
    )


@app.delete(
    "/api/conversations/{conversation_id}/messages/last",
    response_model=Conversation,
)
async def delete_last_turn(conversation_id: str, keep_attachments: bool = False):
    """
    Remove the last question and the answer that followed it.

    Both buttons land here. Editing is the same removal, only with the
    uploads left in place so the composer can offer them again: the council
    has to run from scratch either way, so there is nothing to keep.
    """
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation_id in _active_runs:
        raise HTTPException(
            status_code=409,
            detail="This conversation is still being answered. Wait for it to finish.",
        )

    removed = storage.remove_last_turn(conversation_id, keep_attachments)
    if removed is None:
        raise HTTPException(status_code=400, detail="There is no message to remove")

    return with_context_size(storage.get_conversation(conversation_id))


@app.post(
    "/api/conversations/{conversation_id}/handoff",
    response_model=HandoffResult,
)
async def hand_off_conversation(conversation_id: str):
    """
    Start a fresh conversation carrying this one's conclusion.

    The new conversation opens with the last question and answer attached as
    a file, so the thread continues from a summary instead of replaying the
    whole history to every council member on every question.
    """
    source = storage.get_conversation(conversation_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    summary = build_handoff_summary(source)
    if summary is None:
        raise HTTPException(
            status_code=400,
            detail="This conversation has no answer yet to carry over",
        )

    new_conversation = storage.create_conversation(str(uuid.uuid4()))
    saved = storage.save_text_attachment(summary, "carried-over-context.md")

    return {
        "conversation": with_context_size(new_conversation),
        "attachment": {
            "filename": saved["filename"],
            "name": saved["name"],
            "kind": saved["kind"],
            "size": saved["size"],
            "url": f"/api/uploads/{saved['filename']}",
        },
    }


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return [
        {**conversation, "running": conversation["id"] in _active_runs}
        for conversation in storage.list_conversations()
    ]


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.patch("/api/conversations/{conversation_id}")
async def rename_conversation(conversation_id: str, request: RenameConversationRequest):
    """Change a conversation's title."""
    title = " ".join(request.title.split())
    if not title:
        raise HTTPException(status_code=400, detail="Title must not be empty")
    if storage.get_conversation(conversation_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    storage.update_conversation_title(conversation_id, title[:100])
    return {"id": conversation_id, "title": title[:100]}


def with_stage2_metadata(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Rebuild the stage 2 metadata that storage does not keep.

    Labels are assigned in stage 1 order, so the mapping and the aggregate
    rankings follow from what is stored, for old conversations too.
    """
    messages = []
    for message in conversation["messages"]:
        if message.get("role") == "assistant" and message.get("stage1") and message.get("stage2"):
            label_to_model = {
                f"Response {chr(65 + i)}": result["model"]
                for i, result in enumerate(message["stage1"])
            }
            message = {
                **message,
                "metadata": {
                    "label_to_model": label_to_model,
                    "aggregate_rankings": calculate_aggregate_rankings(
                        message["stage2"], label_to_model
                    ),
                },
            }
        messages.append(message)
    return {**conversation, "messages": messages}


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {
        **with_context_size(with_stage2_metadata(conversation)),
        "running": conversation_id in _active_runs,
    }


@app.post(
    "/api/conversations/{conversation_id}/message",
    dependencies=[Depends(enforce_rate_limit)],
)
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    validate_message_request(request)

    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Capture the earlier turns before this message is appended
    history = build_history_messages(conversation)
    images = resolve_images(request.images)
    files = resolve_files(request.files)

    # Add user message
    storage.add_user_message(
        conversation_id, request.content, request.images, request.files
    )

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(
            request.content, attachment_title(files)
        )
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    _active_runs[conversation_id] = CouncilRun(conversation_id)
    try:
        stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
            request.content,
            images,
            history,
            files
        )

        # Add assistant message with all stages
        storage.add_assistant_message(
            conversation_id,
            stage1_results,
            stage2_results,
            stage3_result
        )
    finally:
        _active_runs.pop(conversation_id, None)

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post(
    "/api/conversations/{conversation_id}/message/stream",
    dependencies=[Depends(enforce_rate_limit)],
)
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    validate_message_request(request)

    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Capture the earlier turns before this message is appended
    history = build_history_messages(conversation)
    images = resolve_images(request.images)
    files = resolve_files(request.files)

    run = CouncilRun(conversation_id)
    _active_runs[conversation_id] = run

    async def deliberate():
        """
        Carry the run to the end and save it, with or without an audience.

        Nothing in here yields to the client: the request only watches `run`,
        so a reload, a dropped mobile connection or a closed tab cannot take
        the answer down with it.
        """
        try:
            storage.add_user_message(
                conversation_id, request.content, request.images, request.files
            )

            # Start title generation in parallel (don't await yet)
            title_task = None
            title_saver = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(
                        request.content, attachment_title(files)
                    )
                )

            if title_task:
                async def save_title():
                    # Saved as soon as it is ready, not after the council
                    # finishes, so a long or failed run still gets a title
                    title = await title_task
                    storage.update_conversation_title(conversation_id, title)
                    run.emit({'type': 'title_complete', 'data': {'title': title}})
                title_saver = asyncio.create_task(save_title())

            # Stage 1: Collect responses
            run.emit({'type': 'stage1_start'})
            stage1_results = await stage1_collect_responses(request.content, images, history, files)
            run.emit({'type': 'stage1_complete', 'data': stage1_results})

            # Stage 2: Collect rankings
            run.emit({'type': 'stage2_start'})
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results, images, history, files)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            run.emit({
                'type': 'stage2_complete',
                'data': stage2_results,
                'metadata': {
                    'label_to_model': label_to_model,
                    'aggregate_rankings': aggregate_rankings,
                },
            })

            # Stage 3: Synthesize final answer
            run.emit({'type': 'stage3_start'})
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results, images, history, files)
            run.emit({'type': 'stage3_complete', 'data': stage3_result})

            if title_saver:
                await title_saver

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result
            )

            # Released before the client is told, so that the conversation
            # list it reloads on 'complete' no longer reports this as running
            _active_runs.pop(conversation_id, None)
            run.emit({'type': 'complete'})

        except Exception as e:
            run.emit({'type': 'error', 'message': str(e)})

        finally:
            _active_runs.pop(conversation_id, None)
            run.finish()

    # Held so the garbage collector cannot take the run mid-deliberation
    run.task = asyncio.create_task(deliberate())

    async def watch():
        async for event in run.watch():
            yield sse(event)

    return sse_response(watch())


@app.get("/api/conversations/{conversation_id}/stream")
async def follow_council_run(conversation_id: str):
    """
    Attach to a council run that is already going.

    A reloaded page lands here and picks the deliberation back up from the
    start, rather than showing a question with no answer under it.
    """
    run = _active_runs.get(conversation_id)
    if run is None:
        raise HTTPException(
            status_code=404, detail="No council run is in progress here"
        )

    async def watch():
        async for event in run.watch():
            yield sse(event)

    return sse_response(watch())


# --- Missions -----------------------------------------------------------
#
# A mission is a goal pursued in a loop: the council defines a task, the coding
# agent (reached through the MCP server) does it and reports, the council
# judges the report and defines the next task, until it says DONE.


class CreateMissionRequest(BaseModel):
    """Request to start a mission."""
    goal: str
    criteria: str = ""
    max_iterations: int = 8


class MissionReportRequest(BaseModel):
    """What the coding agent (or the human, after a BLOCKED) reports."""
    report: str
    from_human: bool = False


def get_mission_or_404(mission_id: str) -> Dict[str, Any]:
    mission = missions.get_mission(mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail="Mission not found")
    return mission


async def run_mission_step(mission_id: str, prompt: str):
    """
    One council deliberation inside a mission, saved to its conversation.

    Mirrors the streaming route: the deliberation is registered as an active
    run, so the web UI can watch it live, and the answer is written to the
    conversation either way. The mission is then advanced by the verdict.
    """
    mission = missions.get_mission(mission_id)
    conversation_id = mission["conversation_id"]
    run = CouncilRun(conversation_id)
    _active_runs[conversation_id] = run

    try:
        conversation = storage.get_conversation(conversation_id)
        if conversation is None:
            raise ValueError("The mission's conversation no longer exists")
        # A failed earlier attempt left its question without an answer
        if conversation["messages"] and conversation["messages"][-1]["role"] == "user":
            storage.remove_last_turn(conversation_id)
            conversation = storage.get_conversation(conversation_id)
        history = build_history_messages(conversation)
        storage.add_user_message(conversation_id, prompt)

        run.emit({'type': 'stage1_start'})
        stage1_results = await stage1_collect_responses(prompt, [], history, [])
        if not stage1_results:
            raise ValueError("All council models failed to respond")
        run.emit({'type': 'stage1_complete', 'data': stage1_results})

        run.emit({'type': 'stage2_start'})
        stage2_results, label_to_model = await stage2_collect_rankings(
            prompt, stage1_results, [], history, []
        )
        aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
        run.emit({
            'type': 'stage2_complete',
            'data': stage2_results,
            'metadata': {
                'label_to_model': label_to_model,
                'aggregate_rankings': aggregate_rankings,
            },
        })

        run.emit({'type': 'stage3_start'})
        stage3_result = await stage3_synthesize_final(
            prompt, stage1_results, stage2_results, [], history, []
        )
        run.emit({'type': 'stage3_complete', 'data': stage3_result})

        storage.add_assistant_message(
            conversation_id, stage1_results, stage2_results, stage3_result
        )

        verdict, body = missions.parse_verdict(stage3_result.get("response", ""))
        mission = missions.get_mission(mission_id)
        iteration = len(mission["iterations"])
        if mission["status"] == "stopped":
            # Stopped while the council was thinking: keep the answer in the
            # conversation, but do not move the mission on
            pass
        elif verdict == "DONE":
            mission["status"] = "done"
            mission["summary"] = body
        elif verdict == "BLOCKED":
            mission["status"] = "blocked"
            mission["summary"] = body
        elif iteration >= mission["max_iterations"]:
            mission["status"] = "limit"
            mission["summary"] = body
        else:
            mission["iterations"].append({
                "n": iteration + 1,
                "task": body,
                "report": None,
                "notes": [],
            })
        mission["step"] = "ready"
        mission["error"] = None
        missions.save_mission(mission)

        _active_runs.pop(conversation_id, None)
        run.emit({'type': 'complete'})

    except Exception as e:
        mission = missions.get_mission(mission_id)
        mission["step"] = "error"
        mission["error"] = str(e)
        missions.save_mission(mission)
        run.emit({'type': 'error', 'message': str(e)})

    finally:
        _active_runs.pop(conversation_id, None)
        run.finish()


def start_mission_step(mission: Dict[str, Any], prompt: str):
    """Record the prompt (so an error can be retried) and deliberate."""
    mission["step"] = "running"
    mission["error"] = None
    mission["pending_prompt"] = prompt
    missions.save_mission(mission)
    run_task = asyncio.create_task(run_mission_step(mission["id"], prompt))
    # Held so the garbage collector cannot take the step mid-deliberation
    _mission_tasks.add(run_task)
    run_task.add_done_callback(_mission_tasks.discard)


_mission_tasks: set = set()


@app.on_event("startup")
async def recover_interrupted_missions():
    """A restart kills in-flight deliberations; let the user retry them."""
    for mission in missions.list_missions():
        if mission["step"] == "running":
            mission["step"] = "error"
            mission["error"] = "Interrupted by a server restart. Retry the step."
            missions.save_mission(mission)


@app.get("/api/missions")
async def list_missions():
    """All missions, newest first, without their full iteration history."""
    return [
        {
            "id": m["id"],
            "created_at": m["created_at"],
            "goal": m["goal"],
            "status": m["status"],
            "step": m["step"],
            "iteration": len(m["iterations"]),
            "max_iterations": m["max_iterations"],
            "conversation_id": m["conversation_id"],
        }
        for m in missions.list_missions()
    ]


@app.post("/api/missions", dependencies=[Depends(enforce_rate_limit)])
async def create_mission(request: CreateMissionRequest):
    """Start a mission: the council drafts the first task."""
    goal = request.goal.strip()
    if not goal:
        raise HTTPException(status_code=400, detail="The goal must not be empty")
    if len(goal) > missions.MAX_GOAL_CHARS or len(request.criteria) > missions.MAX_GOAL_CHARS:
        raise HTTPException(status_code=400, detail="The goal or criteria is too long")
    if not 1 <= request.max_iterations <= missions.MAX_ITERATIONS_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"max_iterations must be between 1 and {missions.MAX_ITERATIONS_LIMIT}",
        )

    conversation = storage.create_conversation(str(uuid.uuid4()))
    title = " ".join(goal.split())
    storage.update_conversation_title(
        conversation["id"], "Mission: " + (title if len(title) <= 40 else title[:37] + "...")
    )
    mission = missions.create_mission(
        goal, request.criteria.strip(), request.max_iterations, conversation["id"]
    )
    start_mission_step(
        mission,
        missions.build_plan_prompt(goal, request.criteria, request.max_iterations),
    )
    return missions.public_view(missions.get_mission(mission["id"]))


@app.get("/api/missions/{mission_id}")
async def get_mission(mission_id: str):
    """A mission with the task currently waiting for the agent, if any."""
    return missions.public_view(get_mission_or_404(mission_id))


@app.post(
    "/api/missions/{mission_id}/report",
    dependencies=[Depends(enforce_rate_limit)],
)
async def report_mission(mission_id: str, request: MissionReportRequest):
    """Hand the council a report; it judges it and defines what comes next."""
    mission = get_mission_or_404(mission_id)
    report = request.report.strip()
    if not report:
        raise HTTPException(status_code=400, detail="The report must not be empty")
    report = report[:missions.MAX_REPORT_CHARS]

    if mission["step"] == "running":
        raise HTTPException(status_code=409, detail="The council is still deliberating")

    if mission["status"] == "blocked":
        # A human answered the question the council was blocked on
        mission["status"] = "active"
        if mission["iterations"]:
            mission["iterations"][-1]["notes"].append(report)
    elif mission["status"] == "active":
        task = missions.current_task(mission)
        if task is None:
            raise HTTPException(
                status_code=409,
                detail="There is no task awaiting a report; poll the mission first",
            )
        task["report"] = report
    else:
        raise HTTPException(
            status_code=409, detail=f"The mission is {mission['status']}"
        )

    prompt = missions.build_next_prompt(
        len(mission["iterations"]),
        mission["max_iterations"],
        report,
        from_human=request.from_human,
    )
    start_mission_step(mission, prompt)
    return missions.public_view(missions.get_mission(mission_id))


@app.post("/api/missions/{mission_id}/retry", dependencies=[Depends(enforce_rate_limit)])
async def retry_mission_step(mission_id: str):
    """Run the council step again after an error."""
    mission = get_mission_or_404(mission_id)
    if mission["step"] != "error" or not mission["pending_prompt"]:
        raise HTTPException(status_code=409, detail="Nothing to retry")
    start_mission_step(mission, mission["pending_prompt"])
    return missions.public_view(missions.get_mission(mission_id))


@app.post("/api/missions/{mission_id}/stop")
async def stop_mission(mission_id: str):
    """Stop the loop. A deliberation already running still finishes."""
    mission = get_mission_or_404(mission_id)
    if mission["status"] in ("active", "blocked"):
        mission["status"] = "stopped"
        missions.save_mission(mission)
    return missions.public_view(mission)


# Serve the built frontend from this same app, when it has been built.
#
# One origin for the page and the API means one Cloudflare Tunnel hostname and
# one Access policy covering everything, and the Access session cookie is sent
# with every API call automatically. This mount must stay last: it claims "/",
# so every real route above it has to be registered first.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
