"""
Takes a natural-language instruction + the current grid state, asks Claude
to turn it into a structured list of cell actions, and returns them for the
frontend to apply to the grid.
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
the current state of a spreadsheet grid (as JSON: cell address -> value/formula). \
Respond ONLY with a JSON array of actions, no prose, no markdown fences. Each action is one of:

{"type": "set_cell", "cell": "B2", "value": "=SUM(B1:B10)"}
{"type": "set_range", "start": "A1", "values": [["Revenue", 100], ["COGS", 40]]}
{"type": "insert_chart", "chart_type": "line", "data_range": "A1:B10", "title": "..."}

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
        actions = json.loads(cleaned)
    except json.JSONDecodeError:
        actions = []
    return {"actions": actions, "raw": raw_text}
