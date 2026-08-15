-- Run this in the Supabase SQL editor to set up the sheets table.
create table if not exists sheets (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    data jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Keep updated_at current on every edit
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists sheets_set_updated_at on sheets;
create trigger sheets_set_updated_at
    before update on sheets
    for each row execute function set_updated_at();
