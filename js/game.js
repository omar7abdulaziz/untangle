'use strict';

/* ============================================================
   Untangle — core game logic + presentation.

   File is split into four parts:
     1. Board generation (layer-peel construction + solvability proof)
     2. Difficulty presets
     3. Game state + rules (cell exit check, attempts, progress)
     4. Rendering + DOM interaction

   Every arrow cell is a fully independent unit — there is no
   grouping of cells into multi-cell shapes. See the part 1 comment
   block for the generation algorithm and why it always produces a
   solvable board.
   ============================================================ */

// ---------------------------------------------------------------
// Config — single place to tune defaults / timing.
// ---------------------------------------------------------------
const CONFIG = Object.freeze({
  GRID_ROWS: 8,
  GRID_COLS: 10,
  MAX_ATTEMPTS: 3,         // player mistakes allowed per board
  MAX_GENERATION_TRIES: 5000,
  EXIT_DURATION_MS: 380,   // must match --exit-duration in css/game.css
  SHAKE_DURATION_MS: 350,  // must match the cell-shake keyframes duration
  HINT_LIMIT: 1,           // free hints per board (separate from attempts — a hint is not a mistake)
  HINT_PULSE_MS: 1100,     // must match the hint-pulse keyframes duration in css/game.css
});

// ---------------------------------------------------------------
// Directions
// ---------------------------------------------------------------
const DIR = {
  UP: { name: 'UP', dr: -1, dc: 0 },
  DOWN: { name: 'DOWN', dr: 1, dc: 0 },
  LEFT: { name: 'LEFT', dr: 0, dc: -1 },
  RIGHT: { name: 'RIGHT', dr: 0, dc: 1 },
};
const ALL_DIRS = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];

function inBounds(r, c, rows, cols) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function cellKey(r, c) {
  return r + ',' + c;
}

// =================================================================
// 1. BOARD GENERATION
//
// Every arrow cell is a fully independent unit. There is no grouping
// of cells into multi-cell shapes of any kind. A cell is removable
// only when the straight line from it, in its own single drawn
// direction, is completely empty all the way off the board — nothing
// else about the board matters to that decision.
//
// Guaranteeing a full board is always solvable under that rule is a
// pure geometry fact: for any cell, define its "layer" as its
// distance to the NEAREST edge (the smallest of how many steps up,
// down, left, or right it would take to leave the board that way).
// A cell's straight ray toward that nearest edge only ever passes
// through cells with a strictly SMALLER layer number — moving one
// step toward that edge shortens the distance to it by exactly one,
// and cannot lengthen the distance to any other edge along the same
// straight line.
//
// So: cells are placed (built) in order from the HIGHEST layer number
// down to layer 0 — most central cells first, true board-edge cells
// last. Gameplay removes in the exact reverse order: edge cells
// (layer 0) first, most central cells last. By the time any cell
// needs to exit, every cell its own straight ray could possibly pass
// through has a strictly smaller layer number, and — because those
// are removed earlier in that reverse order — is already gone. This
// holds for every rectangular grid size, with no exceptions, so no
// retry is structurally ever needed; generatePuzzle() keeps one only
// as a defensive safety net, same as it always has.
// =================================================================

