"""Standing instructions that apply to every council model on every question."""

import os
from pathlib import Path

from .config import INSTRUCTIONS_FILE, MAX_INSTRUCTIONS_CHARS


def get_instructions() -> str:
    """The current instructions; empty until some have been saved."""
    if not os.path.exists(INSTRUCTIONS_FILE):
        return ""
    with open(INSTRUCTIONS_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()


def set_instructions(text: str) -> str:
    """Save the instructions, returning what was stored."""
    text = text.strip()[:MAX_INSTRUCTIONS_CHARS]
    Path(INSTRUCTIONS_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(INSTRUCTIONS_FILE, "w", encoding="utf-8") as f:
        f.write(text)
    return text
