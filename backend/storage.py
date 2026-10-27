"""JSON-based storage for conversations."""

import base64
import json
import os
import re
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR, UPLOAD_DIR, MAX_IMAGE_BYTES

# Image types accepted for upload, mapped to the extension used on disk
ALLOWED_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# Reverse lookup used when reading an image back from disk
EXTENSION_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

DATA_URL_PATTERN = re.compile(
    r"data:(?P<mime>[\w./+-]+);base64,(?P<payload>.*)", re.DOTALL
)


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def create_conversation(conversation_id: str) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": []
    }

    # Save to file
    path = get_conversation_path(conversation_id)
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    with open(path, 'r') as f:
        return json.load(f)


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()

    path = get_conversation_path(conversation['id'])
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            path = os.path.join(DATA_DIR, filename)
            with open(path, 'r') as f:
                data = json.load(f)
                # Return metadata only
                conversations.append({
                    "id": data["id"],
                    "created_at": data["created_at"],
                    "title": data.get("title", "New Conversation"),
                    "message_count": len(data["messages"])
                })

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(
    conversation_id: str,
    content: str,
    images: Optional[List[str]] = None
):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
        images: Filenames of previously uploaded images attached to the message
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "content": content,
        "images": images or []
    })

    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any]
):
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3
    })

    save_conversation(conversation)


def update_conversation_title(conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)


# --- Image uploads ---


def ensure_upload_dir():
    """Ensure the upload directory exists."""
    Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)


def get_upload_path(filename: str) -> str:
    """Get the file path for an uploaded image (basename only, no traversal)."""
    return os.path.join(UPLOAD_DIR, os.path.basename(filename))


def save_image_from_data_url(data_url: str) -> Dict[str, Any]:
    """
    Decode a base64 data URL and store it as an image file.

    Args:
        data_url: A "data:image/...;base64,..." URL

    Returns:
        Dict with 'filename', 'mime_type' and 'size'

    Raises:
        ValueError: If the data URL is malformed or the type/size is not allowed
    """
    match = DATA_URL_PATTERN.fullmatch(data_url.strip())
    if match is None:
        raise ValueError("Expected a base64 data URL (data:image/...;base64,...)")

    mime_type = match.group("mime").lower()
    if mime_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError(
            f"Unsupported image type: {mime_type}. "
            f"Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}"
        )

    try:
        payload = base64.b64decode(match.group("payload"), validate=True)
    except Exception as e:
        raise ValueError("Image data is not valid base64") from e

    if not payload:
        raise ValueError("Image data is empty")

    if len(payload) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image is too large ({len(payload)} bytes, "
            f"maximum is {MAX_IMAGE_BYTES} bytes)"
        )

    ensure_upload_dir()
    filename = f"{uuid.uuid4()}{ALLOWED_IMAGE_TYPES[mime_type]}"
    with open(get_upload_path(filename), 'wb') as f:
        f.write(payload)

    return {"filename": filename, "mime_type": mime_type, "size": len(payload)}


def read_image_as_data_url(filename: str) -> Optional[str]:
    """
    Read a stored image back as a base64 data URL for sending to the LLM.

    Args:
        filename: Filename returned by save_image_from_data_url

    Returns:
        Data URL string, or None if the file is missing or not a known image type
    """
    path = get_upload_path(filename)
    if not os.path.exists(path):
        return None

    mime_type = EXTENSION_TO_MIME.get(os.path.splitext(path)[1].lower())
    if mime_type is None:
        return None

    with open(path, 'rb') as f:
        encoded = base64.b64encode(f.read()).decode('ascii')

    return f"data:{mime_type};base64,{encoded}"