function shuffled(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A cell's distance to its nearest edge, and which direction(s) achieve it. */
function computeCellLayer(r, c, rows, cols) {
  const distUp = r;
  const distDown = rows - 1 - r;
  const distLeft = c;
  const distRight = cols - 1 - c;
  const layer = Math.min(distUp, distDown, distLeft, distRight);
  const dirs = [];
  if (distUp === layer) dirs.push(DIR.UP);
  if (distDown === layer) dirs.push(DIR.DOWN);
  if (distLeft === layer) dirs.push(DIR.LEFT);
  if (distRight === layer) dirs.push(DIR.RIGHT);
  return { layer, dirs };
}

/** Exact number of straight-line steps in `dir` for (r,c) to leave the board. */
function stepsToLeaveBoard(r, c, dir, rows, cols) {
  if (dir.name === 'UP') return r + 1;
  if (dir.name === 'DOWN') return rows - r;
  if (dir.name === 'LEFT') return c + 1;
  return cols - c; // RIGHT
}

/**
 * One independent arrow cell at (r,c). Its entire identity is its own
 * fixed direction: headExitPath is just that direction, repeated
 * exactly enough times to walk it off the board in a straight line.
 * (cells/arrows/headCell/headDir keep the same shape the rest of the
 * game — rendering, animation, hints — already expects; here they
 * simply never describe more than this one cell.)
 */
function makeIndependentCell(r, c, dir, id, rows, cols) {
  const steps = stepsToLeaveBoard(r, c, dir, rows, cols);
  return {
    id,
    cells: [{ r, c }],
    arrows: { [cellKey(r, c)]: dir },
    headExitPath: new Array(steps).fill(dir),
    headDir: dir,
    headCell: { r, c },
  };
}

/**
 * Builds every cell of the board, highest layer (most central) first,
 * layer 0 (board edge) last — see the section comment above for why
 * that construction order, combined with reverse-order removal,
 * guarantees every cell's straight-line exit is always clear when its
 * turn comes. Ties within the same layer, and between directions
 * equally close for a given cell, are broken randomly for variety.
 */
function tryBuildPieces(rows, cols) {
  const byLayer = new Map();
  let maxLayer = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { layer, dirs } = computeCellLayer(r, c, rows, cols);
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer).push({ r, c, dirs });
      if (layer > maxLayer) maxLayer = layer;
    }
  }

  const pieces = [];
  let nextId = 0;
  for (let layer = maxLayer; layer >= 0; layer--) {
    for (const { r, c, dirs } of shuffled(byLayer.get(layer) || [])) {
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      pieces.push(makeIndependentCell(r, c, dir, nextId, rows, cols));
      nextId++;
    }
  }
  return pieces;
}

/**
 * Can this cell currently slide out, given `grid` (cell-id-or-null per
 * cell)? Walks its own straight-line exit route cell by cell, exactly
 * as drawn — the first still-occupied cell in the way blocks it; going
 * off the board first means it's clear.
 */
function canPieceExit(grid, rows, cols, piece) {
  let r = piece.headCell.r;
  let c = piece.headCell.c;
  for (const dir of piece.headExitPath) {
    r += dir.dr;
    c += dir.dc;
    if (!inBounds(r, c, rows, cols)) break; // stepped off the board — clear
    const occupant = grid[r][c];
    if (occupant !== null && occupant !== piece.id) return false;
  }
  return true;
}

/** Simulates playing `pieces` in reverse build order; true if it fully clears. */
function verifySolution(pieces, grid, rows, cols) {
  const order = pieces.slice().reverse();
  for (const piece of order) {
    if (!canPieceExit(grid, rows, cols, piece)) return false;
    for (const cell of piece.cells) {
      grid[cell.r][cell.c] = null;
    }
  }
  return true;
}

/**
 * Generates a board guaranteed solvable. The layer-ordering proof
 * above means this succeeds by construction on the first attempt; the
 * retry loop is kept only as a defensive safety net.
 */
function generatePuzzle(rows, cols) {
  for (let attempt = 0; attempt < CONFIG.MAX_GENERATION_TRIES; attempt++) {
    const pieces = tryBuildPieces(rows, cols);

    const cellOwner = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (const piece of pieces) {
      const cell = piece.cells[0];
      cellOwner[cell.r][cell.c] = piece.id;
    }

    const verifyGrid = cellOwner.map((row) => row.slice());
    if (verifySolution(pieces, verifyGrid, rows, cols)) {
      return { pieces, cellOwner, rows, cols };
    }
  }
  throw new Error('Untangle: could not generate a solvable board after ' + CONFIG.MAX_GENERATION_TRIES + ' tries');
}

// =================================================================
// 2. DIFFICULTY PRESETS
//
// Purely a board-size parameter fed into the untouched generation
// algorithm above — every cell is independent regardless of
// difficulty, so there is nothing else to vary.
// =================================================================

