from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import sheets, prompt, files

app = FastAPI(title="AI Spreadsheet API")

# Personal single-user tool — CORS left open for local dev / desktop app calls.
# Tighten allow_origins if you ever host the frontend at a fixed domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sheets.router)
app.include_router(prompt.router)
app.include_router(files.router)


@app.get("/")
def health_check():
    return {"status": "ok"}
