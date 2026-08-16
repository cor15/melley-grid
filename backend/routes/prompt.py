"""
Takes a natural-language instruction + the current grid state, asks Claude
to respond with a single JSON object that can contain:
  - "actions": cell writes to apply to the grid (building/automating)
  - "analysis": a plain-text reply to show in the chat (analyzing/explaining)
An instruction can produce either, both, or neither depending on what was asked.
"""
import os
import json
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any
import anthropic

router = APIRouter(tags=["prompt"])

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

SYSTEM_PROMPT = """You are a spreadsheet assistant. You receive the user's instruction and \
the current state of a spreadsheet grid (as JSON: cell address -> value/formula).

Respond ONLY with a single JSON object, no prose outside it, no markdown fences:

{
  "actions": [ ...zero or more action objects, see below... ],
  "analysis": "...markdown-style reply, or empty string if nothing to say..."
}

Action object types:
{"type": "set_cell", "cell": "B2", "value": "=SUM(B1:B10)", "editable": false}
{"type": "set_range", "start": "A1", "values": [["Revenue", 100], ["COGS", 40]], "editable": false, "label": "..."}
{"type": "insert_chart", "chart_type": "line", "data_range": "A1:B10", "title": "..."}

The "editable" flag (set_cell / set_range only): mark true for standalone INPUT assumptions the
user might reasonably want to tweak by hand — a starting cash balance, a growth rate, a target
headcount, a price. Mark false (or omit) for anything that's a calculated/derived value (a SUM,
a formula result, a total) — those shouldn't be flagged as editable since changing them directly
would break the model. When "editable" is true, include a short "label" describing what the input
represents (e.g. "Monthly growth rate"). These flags populate an assumptions panel for the user —
be selective, only flag genuine standalone inputs, not every cell you write.

How to decide what to return:
- If the user wants something BUILT or CHANGED ("add a...", "build a...", "fix this formula",
  "grow this by 10%"), return the relevant "actions" and leave "analysis" empty unless a short
  note is genuinely useful (e.g. flagging an assumption you made).
- If the user is asking a QUESTION about the data or wants it INTERPRETED ("what does this tell
  you", "which quarter grew fastest", "does this model look right", "summarize this"), return an
  empty "actions" list and put your answer in "analysis". Base the analysis only on the actual
  grid_state given — reference real cell values, don't invent numbers.
- If the request needs both (e.g. "build a projection and tell me if the growth rate looks
  realistic"), fill in both fields.

Formatting "analysis" text: use light markdown so it renders with real structure, not a wall of
text. Use "## " for a short section header when there's more than one point, "- " for bullet
points, and wrap key numbers/metrics in "**double asterisks**" to bold them. Keep it skimmable —
short bullets over long paragraphs, similar to a financial summary someone would present in a
meeting. Example:

"## Key insights\n- **Runway: ~7.2 months** at current burn\n- Revenue grew fastest in **Month 3** (+12%)\n- Cash turns negative around **Month 9**"

Use standard Excel-style formulas (SUM, AVERAGE, NPV, IRR, VLOOKUP, etc.) in "value" \
fields when a formula is being written, prefixed with "=". Keep financial modeling \
correct — proper working capital, depreciation, and net income treatment, not just \
syntactically valid formulas."""


class PromptRequest(BaseModel):
    instruction: str
    grid_state: Any  # current cells, sent from the frontend


@router.post("/parse-prompt")
def parse_prompt(req: PromptRequest):
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Current grid state:\n{json.dumps(req.grid_state)}\n\nInstruction: {req.instruction}",
            }
        ],
    )
    raw_text = "".join(block.text for block in message.content if block.type == "text")
    cleaned = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        parsed = json.loads(cleaned)
        actions = parsed.get("actions", [])
        analysis = parsed.get("analysis", "")
    except (json.JSONDecodeError, AttributeError):
        actions = []
        analysis = ""
    return {"actions": actions, "analysis": analysis, "raw": raw_text}
