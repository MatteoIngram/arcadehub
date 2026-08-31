-- Leaderboard table. Reads happen directly from the browser with the anon
-- key; writes only ever happen from the submit-score Edge Function using the
-- service-role key, which bypasses RLS — so there is deliberately no
-- INSERT/UPDATE/DELETE policy for anon/authenticated roles below.
create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  game text not null,
  name text not null,
  score numeric not null,
  seed text not null,
  inputs jsonb not null,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists scores_game_score_idx on scores (game, score);

-- One row per (game, device) — the Edge Function only inserts a device's
-- first row and updates it in place on later runs, and only when the new
-- score actually beats the stored one. Partial (excludes NULLs) so rows from
-- before device_id existed don't collide with each other.
create unique index if not exists scores_game_device_unique
  on scores (game, device_id)
  where device_id is not null;

-- Defense in depth: the Edge Function already blocks these (see
-- engine/profanity.js, the actual source of truth), but this constraint
-- rejects them even on a direct/admin insert that bypassed that check.
alter table scores add constraint scores_name_no_profanity
  check (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) !~ '(fuck|shit|bitch|asshole|bastard|dickhead|piss|cunt|whore|slut|faggot|retard|nigger|nigga|chink|spic|kike|tranny|rape|nazi|hitler)');

alter table scores enable row level security;

create policy "Public read access"
  on scores
  for select
  using (true);

-- Per-IP, per-game submission counters used by the Edge Function's rate
-- limiter. Not exposed to the client at all (no RLS policies => only the
-- service-role key, used server-side, can touch it).
create table if not exists submit_rate_limit (
  ip text not null,
  game text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (ip, game, window_start)
);

alter table submit_rate_limit enable row level security;
