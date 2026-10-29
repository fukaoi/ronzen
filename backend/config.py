"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Council members - list of OpenRouter model identifiers

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Data directory for conversation storage
DATA_DIR = "data/conversations"

# Directory for uploaded images
UPLOAD_DIR = "data/uploads"

# Maximum size of a single uploaded image (bytes)
MAX_IMAGE_BYTES = 10 * 1024 * 1024

# Maximum size of a single uploaded text file (bytes).
# Text attachments are inlined into the prompt, and every council run sends
# that prompt to each council model twice plus the chairman, so the file's
# token cost is multiplied sevenfold. Keep this modest.
MAX_TEXT_BYTES = int(os.getenv("MAX_TEXT_BYTES", str(256 * 1024)))

# Maximum combined size of the text files attached to one message (bytes)
MAX_TEXT_BYTES_PER_MESSAGE = int(
    os.getenv("MAX_TEXT_BYTES_PER_MESSAGE", str(1024 * 1024))
)

# --- Server / network ---

# Bind address. Loopback by default: when the app is published through a
# Cloudflare Tunnel, cloudflared connects to it from the same machine, so the
# port never has to be reachable from the network.
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8001"))

# Extra browser origins allowed to call the API, comma separated. Only needed
# when the frontend is served from a different origin than the API; serving
# frontend/dist from this app (the default in production) needs none.
EXTRA_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

# Council runs allowed per minute, per client. Each run costs real money at
# OpenRouter, so this caps the damage of a stuck client or a misclick.
# Set to 0 to disable.
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "10"))

COUNCIL_MODELS = [
    "~openai/gpt-astra-latest",
    "anthropic/claude-opus-5.5",
    "google/gemini-4-argon",
]
CHAIRMAN_MODEL = "qwen/qwen3.8-max-0902"


# コスト削減構成
#COUNCIL_MODELS = [
#    "openai/gpt-5-nano",
#    "google/gemini-2.5-flash-lite",
#    "deepseek/deepseek-v3.2",
#]
#
#CHAIRMAN_MODEL = "openai/gpt-5-mini"
