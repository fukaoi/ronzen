"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import uuid
import json
import asyncio

from . import storage
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings, build_user_content

app = FastAPI(title="LLM Council API")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str = ""
    images: List[str] = []


class UploadImagesRequest(BaseModel):
    """Request to upload images as base64 data URLs."""
    images: List[str]


class UploadedImage(BaseModel):
    """An image that has been stored on the server."""
    filename: str
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


def build_history_messages(conversation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Build the prior turns of a conversation as OpenRouter messages.

    User turns keep their attached images; assistant turns are represented by
    the chairman's final answer, which is what the user actually replied to.
    """
    history: List[Dict[str, Any]] = []

    for message in conversation.get("messages", []):
        if message.get("role") == "user":
            images = resolve_images(message.get("images", []))
            history.append({
                "role": "user",
                "content": build_user_content(message.get("content", ""), images)
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
    """Reject a message that has neither text nor images."""
    if not request.content.strip() and not request.images:
        raise HTTPException(
            status_code=400,
            detail="A message must have text or at least one image"
        )


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.post("/api/uploads", response_model=List[UploadedImage])
async def upload_images(request: UploadImagesRequest):
    """Store base64 data URL images and return the URLs to reference them by."""
    uploaded = []
    for data_url in request.images:
        try:
            saved = storage.save_image_from_data_url(data_url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        uploaded.append({
            "filename": saved["filename"],
            "url": f"/api/uploads/{saved['filename']}"
        })

    return uploaded


@app.get("/api/uploads/{filename}")
async def get_upload(filename: str):
    """Serve an uploaded image."""
    path = storage.get_upload_path(filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


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


@app.post("/api/conversations/{conversation_id}/message")
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

    # Add user message
    storage.add_user_message(conversation_id, request.content, request.images)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        images,
        history
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


@app.post("/api/conversations/{conversation_id}/message/stream")
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

    async def event_generator():
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content, request.images)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content, images, history)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results, images, history)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results, images, history)
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
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
