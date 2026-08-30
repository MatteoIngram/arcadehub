import { manifest } from './manifest.js';
import { theme } from './theme.js';
import { getTopScores, submitScore } from './supabaseClient.js';
import { dailySeedString } from './engine/prng.js';

const els = {
  grid: document.getElementById('game-grid'),
  menuView: document.getElementById('menu-view'),
  gameView: document.getElementById('game-view'),
  gameTitle: document.getElementById('game-title'),
  backBtn: document.getElementById('back-btn'),
  controlsBtn: document.getElementById('controls-btn'),
  controlsOverlay: document.getElementById('controls-overlay'),
  canvas: document.getElementById('game-canvas'),
  stage: document.getElementById('game-stage'),
  leaderboardList: document.getElementById('leaderboard-list'),
  nameModal: document.getElementById('name-modal'),
  summary: document.getElementById('game-over-summary'),
  nameInput: document.getElementById('name-input'),
  submitBtn: document.getElementById('submit-score-btn'),
  skipBtn: document.getElementById('skip-submit-btn'),
};

const ctx = els.canvas.getContext('2d');
const isMobile = matchMedia('(max-width: 768px), (pointer: coarse)').matches;

const modules = new Map(); // id -> { meta, createGame, formatScore }
let activeGame = null;
let activeMeta = null;
let activeSeed = null;
let pendingRunResult = null;

document.documentElement.style.setProperty('--accent', theme.accent);
document.documentElement.style.setProperty('--bg', theme.background);
document.documentElement.style.setProperty('--surface', theme.surface);
document.documentElement.style.setProperty('--text', theme.text);
document.documentElement.style.setProperty('--text-muted', theme.textMuted);
document.documentElement.style.setProperty('--font', theme.font);

function localBestKey(id) {
  return `arcade:best:${id}`;
}

function readLocalBest(id) {
  const raw = localStorage.getItem(localBestKey(id));
  return raw === null ? null : Number(raw);
}

function writeLocalBestIfBetter(id, score, scoreOrder) {
  const prev = readLocalBest(id);
  const better = prev === null || (scoreOrder === 'desc' ? score > prev : score < prev);
  if (better) localStorage.setItem(localBestKey(id), String(score));
  return better;
}

async function loadAllModules() {
  await Promise.all(
    manifest.map(async (entry) => {
      const mod = await entry.load();
      modules.set(entry.id, {
        meta: mod.meta,
        createGame: mod.createGame,
        formatScore: mod.formatScore || ((s) => String(s)),
      });
    })
  );
}

function makeSeed(meta) {
  if (meta.dailySeed) return dailySeedString();
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function renderMenu() {
  els.grid.innerHTML = '';
  for (const entry of manifest) {
    const { meta, formatScore } = modules.get(entry.id);
    const card = document.createElement('div');
    card.className = 'game-card';
    card.innerHTML = `
      <img class="game-thumb" src="${meta.thumbnail}" alt="${meta.title}" />
      <div class="game-card-body">
        <h3>${meta.title}</h3>
        <p>${meta.description}</p>
        <div class="game-card-stats">
          <span class="stat-local">Your best: —</span>
          <span class="stat-global">Global #1: —</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => selectGame(entry.id));
    els.grid.appendChild(card);

    const localBest = readLocalBest(entry.id);
    if (localBest !== null) {
      card.querySelector('.stat-local').textContent = `Your best: ${formatScore(localBest)}`;
    }
    getTopScores(entry.id, meta.scoreOrder, 1).then(([top]) => {
      card.querySelector('.stat-global').textContent = top
        ? `Global #1: ${formatScore(top.score)} (${top.name})`
        : 'Global #1: —';
    });
  }
}

function resizeCanvas() {
  const rect = els.stage.getBoundingClientRect();
  els.canvas.width = Math.floor(rect.width);
  els.canvas.height = Math.floor(rect.height);
}

async function refreshLeaderboardPanel() {
  const { meta, formatScore } = modules.get(activeMeta.id);
  const rows = await getTopScores(meta.id, meta.scoreOrder, 100);
  els.leaderboardList.innerHTML = rows
    .map((r, i) => `<li><span class="rank">${i + 1}</span><span class="name">${escapeHtml(r.name)}</span><span class="score">${formatScore(r.score)}</span></li>`)
    .join('') || '<li class="empty">No scores yet — be the first.</li>';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function selectGame(id) {
  const { meta, createGame } = modules.get(id);
  activeMeta = meta;
  activeSeed = makeSeed(meta);

  els.menuView.hidden = true;
  els.gameView.hidden = false;
  els.gameTitle.textContent = meta.title;
  els.controlsOverlay.textContent = meta.controlsHelp;
  els.controlsOverlay.hidden = true;

  resizeCanvas();
  refreshLeaderboardPanel();

  activeGame = createGame({
    canvas: els.canvas,
    ctx,
    seed: activeSeed,
    theme,
    isMobile,
    onGameOver: handleGameOver,
  });
  activeGame.start();
}

function handleGameOver({ score, inputs }) {
  const { meta, formatScore } = modules.get(activeMeta.id);
  pendingRunResult = { gameId: meta.id, seed: activeSeed, score, inputs };
  writeLocalBestIfBetter(meta.id, score, meta.scoreOrder);

  els.summary.textContent = `Run over — ${meta.scoreLabel}: ${formatScore(score)}`;
  els.nameInput.value = localStorage.getItem('arcade:name') || '';
  els.nameInput.hidden = false;
  els.submitBtn.hidden = false;
  els.skipBtn.textContent = 'Skip';
  els.nameModal.hidden = false;
  els.nameInput.focus();
}

async function submitPendingScore() {
  if (!pendingRunResult) return;
  const name = els.nameInput.value.trim().slice(0, 16) || 'Anonymous';
  localStorage.setItem('arcade:name', name);
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = 'Submitting…';
  const result = await submitScore({
    game: pendingRunResult.gameId,
    name,
    seed: pendingRunResult.seed,
    inputs: pendingRunResult.inputs,
    claimedScore: pendingRunResult.score,
  });
  els.submitBtn.disabled = false;
  els.submitBtn.textContent = 'Submit score';
  if (result.ok) {
    const { meta } = modules.get(pendingRunResult.gameId);
    els.summary.textContent = result.rank
      ? `You're #${result.rank} on the ${meta.title} leaderboard!`
      : 'Score submitted!';
    els.nameInput.hidden = true;
    els.submitBtn.hidden = true;
    els.skipBtn.textContent = 'Close';
    pendingRunResult = null; // already recorded; a second click on Close shouldn't resubmit
    refreshLeaderboardPanel();
  } else {
    els.summary.textContent = `Submission rejected: ${result.reason || 'validation failed'}`;
  }
}

function closeNameModal() {
  els.nameModal.hidden = true;
  pendingRunResult = null;
}

function backToMenu() {
  activeGame?.destroy();
  activeGame = null;
  closeNameModal();
  els.gameView.hidden = true;
  els.menuView.hidden = false;
  renderMenu();
}

els.backBtn.addEventListener('click', backToMenu);
els.controlsBtn.addEventListener('click', () => {
  els.controlsOverlay.hidden = !els.controlsOverlay.hidden;
});
els.submitBtn.addEventListener('click', submitPendingScore);
els.skipBtn.addEventListener('click', closeNameModal);
window.addEventListener('resize', () => {
  if (!els.gameView.hidden) resizeCanvas();
});
document.addEventListener('visibilitychange', () => {
  if (!activeGame) return;
  if (document.hidden) activeGame.pause();
  else activeGame.resume();
});

await loadAllModules();
await renderMenu();
