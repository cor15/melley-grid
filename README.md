# AI Spreadsheet (personal)

A personal, AI-first spreadsheet tool: type an instruction, Claude turns it
into formulas/values written straight into the grid. Structured the same way
as your DIE backend — FastAPI on Render, Supabase for storage — with no
Netlify anywhere.

## Structure

```
ai-spreadsheet/
├── backend/          FastAPI app (deploy to Render)
│   ├── main.py
│   ├── routes/
│   │   ├── sheets.py      save/load spreadsheets (Supabase)
│   │   ├── prompt.py      instruction -> Claude -> cell actions
│   │   └── files.py       CSV/XLSX import & export
│   ├── supabase_client.py
│   ├── supabase_schema.sql
│   ├── render.yaml
│   └── requirements.txt
├── frontend/         Static site: spreadsheet grid + chat sidebar
│   ├── index.html
│   ├── app.js
│   ├── config.js     <- set your backend URL here
│   └── style.css
└── desktop/          Instructions to wrap frontend/ as a native app (Tauri)
```

## Local setup

**Backend**
```
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
uvicorn main:app --reload
```

**Supabase**
Run `backend/supabase_schema.sql` in the Supabase SQL editor to create the
`sheets` table.

**Frontend**
`frontend/config.js` already points at `http://localhost:8000` for local dev.
Just open `frontend/index.html` in a browser (or serve it with any static
server) once the backend is running.

## Deploy

**Backend → Render**: push this repo, create a new Web Service pointing at
`backend/`, and it'll pick up `render.yaml` automatically. Set the three env
vars in the Render dashboard (they're marked `sync: false` so Render won't
ask you to commit them).

**Frontend → browser link (optional)**: easiest is a Render Static Site
pointed at `frontend/`, so everything lives on the same provider as the
backend — or just open `frontend/index.html` locally / from the desktop app,
no hosting needed at all if you only want the desktop version.

**Desktop app**: see `desktop/README.md` — wraps `frontend/` in Tauri, talking
to your deployed Render backend.

## Notes

- Single-user tool, so there's no auth/roles system (unlike DIE's multi-role
  setup) — add Supabase auth later only if you ever want to lock it down.
- The grid uses `x-data-spreadsheet` (MIT licensed, loaded via CDN) — swap for
  Univer or Handsontable later if you want more Excel-like formula support.
- `routes/prompt.py`'s system prompt is the main lever for output quality —
  tighten it as you find cases where Claude's formulas are syntactically
  valid but financially wrong (the TrufflePig review flagged working capital
  and net income as weak spots — worth testing those specifically).