const DIFFICULTY_PRESETS = {
  easy: { rows: 6, cols: 6, labelKey: 'diff_easy' },
  medium: { rows: 8, cols: 10, labelKey: 'diff_medium' },
  hard: { rows: 10, cols: 13, labelKey: 'diff_hard' },
  nightmare: { rows: 13, cols: 16, labelKey: 'diff_nightmare' },
};

/**
 * Difficulty comes from the URL (?difficulty=hard) when present and
 * valid; otherwise falls back to the player's last-played difficulty
 * (persisted in storage.js), then finally to 'medium'.
 */
function resolveDifficulty() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('difficulty');
  const fromStorage = typeof getLastDifficulty === 'function' ? getLastDifficulty() : null;
  const key = DIFFICULTY_PRESETS[fromUrl] ? fromUrl : (DIFFICULTY_PRESETS[fromStorage] ? fromStorage : 'medium');
  return Object.assign({ key }, DIFFICULTY_PRESETS[key]);
}

function formatClockTime(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

// =================================================================
// 3 & 4. GAME STATE, RENDERING, INTERACTION
// =================================================================

// Every occupied cell shares one flat fill color (see .cell in
// css/game.css, --color-cell-fill) — there is no per-piece color
// coding. Only two other visual states exist: the shake/error ring
// (.cell.shake) and the keyboard-focus ring (.cell.kbd-focus).

const ARROW_SVG_MARKUP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 12 H18"/><path d="M13 7 L18 12 L13 17"/></svg>';

const state = {
  rows: CONFIG.GRID_ROWS,
  cols: CONFIG.GRID_COLS,
  difficultyKey: 'medium',
  cellOwner: null,       // live grid: cell id or null per cell
  pieces: {},            // id -> independent single cell (+ removed flag)
  cellElements: null,    // 2D array of DOM nodes
  originalCellOwner: null,
  originalPiecesList: null,
  totalCells: 0,
  clearedCells: 0,
  attemptsLeft: CONFIG.MAX_ATTEMPTS,
  gameOver: false,
  startTime: 0,
  hintsLeft: CONFIG.HINT_LIMIT,
  focusR: 0,
  focusC: 0,
};

let dom = null;

function cacheDom() {
  dom = {
    board: document.getElementById('board'),
    progressFill: document.getElementById('progress-fill'),
    progressLabel: document.getElementById('progress-label'),
    attemptsDots: document.getElementById('attempts-dots'),
    difficultyBadge: document.getElementById('difficulty-badge'),
    winOverlay: document.getElementById('win-overlay'),
    loseOverlay: document.getElementById('lose-overlay'),
    newPuzzleBtn: document.getElementById('new-puzzle-btn'),
    retryBtn: document.getElementById('retry-btn'),
    newLevelBtn: document.getElementById('new-level-btn'),
    loadingOverlay: document.getElementById('loading-overlay'),
    winTimeLine: document.getElementById('win-time-line'),
    muteBtn: document.getElementById('mute-btn'),
    iconSoundOn: document.querySelector('#mute-btn .icon-sound-on'),
    iconSoundOff: document.querySelector('#mute-btn .icon-sound-off'),
    hintBtn: document.getElementById('hint-btn'),
    shareBtn: document.getElementById('share-btn'),
    shareToast: document.getElementById('share-toast'),
  };
}

function startNewPuzzle() {
  // Generation is synchronous (and, per the measured performance, always
  // fast — a few ms even at Nightmare size). Deferring it one tick lets
  // the loading indicator actually paint first, so on the rare slow
  // device where it's needed it will show; otherwise the CSS
  // transition-delay below means it never becomes visible at all.
  showLoadingIndicator();
  setTimeout(() => {
    const puzzle = generatePuzzle(state.rows, state.cols);
    hideLoadingIndicator();
    loadPuzzle(puzzle);
  }, 0);
}

function resetCurrentPuzzle() {
  loadPuzzle({ cellOwner: state.originalCellOwner, pieces: state.originalPiecesList });
}

function showLoadingIndicator() {
  if (dom.loadingOverlay) dom.loadingOverlay.classList.add('visible');
}

function hideLoadingIndicator() {
  if (dom.loadingOverlay) dom.loadingOverlay.classList.remove('visible');
}

function loadPuzzle(puzzle) {
  state.originalCellOwner = puzzle.cellOwner.map((row) => row.slice());
  state.originalPiecesList = puzzle.pieces;

  state.cellOwner = puzzle.cellOwner.map((row) => row.slice());
  state.pieces = {};
  for (const piece of puzzle.pieces) {
    state.pieces[piece.id] = Object.assign({ removed: false }, piece);
  }

  state.totalCells = state.rows * state.cols;
  state.clearedCells = 0;
  state.attemptsLeft = CONFIG.MAX_ATTEMPTS;
  state.gameOver = false;
  state.startTime = Date.now();
  state.hintsLeft = CONFIG.HINT_LIMIT;
  state.focusR = 0;
  state.focusC = 0;

  hideOverlays();
  renderBoard();
  updateProgressUI();
  updateAttemptsUI();
  updateHintButtonUI();
  moveFocusTo(findFirstOccupiedCell());
}

/**
 * Sets the board's pixel height from its actual (CSS-driven) width so
 * every row/column comes out square. Deliberately NOT done with the
 * CSS `aspect-ratio` property: combined with `display: grid` and `1fr`
 * row tracks, WebKit (real Safari/iOS — confirmed with a WebKit-engine
 * test, not just assumed) fails to size the grid at all and collapses
 * it to a few pixels tall, even though Chromium renders it correctly.
 * An explicit pixel height sidesteps that engine difference entirely.
 */
function sizeBoardToViewport() {
  const width = dom.board.getBoundingClientRect().width;
  if (width <= 0) return;
  const height = width * (state.rows / state.cols);
  dom.board.style.height = height + 'px';
}

function renderBoard() {
  dom.board.innerHTML = '';
  dom.board.style.gridTemplateColumns = 'repeat(' + state.cols + ', 1fr)';
  dom.board.style.gridTemplateRows = 'repeat(' + state.rows + ', 1fr)';
  sizeBoardToViewport();

  state.cellElements = Array.from({ length: state.rows }, () => new Array(state.cols).fill(null));

  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const pieceId = state.cellOwner[r][c];
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      cellEl.dataset.r = String(r);
      cellEl.dataset.c = String(c);
      cellEl.style.gridColumn = String(c + 1);
      cellEl.style.gridRow = String(r + 1);

      if (pieceId !== null) {
        const piece = state.pieces[pieceId];
        const dir = piece.arrows[cellKey(r, c)];

        const arrowWrap = document.createElement('span');
        arrowWrap.className = 'arrow-icon dir-' + dir.name.toLowerCase();
        arrowWrap.innerHTML = ARROW_SVG_MARKUP;
        cellEl.appendChild(arrowWrap);
      }

      dom.board.appendChild(cellEl);
      state.cellElements[r][c] = cellEl;
    }
  }
}

