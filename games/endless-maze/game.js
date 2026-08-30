// Endless Maze with A* pursuers — client game module.
// Rendering/input only; all rules live in the shared deterministic sim so the
// server-side validator can replay this run bit-for-bit from seed + inputs.
import { createFixedTimestepLoop, TICK_MS } from '../../engine/loop.js';
import {
  createRunState,
  stepRun,
  encodeScore,
  decodeScore,
} from '../../supabase/functions/_shared/endless-maze-sim.js';
import { visibleCellsFrom } from '../../supabase/functions/_shared/maze-gen.js';
import { dirFromKeyboardEvent } from '../../engine/keys.js';

export const meta = {
  id: 'endless-maze',
  title: 'Endless Maze',
  description: 'Descend a procedurally generated maze forever. Fog-of-war hides the map; A* pursuers always know exactly where you are and will path straight for you.',
  thumbnail: 'games/endless-maze/thumbnail.svg',
  controlsHelp: 'WASD / Arrow keys to move. Touch: on-screen D-pad. Reach the exit before pursuers catch you or the clock runs out.',
  scoreLabel: 'Depth reached',
  scoreOrder: 'desc',
};

// Optional display hook: the hub shows this instead of the raw encoded score
// (score = levelsCleared*1e6 - totalTicks, so it sorts correctly but isn't
// human-friendly on its own).
export function formatScore(score) {
  const { levelsCleared } = decodeScore(score);
  return `Depth ${levelsCleared}`;
}

export function createGame({ canvas, ctx, seed, theme, isMobile, onGameOver }) {
  let state = createRunState(seed);
  const inputs = [];
  let pendingMove = null;
  let loop = null;
  let dpadEl = null;
  let ended = false;

  function keydown(e) {
    if (ended) return; // run is over — let keys reach the name-entry field normally
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
    const dir = dirFromKeyboardEvent(e);
    if (dir) {
      pendingMove = dir;
      e.preventDefault();
    }
  }

  function setupMobileControls() {
    dpadEl = document.createElement('div');
    dpadEl.className = 'arcade-dpad';
    dpadEl.innerHTML = `
      <button data-dir="N" class="dpad-n">▲</button>
      <button data-dir="W" class="dpad-w">◀</button>
      <button data-dir="E" class="dpad-e">▶</button>
      <button data-dir="S" class="dpad-s">▼</button>
    `;
    dpadEl.addEventListener('touchstart', onDpadPress, { passive: false });
    dpadEl.addEventListener('mousedown', onDpadPress);
    canvas.parentElement.appendChild(dpadEl);
  }

  function onDpadPress(e) {
    const btn = e.target.closest('button[data-dir]');
    if (!btn) return;
    e.preventDefault();
    pendingMove = btn.dataset.dir;
  }

  function update(tick) {
    if (ended) return;
    const move = pendingMove;
    pendingMove = null;
    if (move) inputs.push({ tick, dir: move });
    stepRun(state, move, tick);
    if (!state.alive) {
      ended = true;
      loop.stop();
      onGameOver({
        score: encodeScore(state.levelsCleared, state.totalTicks),
        inputs: inputs.slice(),
      });
    }
  }

  function render() {
    const { level } = state;
    const { maze, player, pursuers, diff } = level;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, w, h);

    const cellPx = isMobile ? 20 : 26;
    ctx.save();
    ctx.translate(w / 2 - (player.x + 0.5) * cellPx, h / 2 - (player.y + 0.5) * cellPx);

    const visible = visibleCellsFrom(maze, player.x, player.y, diff.playerVisionRadius);

    // Walls render lighter than the player/pursuers so the "nodes" (filled
    // circles) always read clearly against the "edges" (thin wall lines) —
    // matters more now that the palette is near-monochrome.
    ctx.strokeStyle = theme.textMuted || theme.accent;
    ctx.lineWidth = Math.max(1.5, cellPx * 0.06);
    ctx.lineCap = 'round';
    for (const [key] of visible) {
      const y = Math.floor(key / maze.width);
      const x = key % maze.width;
      const cx = x * cellPx;
      const cy = y * cellPx;
      const cell = maze.cells[y][x];
      ctx.beginPath();
      if (!(cell & 1)) { ctx.moveTo(cx, cy); ctx.lineTo(cx + cellPx, cy); } // N wall
      if (!(cell & 2)) { ctx.moveTo(cx, cy + cellPx); ctx.lineTo(cx + cellPx, cy + cellPx); } // S wall
      if (!(cell & 4)) { ctx.moveTo(cx + cellPx, cy); ctx.lineTo(cx + cellPx, cy + cellPx); } // E wall
      if (!(cell & 8)) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + cellPx); } // W wall
      ctx.stroke();

      if (x === maze.exit.x && y === maze.exit.y) {
        ctx.fillStyle = theme.exit || '#4a6b52';
        ctx.fillRect(cx + cellPx * 0.25, cy + cellPx * 0.25, cellPx * 0.5, cellPx * 0.5);
      }
    }

    for (const p of pursuers) {
      const k = p.y * maze.width + p.x;
      if (!visible.has(k)) continue;
      ctx.fillStyle = theme.danger || '#a8433c';
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * cellPx, (p.y + 0.5) * cellPx, cellPx * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = theme.player || '#0f0f0f';
    ctx.beginPath();
    ctx.arc((player.x + 0.5) * cellPx, (player.y + 0.5) * cellPx, cellPx * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    ctx.font = '13px ' + (theme.fontMono || theme.font || 'monospace');
    ctx.fillStyle = theme.text || '#0f0f0f';
    ctx.fillText(`DEPTH ${state.levelsCleared}`, 12, 22);

    const remainingTicks = level.diff.maxTicksPerLevel - level.ticksThisLevel;
    const remainingSec = Math.max(remainingTicks * TICK_MS / 1000, 0);
    ctx.fillStyle = remainingSec <= 5 ? (theme.danger || '#a8433c') : (theme.textMuted || theme.text || '#0f0f0f');
    ctx.fillText(`TIME ${remainingSec.toFixed(1)}s`, 12, 40);
  }

  return {
    start() {
      loop = createFixedTimestepLoop({ update, render });
      window.addEventListener('keydown', keydown);
      if (isMobile) setupMobileControls();
      loop.start();
    },
    pause() {
      loop?.stop();
    },
    resume() {
      loop?.start();
    },
    destroy() {
      loop?.stop();
      window.removeEventListener('keydown', keydown);
      dpadEl?.remove();
    },
  };
}
