"""
Automation rules: "whenever cells in this range change, run this instruction"
Stored in Supabase so they persist across sessions. The actual triggering
happens client-side (frontend watches for grid edits and matches them
against these rules), this route just handles CRUD.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase_client import supabase

router = APIRouter(prefix="/rules", tags=["rules"])


class RuleCreate(BaseModel):
    sheet_id: str | None = None  # optional — rules can exist before a sheet is saved
    trigger_range: str  # e.g. "B1:B10"
    instruction: str  # e.g. "recalculate the totals in column C"


@router.get("")
def list_rules(sheet_id: str | None = None):
    query = supabase.table("automation_rules").select("*")
    if sheet_id:
        query = query.eq("sheet_id", sheet_id)
    result = query.order("created_at", desc=True).execute()
    return result.data


@router.post("")
def create_rule(rule: RuleCreate):
    result = supabase.table("automation_rules").insert(rule.model_dump()).execute()
    return result.data[0]


@router.delete("/{rule_id}")
def delete_rule(rule_id: str):
    result = supabase.table("automation_rules").delete().eq("id", rule_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"deleted": rule_id}