/** Best-effort haptic pulse (Android Chrome; silently absent on iOS/desktop). */
function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {
    /* not worth surfacing */
  }
}

// ---------------------------------------------------------------
// Keyboard navigation (accessibility): arrow keys move a focus
// cursor over the grid, Enter/Space activates whatever piece is
// under it — the same attemptRemovePiece() path as a tap.
// ---------------------------------------------------------------

function findFirstOccupiedCell() {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.cellOwner[r][c] !== null) return { r, c };
    }
  }
  return { r: 0, c: 0 };
}

function moveFocusTo(pos) {
  if (state.cellElements && state.cellElements[state.focusR] && state.cellElements[state.focusR][state.focusC]) {
    state.cellElements[state.focusR][state.focusC].classList.remove('kbd-focus');
  }
  state.focusR = pos.r;
  state.focusC = pos.c;
  const el = state.cellElements && state.cellElements[pos.r] && state.cellElements[pos.r][pos.c];
  if (el) el.classList.add('kbd-focus');
}

function moveFocusBy(dr, dc) {
  const nr = Math.min(state.rows - 1, Math.max(0, state.focusR + dr));
  const nc = Math.min(state.cols - 1, Math.max(0, state.focusC + dc));
  moveFocusTo({ r: nr, c: nc });
}

