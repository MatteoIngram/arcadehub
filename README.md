# Arcade Hub

Self-contained, zero-framework browser arcade. Vanilla HTML5 Canvas + JS, the
only dependency is the Supabase JS client (loaded via ESM CDN import, no
bundler needed). Host on GitHub Pages, iframe it anywhere.

## Layout

```
index.html / style.css / hub.js   – the hub shell (menu, leaderboard, modal)
theme.js                          – single place to re-skin colors/fonts
manifest.js                       – registry of game modules
supabaseClient.js                 – Supabase client, leaderboard reads, score submits

engine/
  prng.js                         – mulberry32 seeded PRNG + seed derivation
  loop.js                         – fixed 60Hz timestep loop

games/<id>/game.js                – one file per game, implements the module contract
games/<id>/thumbnail.svg

supabase/
  schema.sql                      – `scores` table + RLS + rate-limit table
  functions/
    _shared/                      – deterministic sim code (maze gen, A*, pursuer
                                     AI) — imported unchanged by both the browser
                                     game and the validator
    submit-score/index.ts         – Edge Function: replays the run, rejects
                                     mismatches, inserts on success
```

## Game module contract

Every game exports:

```js
export const meta = {
  id, title, description, thumbnail, controlsHelp,
  scoreLabel, scoreOrder, // 'desc' | 'asc'
};
export function createGame({ canvas, ctx, seed, theme, isMobile, onGameOver }) {
  return { start(), pause(), resume(), destroy() };
}
export function formatScore(score) { /* optional: human-friendly display */ }
```

The game calls `onGameOver({ score, inputs })` exactly once, where `inputs` is
the full tick-stamped input log for the run. To add a game: implement this
contract under `games/<id>/game.js`, then append `{ id, load: () =>
import('./games/<id>/game.js') }` to `manifest.js`. Nothing else changes.

## Determinism

All games are built on `engine/prng.js` (mulberry32) and `engine/loop.js`
(fixed 60Hz timestep) — never `Math.random()`, never frame-rate-dependent
logic. That's what makes `seed + inputs` fully sufficient to replay a run,
which is the entire basis for server-side score validation.

## Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in the SQL editor (creates `scores` with public
   read-only RLS, plus a `submit_rate_limit` table used only server-side).
3. In `supabaseClient.js`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` from
   Project Settings → API.
4. Install the Supabase CLI, then from the repo root:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy submit-score
   ```
   The function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
   environment Supabase injects automatically — no manual secrets needed.

   Note: `_shared/` imports reach up to `/engine/prng.js` at the repo root so
   the client and the validator share one copy. If your Supabase CLI version
   refuses to bundle imports from outside `supabase/functions/`, copy
   `engine/prng.js` into `supabase/functions/_shared/` and adjust the import
   lines in `_shared/maze-gen.js` and `_shared/endless-maze-sim.js` accordingly.

## Running locally

Any static file server works, e.g.:
```bash
npx serve .
```
Then open the printed URL. (Opening `index.html` directly via `file://` will
not work — ES module imports require an http(s) origin.)

## Deploying

Push to GitHub, enable GitHub Pages on the repo (serve from root), then embed
via `<iframe src="https://you.github.io/arcade-hub/">`.

## Launch games

- **Endless Maze** (`endless-maze`) — procedurally generated maze, descend
  forever, fog-of-war vision, A* pursuers that always know exactly where you
  are and path straight for you. Each level has a hard countdown pegged to
  the shortest route to the exit. Score = depth reached, tie-broken by
  fewest ticks.
