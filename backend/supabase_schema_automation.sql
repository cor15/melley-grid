-- Run this in the Supabase SQL editor (in addition to supabase_schema.sql)
-- to add support for automation rules.
create table if not exists automation_rules (
    id uuid primary key default gen_random_uuid(),
    sheet_id uuid references sheets(id) on delete cascade,
    trigger_range text not null,
    instruction text not null,
    created_at timestamptz not null default now()
);
