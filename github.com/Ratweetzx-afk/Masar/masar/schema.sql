-- ============================================================
-- مسار (Masar) — Supabase Schema
-- Run this once in Supabase → SQL Editor → New Query → Run
-- ============================================================

-- ── Flight board cache ───────────────────────────────────────
-- One row per airport. Overwritten by the daily refresh function.
-- This is what makes the site cost ZERO extra API calls per
-- visitor — everyone reads this cached row, only the scheduled
-- refresh function talks to AeroDataBox.
create table if not exists flights_cache (
  airport_code text primary key,        -- 'JED' | 'RUH' | 'DMM'
  data jsonb not null,                  -- raw sanitized flight list
  fetched_at timestamptz not null default now()
);

-- ── Marketing banner (admin-managed) ─────────────────────────
create table if not exists banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  link_url text,
  is_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Admin credentials + atomic brute-force lockout ───────────
-- Single-row table (one admin). Password is never stored in
-- plaintext — only a salted scrypt hash (Node's built-in crypto,
-- no external dependency, no cost).
create table if not exists admin_auth (
  id int primary key default 1,
  password_hash text not null,
  password_salt text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- ── Per-IP rate limiting (search + admin-login endpoints) ────
-- Generic sliding-window counter table, reused by every
-- rate-limited function via the atomic RPC below.
create table if not exists rate_limits (
  bucket_key text primary key,          -- e.g. 'search:203.0.113.4'
  count int not null default 0,
  window_start timestamptz not null default now()
);

-- ── Atomic rate-limit check (prevents race conditions) ───────
-- A single SQL statement does read+increment+decide, so two
-- concurrent serverless invocations for the same IP can never
-- both "win" a race and slip past the limit.
create or replace function check_rate_limit(
  p_key text,
  p_max_requests int,
  p_window_seconds int
) returns boolean as $$
declare
  v_allowed boolean;
begin
  insert into rate_limits as rl (bucket_key, count, window_start)
  values (p_key, 1, now())
  on conflict (bucket_key) do update
    set count = case
          when rl.window_start < now() - (p_window_seconds || ' seconds')::interval
            then 1  -- window expired, reset
          else rl.count + 1
        end,
        window_start = case
          when rl.window_start < now() - (p_window_seconds || ' seconds')::interval
            then now()
          else rl.window_start
        end
  returning (rl.count <= p_max_requests) into v_allowed;

  return v_allowed;
end;
$$ language plpgsql;

-- ── Atomic admin-lockout check + increment ───────────────────
-- Same principle: one atomic statement per branch, no
-- read-then-write race — the row lock (FOR UPDATE) plus a single
-- UPDATE per call means two concurrent invocations can never both
-- read stale attempt counts and both proceed.
create or replace function register_login_attempt(p_success boolean)
returns table(is_locked boolean, locked_until timestamptz, attempts int) as $$
declare
  v_current_locked_until timestamptz;
  v_current_attempts int;
  v_new_attempts int;
  v_new_locked_until timestamptz;
begin
  select a.locked_until, a.failed_attempts
    into v_current_locked_until, v_current_attempts
    from admin_auth a where a.id = 1
    for update; -- row lock held until transaction end

  if v_current_locked_until is not null and v_current_locked_until > now() then
    return query select true, v_current_locked_until, v_current_attempts;
    return;
  end if;

  if p_success then
    update admin_auth set failed_attempts = 0, locked_until = null, updated_at = now()
      where id = 1;
    return query select false, null::timestamptz, 0;
    return;
  end if;

  v_new_attempts := v_current_attempts + 1;
  v_new_locked_until := case when v_new_attempts >= 5 then now() + interval '15 minutes' else null end;

  update admin_auth
    set failed_attempts = v_new_attempts,
        locked_until = v_new_locked_until,
        updated_at = now()
    where id = 1;

  return query select (v_new_locked_until is not null), v_new_locked_until, v_new_attempts;
end;
$$ language plpgsql;

-- ── Row Level Security ────────────────────────────────────────
-- Public (anon key, used by the browser — but browser never
-- talks to Supabase directly in this design, only Netlify
-- Functions do via the service key, which bypasses RLS anyway).
-- RLS is enabled regardless as defense-in-depth in case a key
-- is ever exposed by mistake.
alter table flights_cache enable row level security;
alter table banners enable row level security;
alter table admin_auth enable row level security;
alter table rate_limits enable row level security;

-- No public policies are created — meaning the anon key can
-- read/write NOTHING on any of these tables. Only the service
-- role key (used exclusively server-side in Netlify Functions,
-- never shipped to the browser) can access them.

-- ── Seed: set the initial admin password ─────────────────────
-- IMPORTANT: run scripts/hash-password.js locally first (see
-- README) to generate a hash+salt for YOUR chosen password, then
-- replace the placeholders below before running this line.
-- insert into admin_auth (id, password_hash, password_salt)
-- values (1, 'REPLACE_WITH_GENERATED_HASH', 'REPLACE_WITH_GENERATED_SALT')
-- on conflict (id) do update set password_hash = excluded.password_hash,
--                                password_salt = excluded.password_salt;
