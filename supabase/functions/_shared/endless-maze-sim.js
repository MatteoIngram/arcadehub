// Deterministic core simulation for endless-maze. Imported unchanged by both
// the browser game module (games/endless-maze/game.js) and the server-side
// Edge Function validator, so there is exactly one source of truth for what
// counts as a legal run.
import { generateMaze, canMove } from './maze-gen.js';
import { findPath } from './astar.js';
import { deriveSeed } from '../../../engine/prng.js';

export const DIR = { N: 'N', S: 'S', E: 'E', W: 'W' };
const DIR_BIT = { N: 1, S: 2, E: 4, W: 8 };
const DIR_DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

// Score is encoded as a single numeric column: levelsCleared dominates,
// totalTicks is the tie-breaker (fewer ticks = better among equal depth).
const TICK_CAP = 999_999; // ~4.6h of sim time at 60Hz; generous, prevents overlap
export function encodeScore(levelsCleared, totalTicks) {
  const clampedTicks = Math.min(totalTicks, TICK_CAP);
  return levelsCleared * 1_000_000 - clampedTicks;
}
export function decodeScore(score) {
  // encodeScore's subtracted term is always in [0, TICK_CAP], so the score for
  // a given depth always falls in (depth-1)*1e6 .. depth*1e6 — recovering depth
  // needs ceil, not floor, or depth 0 (score <= 0) decodes one level too low.
  const levelsCleared = Math.ceil(score / 1_000_000);
  const totalTicks = levelsCleared * 1_000_000 - score;
  return { levelsCleared, totalTicks };
}

// First 10 depths give pursuers 5% less speed as a gentler on-ramp before the
// standard curve takes over. Expressed as cells-per-tick (not ticks-per-cell)
// specifically so a percentage adjustment lands precisely at every depth —
// ticks-per-cell is a small integer here, and a 5% tweak on e.g. 6 or 7 ticks
// rounds away to nothing.
const EARLY_DEPTH_CUTOFF = 10;
const EARLY_DEPTH_SPEED_MULTIPLIER = 0.95;

export function difficultyForDepth(depth) {
  const size = Math.min(9 + depth * 2, 41);
  const baseTicksPerCell = Math.max(14 - depth, 6);
  const baseSpeed = 1 / baseTicksPerCell; // cells per tick
  const pursuerSpeed = depth < EARLY_DEPTH_CUTOFF ? baseSpeed * EARLY_DEPTH_SPEED_MULTIPLIER : baseSpeed;
  return {
    width: size,
    height: size,
    pursuerCount: Math.min(1 + Math.floor(depth / 2), 6),
    playerVisionRadius: Math.max(6 - Math.floor(depth / 4), 3),
    pursuerSpeed,
    recomputeEveryTicks: 30,
    playerMoveCooldownTicks: 9,
  };
}

// How much slack above the optimal route the countdown allows, in multiples
// of shortest-path length. Generous early on, tightens as depth ramps up so
// wandering/backtracking becomes genuinely risky later in a run.
function timeBudgetFactor(depth) {
  return Math.max(8 - depth * 0.2, 3);
}

function bfsDistances(maze, from) {
  const dist = Array.from({ length: maze.height }, () => new Int32Array(maze.width).fill(-1));
  dist[from.y][from.x] = 0;
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const { x, y } of frontier) {
      for (const dir of ['N', 'S', 'E', 'W']) {
        if (!canMove(maze, x, y, DIR_BIT[dir])) continue;
        const [dx, dy] = DIR_DELTA[dir];
        const nx = x + dx, ny = y + dy;
        if (dist[ny][nx] !== -1) continue;
        dist[ny][nx] = dist[y][x] + 1;
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return dist;
}

function spawnPursuers(maze, count, dist) {
  const cells = [];
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      if (x === maze.start.x && y === maze.start.y) continue;
      cells.push({ x, y, d: dist[y][x] });
    }
  }
  cells.sort((a, b) => (b.d - a.d) || (a.y * maze.width + a.x) - (b.y * maze.width + b.x));
  return cells.slice(0, count).map((c) => ({
    x: c.x,
    y: c.y,
    lastKnownTarget: null,
    path: null,
    pathIndex: 0,
    moveProgress: 0,
    lastRecomputeTick: -Infinity,
  }));
}

