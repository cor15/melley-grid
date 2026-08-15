"""
Import an uploaded CSV/XLSX into grid JSON, and export grid JSON back to XLSX.
"""
import io
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any
import pandas as pd
import openpyxl

router = APIRouter(tags=["files"])


@router.post("/import")
async def import_file(file: UploadFile = File(...)):
    contents = await file.read()
    if file.filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(contents))
    else:
        df = pd.read_excel(io.BytesIO(contents))
    # Convert to a simple row-major grid: header row + data rows
    grid = [df.columns.tolist()] + df.values.tolist()
    return {"grid": grid}


class ExportRequest(BaseModel):
    name: str
    grid: list[list[Any]]


@router.post("/export")
def export_file(req: ExportRequest):
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in req.grid:
        ws.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={req.name}.xlsx"},
    )
