# Ronzen - LLM Council

**Multiple Minds. Deeper Thinking.**

A local web app that puts several LLMs on a council. Instead of asking one model, you ask them all through [OpenRouter](https://openrouter.ai/): they answer independently, rank each other's answers without knowing who wrote what, and a Chairman model writes the final answer. It also lets the council direct a coding agent through long jobs (Missions).

> **Based on [karpathy/llm-council](https://github.com/karpathy/llm-council).** The three-stage council and the anonymized peer review come from that project. This version adds the features listed below. See the upstream repository for its license terms.

## How a question is answered

1. **Stage 1: First opinions.** Every council model gets your question separately. Their answers are shown in tabs so you can read them one by one.
2. **Stage 2: Peer review.** Each model sees the other models' answers, anonymized as "Response A, B, C...", and ranks them. A model never ranks its own answer. The app shows each model's raw evaluation, the ranking it parsed from it, and an aggregate ranking by average position.
3. **Stage 3: Final answer.** The Chairman reads all answers and rankings and writes one answer.

For a quick follow-up that does not need a full deliberation, switch the box to **Chairman only**: just the Chairman answers, which is faster and cheaper.

## Features

**Asking**
- Three-stage council with a live progress indicator per stage. A run keeps going on the server if you close or reload the page, and the page picks it back up.
- **Chairman only** mode for quick follow-ups. Its answers join the conversation history like any other.
- **Council Rules**: standing instructions (for example "keep answers short") that every model receives with every question. Edit them from the sidebar; they apply from the next question.
- Attach **images and text files** by button, drag and drop, or paste. Text files are inlined into the prompt.
- Copy the final answer as Markdown or plain text.

**Conversations**
- Rename or delete a conversation from the sidebar.
- Take back the last question: edit it (it returns to the box, attachments included) or delete it together with its answer.
- A history meter shows how much text every question carries. Every question replays the history to each council member twice and to the Chairman once, so long conversations get expensive. **Carry on in a new conversation** starts fresh from the last question and answer.
- Conversations created by missions are tinted in the list.

**Missions (beta): the council as the brain, a coding agent as the hands**
- Give the council a goal and done criteria. It writes each task and judges each report; Claude Code or Claude Desktop does the work through an MCP server, until the council says the goal is reached.
- Goals and reports are rendered as Markdown. You can stop a mission, retry a failed step, or answer when the council is blocked and needs a decision.

**Running it**
- A production script that serves the built frontend from the backend, bound to loopback, ready to sit behind a Cloudflare Tunnel.
- Per-client rate limit on council runs, because every run costs real money.
- Provider icons next to model names.

## Setup

You need [uv](https://docs.astral.sh/uv/), Python 3.10 or newer, Node.js with npm, and an OpenRouter account with credits.

**1. Install dependencies**

```bash
uv sync
cd frontend
npm install
cd ..
```

**2. Add your API key**

Copy `.env.example` to `.env` and set your key:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Get a key at [openrouter.ai](https://openrouter.ai/) and buy the credits you need. Every question calls each council model twice (stages 1 and 2) plus the Chairman once.

**3. Pick the models (optional)**

Set them in `.env`, as OpenRouter model identifiers separated by commas:

```bash
COUNCIL_MODELS=openai/gpt-5.1,anthropic/claude-sonnet-4.5,google/gemini-3-pro-preview
CHAIRMAN_MODEL=google/gemini-3-pro-preview
```

Without these, the defaults in `backend/config.py` apply. The Chairman can be one of the council members or a different model. With three council members, each answer gets only two peer votes (nobody ranks their own), so four or more members give more meaningful rankings.

## Running

**Development** (backend with the Vite dev server)

```bash
./start.sh
```

Open http://localhost:5173. Or run the two parts yourself:

```bash
uv run python -m backend.main
```

```bash
npm --prefix frontend run dev
```

**Production** (one process, one origin)

```bash
./start-prod.sh
```

This builds the frontend and serves everything from http://127.0.0.1:8001. To reach it from elsewhere, point a Cloudflare Tunnel at that address and put a Cloudflare Access policy on the hostname. Do not expose the port directly.

## Using the app

1. Click **New Conversation** and type a question. Press **Ctrl/Cmd+Enter** to send; Enter adds a new line.
2. Choose **Council** for the full deliberation or **Chairman only** for a quick answer.
3. Read the stages: the tabs in Stage 1, the raw evaluations and extracted rankings in Stage 2, and the Chairman's answer in Stage 3.
4. Use **Council Rules** to set instructions that apply to every question.
5. When the history meter turns heavy, use **Carry on in a new conversation**.

### Missions

1. Register the MCP server once. User scope makes it available in any project:

   ```bash
   claude mcp add --scope user llm-council -- uv run --directory /path/to/ronzen python -m backend.mcp_server
   ```

   For Claude Desktop, add the same command under `mcpServers` in `claude_desktop_config.json`.
2. Keep the app running (`./start-prod.sh`). If it is not on `http://127.0.0.1:8001`, set `COUNCIL_URL` for the MCP server.
3. Open **Missions**, enter the final goal and, optionally, the done criteria, and press **Start mission**. The council drafts the first task.
4. Press **Claude Connect**. It copies a start prompt; paste it into Claude Code or Desktop in the project to work on.
5. The agent loops `council_poll`, does the work, then calls `council_report`. Every deliberation is saved as a normal conversation, so you can read it from the sidebar.

The loop ends when the council says the goal is reached, when the iteration limit is hit, when you press **Stop**, or when the council is blocked and asks you something.

## Configuration

Set these in `.env`. Only `OPENROUTER_API_KEY` is required.

| Variable | Default | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | none | OpenRouter API key |
| `COUNCIL_MODELS` | see `backend/config.py` | Council members, comma separated |
| `CHAIRMAN_MODEL` | see `backend/config.py` | Model that writes the final answer |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback behind a tunnel |
| `PORT` | `8001` | Backend port |
| `ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the API |
| `RATE_LIMIT_PER_MINUTE` | `10` | Council runs per client per minute. `0` disables the limit |
| `MAX_TEXT_BYTES` | `262144` | Largest single text attachment |
| `MAX_TEXT_BYTES_PER_MESSAGE` | `1048576` | Combined size of text attachments in one message |
| `CONTEXT_WARNING_CHARS` | `100000` | History size at which the meter suggests a fresh conversation |
| `COUNCIL_INSTRUCTIONS_FILE` | `data/council_instructions.md` | Where Council Rules are saved |
| `COUNCIL_URL` | `http://127.0.0.1:8001` | Address of the app, read by the MCP server |

If you change the backend port, also update the address in `frontend/src/api.js`.

## Tech stack

- **Backend:** FastAPI (Python 3.10+), async httpx, OpenRouter API, an MCP server for missions
- **Frontend:** React and Vite, react-markdown, lucide-react
- **Storage:** JSON files under `data/` (conversations, missions, uploads). The folder is git-ignored.
- **Packages:** uv for Python, npm for JavaScript

`CLAUDE.md` has the architecture notes and design decisions.

## Acknowledgements

This project began as a fork of [karpathy/llm-council](https://github.com/karpathy/llm-council). Thank you, Andrej Karpathy, for sharing the idea of a council of LLMs that review each other's answers anonymously, and for publishing a small, clear implementation that made it easy to build on. Everything here grew from that starting point.
