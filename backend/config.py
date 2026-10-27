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

COUNCIL_MODELS = [
    "~openai/gpt-astra-latest",
    "anthropic/claude-opus-5",
    "~google/gemini-pro-latest",
]
CHAIRMAN_MODEL = "~google/gemini-pro-latest"


# コスト削減構成
#COUNCIL_MODELS = [
#    "openai/gpt-5-nano",
#    "google/gemini-2.5-flash-lite",
#    "deepseek/deepseek-v3.2",
#]
#
#CHAIRMAN_MODEL = "openai/gpt-5-mini"
