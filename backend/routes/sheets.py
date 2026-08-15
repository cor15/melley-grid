"""
CRUD for saved spreadsheets. Each sheet's full grid is stored as JSONB in
Supabase — simplest option for a single-user tool, no per-cell rows needed.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from supabase_client import supabase

router = APIRouter(prefix="/sheets", tags=["sheets"])


class SheetCreate(BaseModel):
    name: str
    data: Any  # grid contents (cells, formulas, formatting) as JSON


class SheetUpdate(BaseModel):
    name: str | None = None
    data: Any | None = None


@router.get("")
def list_sheets():
    result = supabase.table("sheets").select("id, name, updated_at").order("updated_at", desc=True).execute()
    return result.data


@router.get("/{sheet_id}")
def get_sheet(sheet_id: str):
    result = supabase.table("sheets").select("*").eq("id", sheet_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Sheet not found")
    return result.data


@router.post("")
def create_sheet(sheet: SheetCreate):
    result = supabase.table("sheets").insert({"name": sheet.name, "data": sheet.data}).execute()
    return result.data[0]


@router.patch("/{sheet_id}")
def update_sheet(sheet_id: str, sheet: SheetUpdate):
    payload = {k: v for k, v in sheet.model_dump().items() if v is not None}
    result = supabase.table("sheets").update(payload).eq("id", sheet_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Sheet not found")
    return result.data[0]


@router.delete("/{sheet_id}")
def delete_sheet(sheet_id: str):
    supabase.table("sheets").delete().eq("id", sheet_id).execute()
    return {"deleted": sheet_id}
