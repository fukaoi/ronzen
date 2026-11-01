"""JSON-based storage for conversations."""

import base64
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import (
    DATA_DIR,
    UPLOAD_DIR,
    MAX_IMAGE_BYTES,
    MAX_TEXT_BYTES,
)

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

# The browser leaves the media type empty for file types it does not know
# (.pine, .pinescript and friends), so the mime group has to be optional.
DATA_URL_PATTERN = re.compile(
    r"data:(?P<mime>[\w./+-]*);base64,(?P<payload>.*)", re.DOTALL
)

# Everything outside this set is replaced when an uploaded name is stored
UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


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


def message_timestamp() -> str:
    """When a message was saved, in UTC with its offset, so any client can show local time."""
    return datetime.now(timezone.utc).isoformat()


def add_user_message(
    conversation_id: str,
    content: str,
    images: Optional[List[str]] = None,
    files: Optional[List[str]] = None
):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
        images: Filenames of previously uploaded images attached to the message
        files: Filenames of previously uploaded text files attached to it

    Text files are stored with their display name alongside the stored
    filename, so the UI does not have to take the name apart itself.
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "created_at": message_timestamp(),
        "content": content,
        "images": images or [],
        "files": [
            {"filename": filename, "name": display_name(filename)}
            for filename in (files or [])
        ]
    })

    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    mode: str = "council"
):
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        mode: "chairman" when the chairman answered alone, with no stages 1 and 2
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "assistant",
        "created_at": message_timestamp(),
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
        "mode": mode
    })

    save_conversation(conversation)