function activateFocusedCell() {
  if (state.gameOver) return;
  const pieceId = state.cellOwner[state.focusR][state.focusC];
  if (pieceId === null || pieceId === undefined) return;
  attemptRemovePiece(pieceId);
}

function onBoardKeydown(event) {
  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      moveFocusBy(-1, 0);
      break;
    case 'ArrowDown':
      event.preventDefault();
      moveFocusBy(1, 0);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      moveFocusBy(0, -1);
      break;
    case 'ArrowRight':
      event.preventDefault();
      moveFocusBy(0, 1);
      break;
    case 'Enter':
    case ' ':
    case 'Spacebar':
      event.preventDefault();
      activateFocusedCell();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------
// Hint: highlights one currently-removable piece. Limited per board
// and tracked separately from attempts — using a hint is not a
// mistake, so it shouldn't count toward losing.
// ---------------------------------------------------------------

function findAnyRemovablePiece() {
  for (const id in state.pieces) {
    const piece = state.pieces[id];
    if (!piece.removed && canPieceExit(state.cellOwner, state.rows, state.cols, piece)) {
      return piece;
    }
  }
  return null;
}

function useHint() {
  if (state.gameOver || state.hintsLeft <= 0) return;
  const piece = findAnyRemovablePiece();
  if (!piece) return; // board already clear, or mid-animation — nothing to hint

  state.hintsLeft -= 1;
  updateHintButtonUI();

  for (const cell of piece.cells) {
    const el = state.cellElements[cell.r][cell.c];
    el.classList.remove('hint');
    void el.offsetWidth; // restart the animation if hint is ever re-triggered
    el.classList.add('hint');
  }
  setTimeout(() => {
    for (const cell of piece.cells) {
      const el = state.cellElements[cell.r][cell.c];
      if (el) el.classList.remove('hint');
    }
  }, CONFIG.HINT_PULSE_MS);
}

function updateHintButtonUI() {
  if (!dom.hintBtn) return;
  dom.hintBtn.classList.toggle('is-disabled', state.hintsLeft <= 0);

  let badge = dom.hintBtn.querySelector('.hint-count');
  if (state.hintsLeft > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'hint-count';
      dom.hintBtn.appendChild(badge);
    }
    badge.textContent = String(state.hintsLeft);
  } else if (badge) {
    badge.remove();
  }
}

function initHintButton() {
  if (!dom.hintBtn) return;
  dom.hintBtn.addEventListener('click', useHint);
}

// ---------------------------------------------------------------
// Share: Web Share API where available, clipboard copy otherwise.
// Builds its text from small translated fragments rather than a
// template string, matching the rest of the i18n approach.
// ---------------------------------------------------------------

function buildShareText() {
  const difficultyLabel = typeof t === 'function' ? t(DIFFICULTY_PRESETS[state.difficultyKey].labelKey) : state.difficultyKey;
  const clearedPhrase = typeof t === 'function' ? t('share_cleared') : 'I cleared Untangle’s';
  const inPhrase = typeof t === 'function' ? t('share_board_in') : 'board in';
  const time = formatClockTime(state.lastElapsedMs || 0);
  const url = window.location.origin + window.location.pathname.replace(/play\.html.*$/, 'index.html');
  return clearedPhrase + ' ' + difficultyLabel + ' ' + inPhrase + ' ' + time + ' 🧩 ' + url;
}

function flashShareToast() {
  if (!dom.shareToast) return;
  dom.shareToast.classList.add('visible');
  setTimeout(() => dom.shareToast.classList.remove('visible'), 2200);
}

function legacyCopyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    /* nothing more we can do — fail silently */
  }
  document.body.removeChild(textarea);
}

async function shareResult() {
  const text = buildShareText();
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch (e) {
    /* user cancelled the native share sheet, or it's unsupported — fall through to copy */
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      legacyCopyToClipboard(text);
    }
    flashShareToast();
  } catch (e) {
    legacyCopyToClipboard(text);
    flashShareToast();
  }
}

