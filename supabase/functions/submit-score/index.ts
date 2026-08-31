// Edge Function: the only path that can write to `scores`. Re-runs the same
// deterministic simulation the browser used (imported from _shared/, the
// exact same files the client bundles) and only inserts a row if the
// recomputed score matches what the client claimed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { simulateRun as simulateMazeRun } from '../_shared/endless-maze-sim.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;
const MAX_INPUT_EVENTS = 200_000; // sanity cap against malformed/abusive payloads
const MAX_NAME_LENGTH = 16;
const MAX_DEVICE_ID_LENGTH = 64;

// Mirrors each game module's `meta.scoreOrder` — duplicated here since the
// Edge Function doesn't load client game modules, only the shared sim code.
const GAME_SCORE_ORDER = {
  'endless-maze': 'desc',
};

const VALIDATORS = {
  'endless-maze': (seed, inputs) => {
    const result = simulateMazeRun(seed, inputs);
    return { score: result.score };
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function clientIp(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

async function checkRateLimit(admin, ip, game) {
  const windowStart = new Date(Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS).toISOString();

  const { data: existing } = await admin
    .from('submit_rate_limit')
    .select('count')
    .eq('ip', ip)
    .eq('game', game)
    .eq('window_start', windowStart)
    .maybeSingle();

  if (existing && existing.count >= RATE_LIMIT_MAX_PER_WINDOW) {
    return false;
  }

  await admin
    .from('submit_rate_limit')
    .upsert(
      { ip, game, window_start: windowStart, count: (existing?.count || 0) + 1 },
      { onConflict: 'ip,game,window_start' }
    );

  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'invalid JSON body' }, 400);
  }

  const { game, name, seed, inputs, claimedScore, deviceId } = body ?? {};

  const validator = VALIDATORS[game];
  if (!validator) return json({ ok: false, reason: `unknown game "${game}"` }, 400);
  if (typeof seed !== 'string' || !seed) return json({ ok: false, reason: 'missing seed' }, 400);
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUT_EVENTS) {
    return json({ ok: false, reason: 'invalid input log' }, 400);
  }
  if (typeof claimedScore !== 'number' || !Number.isFinite(claimedScore)) {
    return json({ ok: false, reason: 'invalid claimed score' }, 400);
  }
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > MAX_DEVICE_ID_LENGTH) {
    return json({ ok: false, reason: 'missing device id' }, 400);
  }
  const safeName = (typeof name === 'string' ? name.trim() : '').slice(0, MAX_NAME_LENGTH) || 'Anonymous';

  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  const ip = clientIp(req);
  const allowed = await checkRateLimit(admin, ip, game);
  if (!allowed) return json({ ok: false, reason: 'rate limit exceeded, try again shortly' }, 429);

  let outcome;
  try {
    outcome = validator(seed, inputs);
  } catch (err) {
    return json({ ok: false, reason: `simulation error: ${err.message}` }, 400);
  }

  if (outcome.rejected) return json({ ok: false, reason: outcome.rejected }, 400);

  const TOLERANCE = 0; // sim is deterministic integer math — exact match expected
  if (Math.abs(outcome.score - claimedScore) > TOLERANCE) {
    return json({ ok: false, reason: 'recomputed score does not match claimed score' }, 400);
  }

  const order = GAME_SCORE_ORDER[game];
  const isBetter = (a, b) => (order === 'asc' ? a < b : a > b);

  // One row per (game, deviceId): keep whichever run scored best rather than
  // logging every single submission from the same player.
  const { data: existing, error: fetchError } = await admin
    .from('scores')
    .select('score')
    .eq('game', game)
    .eq('device_id', deviceId)
    .maybeSingle();

  if (fetchError) return json({ ok: false, reason: 'database read failed' }, 500);

  let bestScore = outcome.score;
  let improved = true;

  if (existing) {
    if (isBetter(outcome.score, existing.score)) {
      const { error } = await admin
        .from('scores')
        .update({ name: safeName, score: outcome.score, seed, inputs, created_at: new Date().toISOString() })
        .eq('game', game)
        .eq('device_id', deviceId);
      if (error) return json({ ok: false, reason: 'database update failed' }, 500);
    } else {
      improved = false;
      bestScore = existing.score;
    }
  } else {
    const { error } = await admin.from('scores').insert({
      game,
      name: safeName,
      score: outcome.score,
      seed,
      inputs,
      device_id: deviceId,
    });
    if (error) return json({ ok: false, reason: 'database insert failed' }, 500);
  }

  const { count } = await admin
    .from('scores')
    .select('*', { count: 'exact', head: true })
    .eq('game', game)
    .filter('score', order === 'asc' ? 'lt' : 'gt', bestScore);
  const rank = (count ?? 0) + 1;

  return json({ ok: true, score: outcome.score, bestScore, improved, rank });
});
