// Central game registry. Adding a game to the hub is exactly two steps:
//   1. Implement the module contract (see README) under games/<id>/game.js
//   2. Append one { id, load } entry below.
// Nothing else in the hub needs to change — cards, leaderboards, controls
// overlays, and mobile input are all driven off each module's own `meta`
// export and its start/pause/resume/destroy instance.
export const manifest = [
  { id: 'endless-maze', load: () => import('./games/endless-maze/game.js') },

  // Future modules drop in the same way, e.g.:
  // { id: 'grapple-swinger', load: () => import('./games/grapple-swinger/game.js') },
];
