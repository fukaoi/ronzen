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

from . import storage
from .config import (
    HOST,
    PORT,
    EXTRA_ALLOWED_ORIGINS,
    RATE_LIMIT_PER_MINUTE,
    MAX_TEXT_BYTES_PER_MESSAGE,
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


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


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


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


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

    async def event_generator():
        try:
            # Add user message
            storage.add_user_message(
                conversation_id, request.content, request.images, request.files
            )

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(
                        request.content, attachment_title(files)
                    )
                )

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content, images, history, files)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results, images, history, files)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results, images, history, files)
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Tell intermediate proxies (cloudflared, nginx) to pass each
            # stage through as it is produced instead of buffering the stream
            "X-Accel-Buffering": "no",
        }
    )


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