def remove_last_turn(
    conversation_id: str,
    keep_attachments: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Drop the last user message and the answer that followed it.

    Truncating at the last user message removes its assistant message too,
    which is what both "delete" and "edit" need: every later turn was produced
    with this one in its context, so leaving them would strand them.

    Args:
        conversation_id: Conversation identifier
        keep_attachments: Leave the message's uploads on disk. The edit flow
            needs this, because it puts them straight back in the composer.

    Returns:
        The removed user message, or None if there was nothing to remove
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    messages = conversation["messages"]
    last_user = next(
        (
            index
            for index in range(len(messages) - 1, -1, -1)
            if messages[index].get("role") == "user"
        ),
        None,
    )
    if last_user is None:
        return None

    removed = messages[last_user]
    conversation["messages"] = messages[:last_user]
    save_conversation(conversation)

    if not keep_attachments:
        delete_uploads(attachment_filenames(removed))

    return removed


def attachment_filenames(message: Dict[str, Any]) -> List[str]:
    """Every upload referenced by a user message, images and text files."""
    filenames = list(message.get("images", []))
    filenames.extend(
        entry["filename"]
        for entry in message.get("files", [])
        if isinstance(entry, dict) and entry.get("filename")
    )
    return filenames


def delete_uploads(filenames: List[str]):
    """
    Remove uploads that nothing points at any more.

    Each upload is stored under a fresh uuid even when the same file is
    attached twice, so no other message can be referring to these.
    """
    for filename in filenames:
        try:
            os.remove(get_upload_path(filename))
        except OSError:
            pass


def delete_conversation(conversation_id: str) -> bool:
    """
    Remove a conversation and the uploads its messages point at.

    Returns:
        False if there was no such conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return False

    for message in conversation["messages"]:
        if message.get("role") == "user":
            delete_uploads(attachment_filenames(message))

    os.remove(get_conversation_path(conversation_id))
    return True


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


# --- Uploads ---


def ensure_upload_dir():
    """Ensure the upload directory exists."""
    Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)


def get_upload_path(filename: str) -> str:
    """Get the file path for an upload (basename only, no traversal)."""
    return os.path.join(UPLOAD_DIR, os.path.basename(filename))


def safe_attachment_name(name: str) -> str:
    """
    Reduce an uploaded file's name to something safe to store and display.

    Keeps the name recognisable (README.md stays README.md) while dropping
    anything that could escape the upload directory or hide the file.
    """
    cleaned = UNSAFE_NAME_CHARS.sub("-", os.path.basename(name or "").strip())
    cleaned = cleaned.strip(".-")
    return cleaned[:80]


def display_name(filename: str) -> str:
    """
    Recover the name a text upload was given by the user.

    Text files are stored as "<uuid>_<safe name>"; a uuid4 never contains an
    underscore, so the first one separates the two halves.
    """
    base = os.path.basename(filename)
    return base.split("_", 1)[1] if "_" in base else base


def decode_data_url(data_url: str) -> tuple:
    """
    Split a base64 data URL into its media type and bytes.

    Returns:
        Tuple of (mime_type, payload bytes)

    Raises:
        ValueError: If the data URL is malformed or carries no data
    """
    match = DATA_URL_PATTERN.fullmatch(data_url.strip())
    if match is None:
        raise ValueError("Expected a base64 data URL (data:<type>;base64,...)")

    try:
        payload = base64.b64decode(match.group("payload"), validate=True)
    except Exception as e:
        raise ValueError("Attachment data is not valid base64") from e

    if not payload:
        raise ValueError("Attachment is empty")

    return match.group("mime").lower(), payload


def save_upload_from_data_url(data_url: str, name: str = "") -> Dict[str, Any]:
    """
    Decode a base64 data URL and store it, as an image or as a text file.

    Images go to the model as image parts; everything else is treated as text
    and gets inlined into the prompt, so it has to decode as UTF-8.

    Args:
        data_url: A "data:<type>;base64,..." URL
        name: The file's original name, used for text files

    Returns:
        Dict with 'filename', 'name', 'kind' ("image" or "text"), 'mime_type'
        and 'size'

    Raises:
        ValueError: If the data is malformed, too large, or not readable text
    """
    mime_type, payload = decode_data_url(data_url)

    if mime_type in ALLOWED_IMAGE_TYPES:
        return _save_image(payload, mime_type)

    if mime_type.startswith("image/"):
        raise ValueError(
            f"Unsupported image type: {mime_type}. "
            f"Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}"
        )

    return _save_text(payload, name)


def _save_image(payload: bytes, mime_type: str) -> Dict[str, Any]:
    """Store image bytes under a generated name."""
    if len(payload) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image is too large ({len(payload)} bytes, "
            f"maximum is {MAX_IMAGE_BYTES} bytes)"
        )

    ensure_upload_dir()
    filename = f"{uuid.uuid4()}{ALLOWED_IMAGE_TYPES[mime_type]}"
    with open(get_upload_path(filename), 'wb') as f:
        f.write(payload)

    return {
        "filename": filename,
        "name": filename,
        "kind": "image",
        "mime_type": mime_type,
        "size": len(payload),
    }


def _save_text(payload: bytes, name: str) -> Dict[str, Any]:
    """
    Store a text file, keeping its name so the model can be told what it is.

    The type the browser reports is ignored: it is empty or
    application/octet-stream for most source files. Decoding as UTF-8 is what
    actually decides whether this is text we can put in a prompt.
    """
    if len(payload) > MAX_TEXT_BYTES:
        raise ValueError(
            f"{name or 'File'} is too large "
            f"({len(payload)} bytes, maximum is {MAX_TEXT_BYTES} bytes)"
        )

    try:
        content = payload.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError(
            f"{name or 'File'} is not a UTF-8 text file. Images and text "
            "files can be attached; PDF, Word and other binary formats cannot."
        )

    if "\x00" in content:
        raise ValueError(f"{name or 'File'} looks binary, not text")

    ensure_upload_dir()
    safe_name = safe_attachment_name(name) or "attachment.txt"
    filename = f"{uuid.uuid4()}_{safe_name}"
    with open(get_upload_path(filename), 'wb') as f:
        f.write(payload)

    return {
        "filename": filename,
        "name": safe_name,
        "kind": "text",
        "mime_type": "text/plain",
        "size": len(payload),
    }


def save_text_attachment(text: str, name: str) -> Dict[str, Any]:
    """
    Store text that the app itself produced as an attachment.

    Used for carrying a conversation over to a fresh one, where the text comes
    from an earlier answer rather than from a file the user picked.
    """
    return _save_text(text.encode('utf-8'), name)


def read_text_file(filename: str) -> Optional[str]:
    """
    Read a stored text attachment back for inlining into a prompt.

    Args:
        filename: Filename returned by save_upload_from_data_url

    Returns:
        The file's text, or None if it is missing or no longer decodes
    """
    path = get_upload_path(filename)
    if not os.path.exists(path):
        return None

    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


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
