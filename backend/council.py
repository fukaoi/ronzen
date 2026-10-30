"""3-stage LLM Council orchestration."""

import asyncio
from typing import List, Dict, Any, Optional, Tuple
from .openrouter import query_models_parallel, query_model
from .config import COUNCIL_MODELS, CHAIRMAN_MODEL


def build_user_content(
    text: str,
    images: Optional[List[str]] = None,
    files: Optional[List[Dict[str, str]]] = None
) -> Any:
    """
    Build the 'content' field of a user message, attaching what came with it.

    Images travel as native image parts. Text files have no equivalent, so
    they are inlined ahead of the user's own words: the file is the context
    and the question is what the model should act on, so the question reads
    last.

    Args:
        text: The text part of the message
        images: Image data URLs to attach
        files: Text attachments, each a dict with 'name' and 'content'

    Returns:
        A plain string when there are no images, otherwise a list of content
        parts in OpenRouter's multimodal format
    """
    if files:
        text = f"{format_attached_files(files)}\n\n{text}" if text else format_attached_files(files)

    if not images:
        return text

    parts: List[Dict[str, Any]] = [{"type": "text", "text": text}]
    for image_url in images:
        parts.append({
            "type": "image_url",
            "image_url": {"url": image_url}
        })

    return parts


def format_attached_files(files: List[Dict[str, str]]) -> str:
    """
    Render text attachments as a block to put in front of the prompt.

    XML-ish tags rather than fenced code blocks: attachments are often
    Markdown, and a file containing ``` of its own would break out of a fence.

    Args:
        files: Dicts with 'name' and 'content'

    Returns:
        The attachments as one string
    """
    blocks = "\n".join(
        f'<file name="{f["name"]}">\n{f["content"]}\n</file>'
        for f in files
    )
    return f"<attached_files>\n{blocks}\n</attached_files>"


def build_messages(
    prompt: str,
    images: Optional[List[str]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    files: Optional[List[Dict[str, str]]] = None
) -> List[Dict[str, Any]]:
    """
    Build the message list for a council query: prior turns, then this prompt.

    Args:
        prompt: The prompt for this turn
        images: Image data URLs to attach to this turn
        history: Earlier messages in the conversation, already formatted
        files: Text attachments for this turn

    Returns:
        List of message dicts ready to send to OpenRouter
    """
    return list(history or []) + [
        {"role": "user", "content": build_user_content(prompt, images, files)}
    ]


async def stage1_collect_responses(
    user_query: str,
    images: Optional[List[str]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    files: Optional[List[Dict[str, str]]] = None
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        images: Image data URLs attached to the question
        history: Earlier messages in the conversation
        files: Text attachments for the question

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    messages = build_messages(user_query, images, history, files)

    # Query all models in parallel
    responses = await query_models_parallel(COUNCIL_MODELS, messages)

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    images: Optional[List[str]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    files: Optional[List[Dict[str, str]]] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1
        images: Image data URLs attached to the question, so evaluators can
            judge whether each response describes the image correctly
        history: Earlier messages in the conversation
        files: Text attachments, included for the same reason as images

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    attachment_note = (
        "\n\nThe question's attachments are included with this message. "
        "Take them into account when judging accuracy."
        if (images or files) else ""
    )

    async def evaluate(model: str) -> Optional[Dict[str, Any]]:
        # A model never ranks its own answer: it may recognise its own style
        # and favour it. Labels stay the same for everyone, so the evaluator
        # simply sees a subset of them.
        others = [
            (label, result) for label, result in zip(labels, stage1_results)
            if result['model'] != model
        ]
        if not others:
            return None

        responses_text = "\n\n".join([
            f"Response {label}:\n{result['response']}"
            for label, result in others
        ])
        example = [f"Response {label}" for label, _ in reversed(others)]
        example_ranking = "\n".join(
            f"{i}. {name}" for i, name in enumerate(example, start=1)
        )

        ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}{attachment_note}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. {example[0]}")
- Rank every response shown above, and only those
- Do not add any other text or explanations in the ranking section

Example of the correct format for the ranking section:

FINAL RANKING:
{example_ranking}

Now provide your evaluation and ranking:"""

        messages = build_messages(ranking_prompt, images, history, files)
        return await query_model(model, messages)

    # Get rankings from all council models in parallel
    evaluations = await asyncio.gather(*(evaluate(m) for m in COUNCIL_MODELS))
    responses = dict(zip(COUNCIL_MODELS, evaluations))

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get('content', '')
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
            })

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    images: Optional[List[str]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    files: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2
        images: Image data URLs attached to the question
        history: Earlier messages in the conversation
        files: Text attachments for the question

    Returns:
        Dict with 'model' and 'response' keys
    """
    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    attachment_note = (
        "\n(The files the user attached are included with this message.)"
        if (images or files) else ""
    )

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}{attachment_note}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages = build_messages(chairman_prompt, images, history, files)

    # Query the chairman model
    response = await query_model(CHAIRMAN_MODEL, messages)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": CHAIRMAN_MODEL,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": CHAIRMAN_MODEL,
        "response": response.get('content', '')
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                # A model's opinion of its own answer is not a peer vote
                if model_name == ranking['model']:
                    continue
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(
    user_query: str,
    fallback_title: str = ""
) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message
        fallback_title: Used when the message is attachments only, e.g. the
            name of the first attached file

    Returns:
        A short title (3-5 words)
    """
    # An attachment-only message has no text to summarize
    if not user_query.strip():
        return fallback_title or "Attachment Discussion"

    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.
Write the title in the same language as the question.
Reply with the title only, on a single line, with no explanation or alternatives.

Question: {user_query[:2000]}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use gemini-2.5-flash for title generation (fast and cheap); retry once
    # since a transient failure would otherwise leave the generic title
    title = ""
    for _ in range(2):
        response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)
        content = (response or {}).get('content') or ""
        # Take the first non-empty line and strip markdown / quotes
        lines = [l.strip() for l in content.splitlines() if l.strip()]
        title = lines[0].strip('"\'`*# 「」') if lines else ""
        if title:
            break

    if not title:
        # Fall back to the start of the question itself
        title = " ".join(user_query.split())

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title or "New Conversation"


async def run_full_council(
    user_query: str,
    images: Optional[List[str]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    files: Optional[List[Dict[str, str]]] = None
) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        images: Image data URLs attached to the question
        history: Earlier messages in the conversation
        files: Text attachments for the question

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, images, history, files)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(
        user_query, stage1_results, images, history, files
    )

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        images,
        history,
        files
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }

    return stage1_results, stage2_results, stage3_result, metadata
