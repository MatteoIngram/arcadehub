// Thin wrapper around the Supabase JS client — the hub's one dependency.
// Reads (leaderboards) go straight to Postgres via the public anon key under
// RLS that only allows SELECT. Writes always go through the `submit-score`
// Edge Function, which re-simulates the run server-side before inserting.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fill these in with your own project's values (Project Settings > API).
// The anon key is safe to ship in client code — it can only do what your
// RLS policies allow (see supabase/schema.sql).
const SUPABASE_URL = 'https://luxrqwbdqjsqvpufziwz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pWY4ZezMXRY0vHrz_ub7Ag_A6-1c3zD';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEVICE_ID_KEY = 'arcade:deviceId';

// A persistent anonymous id for this browser, so the leaderboard can keep one
// row per player (updated only when beaten) instead of a row per run. Not
// tied to any identity beyond "this browser" — clearing storage or switching
// devices starts a fresh entry, same as any no-login leaderboard.
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function getTopScores(game, scoreOrder, limit = 100) {
  const { data, error } = await supabase
    .from('scores')
    .select('name, score, created_at')
    .eq('game', game)
    .order('score', { ascending: scoreOrder === 'asc' })
    .limit(limit);
  if (error) {
    console.error('getTopScores failed', error);
    return [];
  }
  return data;
}

export async function submitScore({ game, name, seed, inputs, claimedScore }) {
  const { data, error } = await supabase.functions.invoke('submit-score', {
    body: { game, name, seed, inputs, claimedScore, deviceId: getDeviceId() },
  });
  if (error) {
    console.error('submitScore failed', error);
    return { ok: false, reason: error.message };
  }
  return data; // { ok: true, rank, improved, bestScore } or { ok: false, reason }
}