function buildLevel(seed, depth) {
  const diff = difficultyForDepth(depth);
  const levelSeed = deriveSeed(seed, depth);
  const maze = generateMaze(levelSeed, diff.width, diff.height);
  const dist = bfsDistances(maze, maze.start);

  // Countdown is pegged to the shortest route to the exit, not raw maze area,
  // so it actually pressures the player instead of being a backstop nobody hits.
  const shortestPathLen = dist[maze.exit.y][maze.exit.x];
  const maxTicksPerLevel =
    Math.round(shortestPathLen * diff.playerMoveCooldownTicks * timeBudgetFactor(depth)) +
    diff.playerMoveCooldownTicks * 5;

  return {
    diff: { ...diff, maxTicksPerLevel },
    maze,
    player: { x: maze.start.x, y: maze.start.y, lastMoveTick: -Infinity },
    pursuers: spawnPursuers(maze, diff.pursuerCount, dist),
    ticksThisLevel: 0,
  };
}

export function createRunState(seed) {
  return {
    seed,
    depth: 0,
    level: buildLevel(seed, 0),
    totalTicks: 0,
    alive: true,
    levelsCleared: 0,
  };
}

function tryMovePlayer(state, dir, tick) {
  const { level } = state;
  const { player, maze, diff } = level;
  if (tick - player.lastMoveTick < diff.playerMoveCooldownTicks) return;
  if (!canMove(maze, player.x, player.y, DIR_BIT[dir])) return;
  const [dx, dy] = DIR_DELTA[dir];
  player.x += dx;
  player.y += dy;
  player.lastMoveTick = tick;
}

function advancePursuer(state, pursuer, tick) {
  const { level } = state;
  const { player, maze, diff } = level;

  // Pursuers always know exactly where the player is and recompute a fresh
  // A* route to them on a fixed cadence — no line-of-sight gating.
  pursuer.lastKnownTarget = { x: player.x, y: player.y };

  const dueRecompute =
    tick - pursuer.lastRecomputeTick >= diff.recomputeEveryTicks || pursuer.path === null;

  if (dueRecompute) {
    pursuer.path = findPath(maze, { x: pursuer.x, y: pursuer.y }, pursuer.lastKnownTarget);
    pursuer.pathIndex = 0;
    pursuer.lastRecomputeTick = tick;
  }

  if (!pursuer.path || pursuer.pathIndex >= pursuer.path.length - 1) return;

  // Fractional speed accumulator: banks pursuerSpeed cells' worth of progress
  // each tick and steps once it crosses 1, so speed changes apply exactly
  // regardless of magnitude (no integer-tick rounding loss).
  pursuer.moveProgress += diff.pursuerSpeed;
  if (pursuer.moveProgress < 1) return;
  pursuer.moveProgress -= 1;

  pursuer.pathIndex += 1;
  const step = pursuer.path[pursuer.pathIndex];
  pursuer.x = step.x;
  pursuer.y = step.y;
}

function checkCaught(level) {
  return level.pursuers.some((p) => p.x === level.player.x && p.y === level.player.y);
}

// Advances the simulation by exactly one fixed tick. `move` is null or one of DIR.
// Returns the run state (mutated in place) — caller checks `state.alive`.
export function stepRun(state, move, tick) {
  if (!state.alive) return state;
  const { level } = state;

  if (move) tryMovePlayer(state, move, tick);
  if (checkCaught(level)) {
    state.alive = false;
    return state;
  }

  for (const pursuer of level.pursuers) {
    advancePursuer(state, pursuer, tick);
  }
  if (checkCaught(level)) {
    state.alive = false;
    return state;
  }

  level.ticksThisLevel += 1;
  state.totalTicks += 1;

  if (level.player.x === level.maze.exit.x && level.player.y === level.maze.exit.y) {
    state.depth += 1;
    state.levelsCleared += 1;
    state.level = buildLevel(state.seed, state.depth);
  } else if (level.ticksThisLevel >= level.diff.maxTicksPerLevel) {
    state.alive = false; // timed out
  }

  return state;
}

// Replays a full ordered input log from tick 0. Each entry: { tick, dir }.
// Used both by the client (for the definitive game state) and the Edge
// Function validator (to recompute the claimed score independently).
export function simulateRun(seed, inputs) {
  const state = createRunState(seed);
  const sorted = [...inputs].sort((a, b) => a.tick - b.tick);
  let cursor = 0;
  let tick = 0;
  const HARD_TICK_LIMIT = 2_000_000; // safety valve against malformed/huge logs

  // A real run only ever ends via `state.alive` flipping false (caught, or the
  // per-level timeout), so replaying to that same condition reproduces exactly
  // what the client saw — no separate "ran out of inputs" case needed.
  while (state.alive && tick <= HARD_TICK_LIMIT) {
    let move = null;
    while (cursor < sorted.length && sorted[cursor].tick === tick) {
      move = sorted[cursor].dir;
      cursor += 1;
    }
    stepRun(state, move, tick);
    tick += 1;
  }

  return {
    levelsCleared: state.levelsCleared,
    totalTicks: state.totalTicks,
    died: !state.alive,
    score: encodeScore(state.levelsCleared, state.totalTicks),
  };
}
