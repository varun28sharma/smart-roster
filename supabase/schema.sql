-- Smart Roster: Supabase / Postgres schema.
-- Run in the Supabase SQL editor, then set VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY. The app seeds the sample data on first load.
--
-- Relationships:
--   pod 1─* employee            (pods.lead_id points at one employee; no FK to avoid a cycle)
--   pod 1─* brand
--   brand 1─* service           ("brand process": brand × process with its own calendar & staffing)
--   process 1─* service
--   employee *─* service        via assignments (kind = primary | backup)
--   employee 1─* leave
--   rosters: one row per month; decisions (offs, pins, covers) stored as jsonb

create table if not exists processes (
  id text primary key,
  code text not null,
  name text not null
);

create table if not exists shifts (
  id text primary key,
  name text not null,
  start text not null,
  "end" text not null
);

create table if not exists pods (
  id text primary key,
  name text not null,
  lead_id text
);

create table if not exists employees (
  id text primary key,
  name text not null,
  pod_id text references pods(id),
  is_lead boolean not null default false,
  shift_id text not null default 'GEN',
  skills text[] not null default '{}',
  weekly_off_pref int[] not null default '{}',
  offs_per_week int not null default 1,
  max_covers_per_day int not null default 1,
  comp_off_balance int not null default 0,
  active boolean not null default true
);

create table if not exists brands (
  id text primary key,
  name text not null,
  pod_id text references pods(id)
);

create table if not exists services (
  id text primary key,
  brand_id text not null references brands(id) on delete cascade,
  process_id text not null references processes(id),
  shift_id text not null default 'GEN',
  min_staff int not null default 1,
  calendar jsonb not null,            -- { preset, days: [0..6], holidaysOff }
  dow_overrides jsonb not null default '{}',   -- { "6": 2 }
  date_overrides jsonb not null default '{}',  -- { "2026-12-26": 3 }
  active boolean not null default true,
  unique (brand_id, process_id)
);

create table if not exists assignments (
  id text primary key,
  employee_id text not null references employees(id) on delete cascade,
  service_id text not null references services(id) on delete cascade,
  kind text not null default 'primary' check (kind in ('primary', 'backup')),
  unique (employee_id, service_id)
);

create table if not exists holidays (
  id text primary key,
  date date not null,
  name text not null
);

create table if not exists leaves (
  id text primary key,
  employee_id text not null references employees(id) on delete cascade,
  start date not null,
  "end" date,
  type text not null check (type in ('LEAVE', 'COMP', 'UNAV')),
  status text not null default 'approved' check (status in ('approved', 'pending')),
  note text
);

create table if not exists app_settings (
  id text primary key,
  data jsonb not null
);

create table if not exists rosters (
  month text primary key,             -- 'YYYY-MM'
  data jsonb not null,                -- { cells, pins, covers, log, version, published }
  updated_at timestamptz not null default now()
);

-- Demo access policy: the anon key can read and write everything.
-- For production, replace with authenticated policies per role
-- (ops manager: write; pod lead: read own pod + approve leave).
do $$
declare t text;
begin
  foreach t in array array['processes','shifts','pods','employees','brands','services','assignments','holidays','leaves','app_settings','rosters'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists demo_all on %I', t);
    execute format('create policy demo_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
