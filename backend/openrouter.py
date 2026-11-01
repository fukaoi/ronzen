"""OpenRouter API client for making LLM requests."""

import asyncio
import time
import httpx
from typing import List, Dict, Any, Optional
from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL, OPENROUTER_BASE_URL

BALANCE_CACHE_SECONDS = 20.0
_balance_cache: Dict[str, Any] = {"at": 0.0, "value": None}


class BalanceError(Exception):
    """The balance could not be read; the message is safe to show."""


async def fetch_balance(fresh: bool = False) -> Dict[str, Any]:
    """
    Credits and spending of the account behind the API key.

    Two endpoints are read together. /credits has the account's purchased and
    used credits; /key has this key's own spending, and its limit if one is
    set. Either can be missing (an older or restricted key), so the result
    holds whatever came back, and fails only when nothing did.

    The result is kept for a few seconds so a page that refreshes does not
    hammer OpenRouter; `fresh` skips that.
    """
    if not OPENROUTER_API_KEY:
        raise BalanceError("OPENROUTER_API_KEY is not set")

    cached = _balance_cache["value"]
    if not fresh and cached is not None and time.time() - _balance_cache["at"] < BALANCE_CACHE_SECONDS:
        return cached

    headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        credits_resp, key_resp = await asyncio.gather(
            client.get(f"{OPENROUTER_BASE_URL}/credits", headers=headers),
            client.get(f"{OPENROUTER_BASE_URL}/key", headers=headers),
            return_exceptions=True,
        )

    def data_of(response) -> Optional[Dict[str, Any]]:
        if isinstance(response, Exception) or response.status_code != 200:
            return None
        try:
            return response.json().get("data")
        except ValueError:
            return None

    credits = data_of(credits_resp)
    key = data_of(key_resp)
    if credits is None and key is None:
        raise BalanceError("OpenRouter did not return the balance")

    balance: Dict[str, Any] = {
        "total_credits": None,
        "total_usage": None,
        "remaining": None,
        "key_limit": None,
        "key_limit_remaining": None,
        "usage_daily": None,
        "usage_weekly": None,
        "usage_monthly": None,
    }
    if credits:
        balance["total_credits"] = credits.get("total_credits")
        balance["total_usage"] = credits.get("total_usage")
        if balance["total_credits"] is not None and balance["total_usage"] is not None:
            balance["remaining"] = balance["total_credits"] - balance["total_usage"]
    if key:
        balance["key_limit"] = key.get("limit")
        balance["key_limit_remaining"] = key.get("limit_remaining")
        balance["usage_daily"] = key.get("usage_daily")
        balance["usage_weekly"] = key.get("usage_weekly")
        balance["usage_monthly"] = key.get("usage_monthly")

    _balance_cache["at"] = time.time()
    _balance_cache["value"] = balance
    return balance


async def query_model(
    model: str,
    messages: List[Dict[str, Any]],
    timeout: float = 120.0
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'. 'content' is
            either a string or a list of content parts (text / image_url) for
            multimodal requests.
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            message = data['choices'][0]['message']

            return {
                'content': message.get('content'),
                'reasoning_details': message.get('reasoning_details')
            }

    except Exception as e:
        print(f"Error querying model {model}: {e}")
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, Any]]
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    # Create tasks for all models
    tasks = [query_model(model, messages) for model in models]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks)

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}
