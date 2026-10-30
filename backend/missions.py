"""Missions: a goal pursued in a loop between the council and a coding agent.

The council is the brain: it defines the next task and judges each report
against the final goal. The coding agent (Claude Code or Claude Desktop, via
the MCP server) does the work and reports back. A mission is stored as JSON
next to a normal conversation that holds the council's deliberations, so
every step can be inspected in the web UI like any other question.
"""

import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import MISSIONS_DIR

# Reports are replayed to every council model, so keep them bounded
MAX_REPORT_CHARS = 20000
MAX_GOAL_CHARS = 4000
MAX_ITERATIONS_LIMIT = 30

MISSION_ID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

VERDICT_PATTERN = re.compile(
    r"^\W*STATUS:\s*(DONE|CONTINUE|BLOCKED)\W*$", re.IGNORECASE | re.MULTILINE
)


def _path(mission_id: str) -> str:
    return os.path.join(MISSIONS_DIR, f"{mission_id}.json")


def create_mission(
    goal: str,
    criteria: str,
    max_iterations: int,
    conversation_id: str,
) -> Dict[str, Any]:
    """Create and store a mission that has not started deliberating yet."""
    mission = {
        "id": str(uuid.uuid4()),
        "created_at": datetime.utcnow().isoformat(),
        "goal": goal,
        "criteria": criteria,
        "max_iterations": max_iterations,
        "conversation_id": conversation_id,
        # active | done | blocked | stopped | limit
        "status": "active",
        # running (the council is deliberating) | ready | error
        "step": "running",
        "error": None,
        "summary": "",
        # {n, task, report, notes[]} - task is the council's instruction,
        # report is what the agent said it did
        "iterations": [],
        "pending_prompt": "",
    }
    save_mission(mission)
    return mission


def get_mission(mission_id: str) -> Optional[Dict[str, Any]]:
    if not MISSION_ID_PATTERN.fullmatch(mission_id):
        return None
    path = _path(mission_id)
    if not os.path.exists(path):
        return None
    with open(path, "r") as f:
        return json.load(f)


def save_mission(mission: Dict[str, Any]):
    Path(MISSIONS_DIR).mkdir(parents=True, exist_ok=True)
    path = _path(mission["id"])
    # Written aside and renamed, so a poller never reads half a file
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(mission, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def list_missions() -> List[Dict[str, Any]]:
    """Every mission, newest first."""
    if not os.path.isdir(MISSIONS_DIR):
        return []
    missions = []
    for name in os.listdir(MISSIONS_DIR):
        if name.endswith(".json"):
            mission = get_mission(name[:-5])
            if mission:
                missions.append(mission)
    missions.sort(key=lambda m: m["created_at"], reverse=True)
    return missions


def current_task(mission: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The task the agent should be working on, if it is waiting for one."""
    if mission["status"] != "active" or mission["step"] != "ready":
        return None
    if not mission["iterations"]:
        return None
    latest = mission["iterations"][-1]
    return None if latest.get("report") else latest


def public_view(mission: Dict[str, Any]) -> Dict[str, Any]:
    """The mission as the API shows it, with the task awaiting the agent."""
    view = {k: v for k, v in mission.items() if k != "pending_prompt"}
    task = current_task(mission)
    view["current_task"] = task
    return view


def build_plan_prompt(goal: str, criteria: str, max_iterations: int) -> str:
    """First message: the council defines the first task."""
    criteria_text = criteria.strip() or (
        "(none given - state concrete, verifiable done criteria in your answer)"
    )
    return f"""You are the lead architect (the "brain") directing an autonomous coding agent, Claude Code, which has full access to the project's repository. You never write the code yourself; you decide what the agent does next and judge whether the goal has been reached.

Final goal:
{goal}

Done criteria:
{criteria_text}

The agent has at most {max_iterations} iterations.

Write the FIRST task for the agent. Requirements:
- Concrete and self-contained: the agent has none of this conversation, only your task text.
- Small enough to finish in one session, with the checks it must run (tests, commands).
- Say exactly what evidence its report must contain (command output, test results, changed files).
Do not write the whole solution. Reply in the same language as the goal.
The last line of your reply must be exactly: STATUS: CONTINUE"""


def build_next_prompt(
    iteration: int,
    max_iterations: int,
    report: str,
    from_human: bool = False,
) -> str:
    """Later messages: the council judges a report and decides what is next."""
    source = (
        "The human supervising the mission replied"
        if from_human else
        "The coding agent reported on the task you gave it"
    )
    return f"""Iteration {iteration} of at most {max_iterations}. {source}:

--- REPORT ---
{report}
--- END REPORT ---

Judge this against the final goal and done criteria from your earlier messages. Trust evidence (test output, command results), not claims.
- Goal met: summarise what was achieved. The last line must be: STATUS: DONE
- Not met: write the next self-contained task for the agent, correcting course if the report shows problems. The last line must be: STATUS: CONTINUE
- Blocked on something only a human can decide: state the question. The last line must be: STATUS: BLOCKED
Reply in the same language as the goal. The last line must be exactly one of those STATUS lines."""


def parse_verdict(text: str) -> Tuple[str, str]:
    """
    Split the chairman's answer into (verdict, body).

    A missing STATUS line counts as CONTINUE: the safe reading is that more
    work is needed, and the mission is still bounded by its iteration limit.
    """
    matches = list(VERDICT_PATTERN.finditer(text))
    if not matches:
        return "CONTINUE", text.strip()
    last = matches[-1]
    body = (text[:last.start()] + text[last.end():]).strip()
    return last.group(1).upper(), body
