// Recursive-backtracker maze generator. Pure function of (seed, width, height) —
// used identically by the client renderer and the server-side replay validator.
import { mulberry32 } from '../../../engine/prng.js';

// Wall bits per cell.
export const N = 1, S = 2, E = 4, W = 8;
const OPPOSITE = { [N]: S, [S]: N, [E]: W, [W]: E };
const DIRS = [
  [N, 0, -1],
  [S, 0, 1],
  [E, 1, 0],
  [W, -1, 0],
];

// A pure recursive-backtracker maze is a spanning tree: exactly one route
// between any two cells. With a pursuer that always beelines for the player,
// that means a single pursuer standing on that one route can seal off the
// exit completely — mathematically unsolvable, not just hard. Braiding knocks
// down extra walls at dead ends to add loops, so there's always another way
// around a blocker.
const BRAID_FACTOR = 0.55;

function popcount4(mask) {
  let c = 0;
  if (mask & N) c++;
  if (mask & S) c++;
  if (mask & E) c++;
  if (mask & W) c++;
  return c;
}

function braid(cells, width, height, rand, factor) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (popcount4(cells[y][x]) !== 1) continue; // only touch dead ends
      if (rand() >= factor) continue;
      const candidates = [];
      for (const [bit, dx, dy] of DIRS) {
        if (cells[y][x] & bit) continue; // already open that way
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        candidates.push({ bit, nx, ny });
      }
      if (candidates.length === 0) continue;
      const { bit, nx, ny } = candidates[Math.floor(rand() * candidates.length)];
      cells[y][x] |= bit;
      cells[ny][nx] |= OPPOSITE[bit];
    }
  }
}

export function generateMaze(seed, width, height) {
  const rand = mulberry32(seed);
  // cells[y][x] holds a bitmask of OPEN passages (not walls) in each direction.
  const cells = Array.from({ length: height }, () => new Uint8Array(width));
  const visited = Array.from({ length: height }, () => new Uint8Array(width));

  function carve(x, y) {
    visited[y][x] = 1;
    // Deterministic shuffle of the 4 directions using the seeded PRNG.
    const dirs = DIRS.slice();
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const [bit, dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (visited[ny][nx]) continue;
      cells[y][x] |= bit;
      cells[ny][nx] |= OPPOSITE[bit];
      carve(nx, ny);
    }
  }

  carve(0, 0);
  braid(cells, width, height, rand, BRAID_FACTOR);

  return {
    width,
    height,
    cells, // cells[y][x] bitmask of open directions
    start: { x: 0, y: 0 },
    exit: { x: width - 1, y: height - 1 },
  };
}

export function canMove(maze, x, y, dir) {
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return false;
  return (maze.cells[y][x] & dir) !== 0;
}

export function neighborsOf(maze, x, y) {
  const out = [];
  for (const [bit, dx, dy] of DIRS) {
    if (maze.cells[y][x] & bit) out.push({ x: x + dx, y: y + dy, dir: bit });
  }
  return out;
}

// All cells reachable from (x,y) within `radius` corridor-steps (BFS respecting
// walls, not Euclidean distance). Used for fog-of-war rendering.
export function visibleCellsFrom(maze, x, y, radius) {
  const key = (cx, cy) => cy * maze.width + cx;
  const seen = new Map([[key(x, y), 0]]);
  let frontier = [{ x, y, d: 0 }];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      if (cur.d >= radius) continue;
      for (const nb of neighborsOf(maze, cur.x, cur.y)) {
        const k = key(nb.x, nb.y);
        if (seen.has(k)) continue;
        seen.set(k, cur.d + 1);
        next.push({ x: nb.x, y: nb.y, d: cur.d + 1 });
      }
    }
    frontier = next;
  }
  return seen; // Map of "cellKey" -> corridor-distance
}