function initShareButton() {
  if (!dom.shareBtn) return;
  dom.shareBtn.addEventListener('click', shareResult);
}

function onBoardClick(event) {
  if (state.gameOver) return;
  const cellEl = event.target.closest('.cell');
  if (!cellEl) return;

  const r = Number(cellEl.dataset.r);
  const c = Number(cellEl.dataset.c);
  const pieceId = state.cellOwner[r][c];
  if (pieceId === null || pieceId === undefined) return;

  attemptRemovePiece(pieceId);
}

function attemptRemovePiece(pieceId) {
  const piece = state.pieces[pieceId];
  if (!piece || piece.removed) return;

  if (canPieceExit(state.cellOwner, state.rows, state.cols, piece)) {
    if (typeof SoundManager !== 'undefined') SoundManager.playSlide();
    vibrate(12);
    removePieceWithAnimation(piece);
  } else {
    if (typeof SoundManager !== 'undefined') SoundManager.playBlocked();
    vibrate(35);
    shakePiece(piece);
    registerFailedAttempt();
  }
}

/** Web Animations keyframes tracing this cell's own straight exit
 *  route, in cell-relative percentages (100% = exactly one cell
 *  width/height, so this works regardless of the board's actual pixel
 *  size). Ends with a final flourish continuing past the board edge
 *  while fading out, so the cell visibly leaves rather than just
 *  stopping at the boundary. */
function buildCellExitKeyframes(piece) {
  const path = piece.headExitPath;
  const realSpan = 0.82; // fraction of the animation spent on the real, verified-clear route

  let cumDC = 0;
  let cumDR = 0;
  const keyframes = [{ transform: 'translate(0%, 0%)', opacity: 1, offset: 0 }];

  path.forEach((dir, i) => {
    cumDC += dir.dc;
    cumDR += dir.dr;
    keyframes.push({
      transform: `translate(${cumDC * 100}%, ${cumDR * 100}%)`,
      opacity: 1,
      offset: ((i + 1) / path.length) * realSpan,
    });
  });

  const lastDir = path[path.length - 1];
  keyframes.push({
    transform: `translate(${(cumDC + lastDir.dc * 14) * 100}%, ${(cumDR + lastDir.dr * 14) * 100}%)`,
    opacity: 0,
    offset: 1,
  });

  return keyframes;
}

function removePieceWithAnimation(piece) {
  piece.removed = true;
  const cell = piece.cells[0];
  state.cellOwner[cell.r][cell.c] = null;

  const el = state.cellElements[cell.r][cell.c];
  const anim = el.animate(buildCellExitKeyframes(piece), {
    duration: CONFIG.EXIT_DURATION_MS,
    easing: 'ease',
    fill: 'forwards',
  });
  anim.onfinish = () => el.classList.add('cell-cleared');

  state.clearedCells += 1;
  updateProgressUI();

  if (state.clearedCells >= state.totalCells) {
    state.gameOver = true;
    if (typeof SoundManager !== 'undefined') SoundManager.playWin();
    vibrate([25, 60, 25, 60, 45]);
    setTimeout(() => {
      recordAndShowWinTime();
      showWinOverlay();
    }, CONFIG.EXIT_DURATION_MS + 150);
  }
}

function recordAndShowWinTime() {
  const elapsedMs = Date.now() - state.startTime;
  state.lastElapsedMs = elapsedMs;

  if (!dom.winTimeLine) return;

  if (typeof recordBestTimeMs !== 'function') {
    dom.winTimeLine.textContent = '';
    return;
  }

  const { best, isNewBest } = recordBestTimeMs(state.difficultyKey, elapsedMs);
  const clearedLabel = (typeof t === 'function' ? t('cleared_in') : 'Cleared in');
  const clearedSpan = '<span class="time-value" dir="ltr">' + formatClockTime(elapsedMs) + '</span>';

  if (isNewBest) {
    const newBestLabel = (typeof t === 'function' ? t('new_best') : 'New personal best!');
    dom.winTimeLine.innerHTML = clearedLabel + ' ' + clearedSpan + ' — ' + newBestLabel;
  } else {
    const bestLabel = (typeof t === 'function' ? t('best_time') : 'Best');
    const bestSpan = '<span class="time-value" dir="ltr">' + formatClockTime(best) + '</span>';
    dom.winTimeLine.innerHTML = clearedLabel + ' ' + clearedSpan + ' · ' + bestLabel + ' ' + bestSpan;
  }
}

