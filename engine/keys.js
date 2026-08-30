// Shared WASD/arrow-key -> direction mapping. Checks e.code first (layout
// independent) and falls back to e.key (some input sources — virtual
// keyboards, certain automation/assistive tooling — only populate `key`).
const CODE_TO_DIR = {
  KeyW: 'N', ArrowUp: 'N',
  KeyS: 'S', ArrowDown: 'S',
  KeyA: 'W', ArrowLeft: 'W',
  KeyD: 'E', ArrowRight: 'E',
};

const KEY_TO_DIR = {
  w: 'N', arrowup: 'N',
  s: 'S', arrowdown: 'S',
  a: 'W', arrowleft: 'W',
  d: 'E', arrowright: 'E',
};

export function dirFromKeyboardEvent(e) {
  return CODE_TO_DIR[e.code] ?? KEY_TO_DIR[e.key?.toLowerCase()] ?? null;
}
