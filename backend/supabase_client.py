"""
Supabase connection, structured the same way as the DIE financial monitoring
backend: a single shared client built from env vars, imported wherever needed.
"""
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # service role key (backend only, never exposed to frontend)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
