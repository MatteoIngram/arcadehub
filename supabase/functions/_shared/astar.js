// Deterministic A* over the maze grid. Tie-breaks by cell index (y*width+x) so
// two runs given the same maze and goal always produce the identical path —
// required for replay-based validation to work.
import { neighborsOf } from './maze-gen.js';

function cellKey(x, y, width) {
  return y * width + x;
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < a.length && this._less(a[l], a[smallest])) smallest = l;
        if (r < a.length && this._less(a[r], a[smallest])) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }
  _less(a, b) {
    if (a.f !== b.f) return a.f < b.f;
    return a.key < b.key; // deterministic tie-break by cell index
  }
}

export function findPath(maze, start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [{ ...start }];

  const startKey = cellKey(start.x, start.y, maze.width);
  const goalKey = cellKey(goal.x, goal.y, maze.width);

  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const heap = new MinHeap();
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  heap.push({ key: startKey, x: start.x, y: start.y, f: h(start.x, start.y) });
  const closed = new Set();

  while (heap.size) {
    const cur = heap.pop();
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);

    if (cur.key === goalKey) {
      const path = [{ x: cur.x, y: cur.y }];
      let k = cur.key;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k);
        const y = Math.floor(k / maze.width);
        const x = k % maze.width;
        path.push({ x, y });
      }
      path.reverse();
      return path;
    }

    for (const nb of neighborsOf(maze, cur.x, cur.y)) {
      const nk = cellKey(nb.x, nb.y, maze.width);
      if (closed.has(nk)) continue;
      const tentativeG = gScore.get(cur.key) + 1;
      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentativeG);
        cameFrom.set(nk, cur.key);
        heap.push({ key: nk, x: nb.x, y: nb.y, f: tentativeG + h(nb.x, nb.y) });
      }
    }
  }
  return null; // unreachable (shouldn't happen in a fully-connected maze)
}