function shakePiece(piece) {
  for (const cell of piece.cells) {
    const el = state.cellElements[cell.r][cell.c];
    el.classList.remove('shake');
    void el.offsetWidth; // restart animation if triggered again quickly
    el.classList.add('shake');
  }
  setTimeout(() => {
    for (const cell of piece.cells) {
      state.cellElements[cell.r][cell.c].classList.remove('shake');
    }
  }, CONFIG.SHAKE_DURATION_MS);
}

function registerFailedAttempt() {
  state.attemptsLeft -= 1;
  updateAttemptsUI();
  if (state.attemptsLeft <= 0) {
    state.gameOver = true;
    setTimeout(showLoseOverlay, 250);
  }
}

function updateProgressUI() {
  const pct = Math.round((state.clearedCells / state.totalCells) * 100);
  dom.progressFill.style.width = pct + '%';
  dom.progressLabel.textContent = pct + '%';
}

function updateAttemptsUI() {
  dom.attemptsDots.innerHTML = '';
  for (let i = 0; i < CONFIG.MAX_ATTEMPTS; i++) {
    const dot = document.createElement('span');
    dot.className = 'attempt-dot' + (i >= state.attemptsLeft ? ' used' : '');
    dom.attemptsDots.appendChild(dot);
  }
}

function showWinOverlay() {
  dom.winOverlay.hidden = false;
}

function showLoseOverlay() {
  dom.loseOverlay.hidden = false;
}

function hideOverlays() {
  dom.winOverlay.hidden = true;
  dom.loseOverlay.hidden = true;
  if (dom.winTimeLine) dom.winTimeLine.textContent = '';
}

function applyDifficultyToState() {
  const preset = resolveDifficulty();
  state.rows = preset.rows;
  state.cols = preset.cols;
  state.difficultyKey = preset.key;
  if (dom.difficultyBadge) {
    dom.difficultyBadge.dataset.i18n = preset.labelKey;
    if (typeof applyTranslations === 'function') applyTranslations();
  }
  if (typeof setLastDifficulty === 'function') setLastDifficulty(preset.key);
}

function updateMuteButtonUI() {
  if (!dom.muteBtn || typeof SoundManager === 'undefined') return;
  const muted = SoundManager.isMuted();
  if (dom.iconSoundOn) dom.iconSoundOn.hidden = muted;
  if (dom.iconSoundOff) dom.iconSoundOff.hidden = !muted;
  dom.muteBtn.dataset.i18nAttr = 'aria-label:' + (muted ? 'mute_off' : 'mute_on');
  if (typeof applyTranslations === 'function') applyTranslations();
}

function initMuteButton() {
  if (!dom.muteBtn || typeof SoundManager === 'undefined') return;
  updateMuteButtonUI();
  dom.muteBtn.addEventListener('click', () => {
    SoundManager.toggleMuted();
    updateMuteButtonUI();
  });
}

let resizeRaf = null;
function onViewportResize() {
  if (!state.cellElements) return; // board not rendered yet
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(sizeBoardToViewport);
}

function init() {
  cacheDom();
  applyDifficultyToState();
  initMuteButton();
  initHintButton();
  initShareButton();
  dom.board.addEventListener('click', onBoardClick);
  dom.board.addEventListener('keydown', onBoardKeydown);
  dom.newPuzzleBtn.addEventListener('click', startNewPuzzle);
  dom.retryBtn.addEventListener('click', resetCurrentPuzzle);
  dom.newLevelBtn.addEventListener('click', startNewPuzzle);
  window.addEventListener('resize', onViewportResize);
  window.addEventListener('orientationchange', onViewportResize);
  startNewPuzzle();
}

document.addEventListener('DOMContentLoaded', init);
