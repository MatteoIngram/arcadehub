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



