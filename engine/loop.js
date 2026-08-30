// Fixed-timestep game loop (60Hz logic), decoupled from render framerate.
// Every game drives its simulation through this so runs are frame-rate independent
// and therefore reproducible from seed + inputs.

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

export function createFixedTimestepLoop({ update, render, maxCatchupTicks = 10 }) {
  let rafId = null;
  let lastTime = 0;
  let accumulator = 0;
  let tick = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    let delta = now - lastTime;
    lastTime = now;
    if (delta > 250) delta = 250; // clamp huge gaps (tab backgrounded)
    accumulator += delta;

    let ticksThisFrame = 0;
    while (accumulator >= TICK_MS) {
      update(tick);
      tick += 1;
      accumulator -= TICK_MS;
      ticksThisFrame += 1;
      if (ticksThisFrame >= maxCatchupTicks) {
        accumulator = 0;
        break;
      }
    }

    render(accumulator / TICK_MS, tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTime = performance.now();
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    get currentTick() {
      return tick;
    },
    reset() {
      tick = 0;
      accumulator = 0;
    },
  };
}
