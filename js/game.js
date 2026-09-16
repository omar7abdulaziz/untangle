'use strict';

/* ============================================================
   Untangle — core game logic + presentation.

   File is split into four parts:
     1. Board generation (reverse construction + solvability proof)
     2. Difficulty presets
     3. Game state + rules (cell exit check, attempts, progress)
     4. Rendering + DOM interaction

   Every arrow cell is a fully independent unit — clicking one never
   moves any other cell, regardless of what it unblocks. See the
   part 1 comment block for how generation still produces real
   dependency depth (not every cell trivially free at once) while
   keeping that guarantee airtight.
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
// Every arrow cell is fully independent — no grouping of any kind.
// A cell is removable only when the straight line from it, in its
// own single drawn direction, is completely empty all the way off
// the board.
//
// Cells are placed one at a time, in reverse construction order,
// same idea as always: a cell may only be placed with a direction
// whose entire ray is CURRENTLY empty (isRayClear), which guarantees
// that ray stays clear until this cell's turn to be removed (every
// cell along it, being empty now, can only end up placed *later*,
// hence removed *earlier* in reverse order).
//
// The one addition that matters here: before finalizing any
// placement, wouldStrandAnyCell checks it doesn't leave some OTHER
// still-empty cell with zero remaining ray options in any direction
// — the same kind of connectivity guard used elsewhere in this
// project, just adapted to straight rays instead of bendable BFS
// paths. Without it, cells often get boxed in with no straight shot
// to any edge and generation fails; with it, failures are rare and
// the outer retry loop in generatePuzzle() is a safety net, not a
// requirement. Picking whichever direction happens to be safe (not
// always the nearest edge) is what gives boards real dependency
// depth instead of every cell being trivially free from the start.
// =================================================================

function shuffled(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Is the straight ray from (r,c) in `dir`, all the way off the board, empty? */
function isRayClear(grid, rows, cols, r, c, dir) {
  let cr = r;
  let cc = c;
  while (inBounds(cr, cc, rows, cols)) {
    if (grid[cr][cc] !== null) return false;
    cr += dir.dr;
    cc += dir.dc;
  }
  return true;
}

function hasAnyClearRay(grid, rows, cols, r, c) {
  for (const dir of ALL_DIRS) {
    if (isRayClear(grid, rows, cols, r, c, dir)) return true;
  }
  return false;
}

/** Would placing a cell at (r,c) leave every OTHER still-empty cell with
 *  at least one direction whose ray is still clear? */
function wouldStrandAnyCell(grid, rows, cols, r, c, sentinelId) {
  grid[r][c] = sentinelId;
  let stranded = false;
  for (let er = 0; er < rows && !stranded; er++) {
    for (let ec = 0; ec < cols && !stranded; ec++) {
      if (grid[er][ec] !== null) continue;
      if (!hasAnyClearRay(grid, rows, cols, er, ec)) stranded = true;
    }
  }
  grid[r][c] = null;
  return stranded;
}

/** Exact number of straight-line steps in `dir` it takes (r,c) to leave the board. */
function stepsToLeaveBoard(r, c, dir, rows, cols) {
  if (dir.name === 'UP') return r + 1;
  if (dir.name === 'DOWN') return rows - r;
  if (dir.name === 'LEFT') return c + 1;
  return cols - c; // RIGHT
}

/**
 * One independent arrow cell at (r,c). Its entire identity is its own
 * fixed direction: headExitPath is that direction, repeated exactly
 * enough times to walk it off the board in a straight line.
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
 * Among a cell's several currently-safe directions (all equally valid
 * for solvability — see the caller), prefer whichever one keeps ITS
 * ROW and ITS COLUMN most balanced across all 4 directions so far,
 * with immediate-neighbor repetition as a lighter secondary nudge —
 * PLUS a strong penalty on a boundary cell's own trivial escape route
 * (the direction that leaves the board on step 1, e.g. UP for any
 * row-0 cell). That direction is always available no matter how full
 * the board gets — nothing can ever block a ray that's already off
 * the board — so left unpenalized it's what a boundary cell gets
 * forced into once its other options close up, which is exactly why
 * every difficulty measured 65-90%+ of perimeter cells pointing
 * straight outward (instantly removable, zero thought) even with the
 * row/column cap already in effect: that cap watches compass-direction
 * dominance per line, not "does THIS cell point along its own escape."
 * Purely a choice among options already proven safe — it can never
 * pick an unsafe direction, so it can't affect solvability.
 *
 * This only ever runs on a cell that HAS more than one safe option
 * (tryBuildPieces returns dirs[0] directly otherwise), so its actual
 * leverage over the finished board's balance depends entirely on how
 * many cells still have a real choice by the time they're placed —
 * which is what tryBuildPieces's withChoice/forced placement order
 * is for.
 */
function pickVariedDirection(dirGrid, rowDirCounts, colDirCounts, rows, cols, r, c, dirs) {
  if (dirs.length === 1) return dirs[0];

  const neighborCounts = {};
  for (const d of ALL_DIRS) {
    const nr = r + d.dr;
    const nc = c + d.dc;
    if (!inBounds(nr, nc, rows, cols)) continue;
    const neighborDir = dirGrid[nr][nc];
    if (neighborDir) neighborCounts[neighborDir.name] = (neighborCounts[neighborDir.name] || 0) + 1;
  }

  function pressure(d) {
    const trivialEscapePenalty = stepsToLeaveBoard(r, c, d, rows, cols) === 1 ? 6 : 0;
    return (rowDirCounts[r][d.name] || 0) + (colDirCounts[c][d.name] || 0) + (neighborCounts[d.name] || 0) * 0.5 + trivialEscapePenalty;
  }

  const ranked = shuffled(dirs).sort((a, b) => pressure(a) - pressure(b));
  return ranked[0];
}

/**
 * Which still-empty cell gets placed next, each iteration, decides
 * how much real choice is left by the time pickVariedDirection's
 * trivial-escape penalty (above) gets to act on it. As the grid
 * fills, a cell's safe directions (isRayClear) shrink toward exactly
 * one, and once a cell has only one option left there is no "choice"
 * left — it must take whatever direction is still open, penalty or
 * not. So a cell that currently has more than one safe option needs
 * to be placed WHILE it still has that choice, before other
 * placements close its other rays and force it.
 *
 * Boundary cells specifically are tried FIRST among cells with a
 * choice (ahead of interior cells with a choice), because a
 * boundary cell's own trivial-escape direction is always available
 * no matter what — nothing can ever block a ray that already leaves
 * the board — so it's the one most likely to survive, untouched,
 * until it's the only option left. Placing it early, while it still
 * has 2-3 real alternatives, is what gives the escape-penalty bias
 * anything to work with. Interior-with-choice is the next tier, and
 * forced (single-option) cells last — all within the same iteration,
 * never a hard restriction that would dead-end the whole build when
 * a forced cell was the only safe move available.
 */
function tryBuildPieces(rows, cols) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const dirGrid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const rowDirCounts = Array.from({ length: rows }, () => ({}));
  const colDirCounts = Array.from({ length: cols }, () => ({}));
  const pieces = [];
  const totalCells = rows * cols;
  let filled = 0;
  let nextId = 0;

  while (filled < totalCells) {
    const boundaryWithChoice = [];
    const interiorWithChoice = [];
    const forced = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) continue;
        const dirs = ALL_DIRS.filter((d) => isRayClear(grid, rows, cols, r, c, d));
        if (dirs.length === 0) continue;
        const cand = { r, c, dirs };
        if (dirs.length === 1) {
          forced.push(cand);
        } else if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
          boundaryWithChoice.push(cand);
        } else {
          interiorWithChoice.push(cand);
        }
      }
    }
    if (boundaryWithChoice.length === 0 && interiorWithChoice.length === 0 && forced.length === 0) return null; // dead end — retry generation

    let placed = false;
    for (const tier of [boundaryWithChoice, interiorWithChoice, forced]) {
      for (const cand of shuffled(tier)) {
        if (!wouldStrandAnyCell(grid, rows, cols, cand.r, cand.c, nextId)) {
          const dir = pickVariedDirection(dirGrid, rowDirCounts, colDirCounts, rows, cols, cand.r, cand.c, cand.dirs);
          grid[cand.r][cand.c] = nextId;
          dirGrid[cand.r][cand.c] = dir;
          rowDirCounts[cand.r][dir.name] = (rowDirCounts[cand.r][dir.name] || 0) + 1;
          colDirCounts[cand.c][dir.name] = (colDirCounts[cand.c][dir.name] || 0) + 1;
          pieces.push(makeIndependentCell(cand.r, cand.c, dir, nextId, rows, cols));
          filled++;
          nextId++;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) return null; // every candidate alone would strand something
  }

  return { pieces, cellOwner: grid };
}

/**
 * Can this cell currently slide out, given `grid` (cell-id-or-null per
 * cell)? Walks its own straight-line exit route cell by cell, exactly
 * as drawn — the first still-occupied cell in the way blocks it.
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
 * Rejects a board where any single row or column is dominated by one
 * direction — separate from, and in addition to, the local
 * neighbor-avoidance bias in pickVariedDirection. That bias only
 * discourages same-direction cells from sitting right next to each
 * other; it says nothing about a row/column that's mostly one
 * direction while being spread out (which reads just as trivially
 * "solve the whole row/column on sight" to a player scanning it).
 * `maxShare` is the highest fraction (0-1) of a row/column allowed to
 * share one exact direction before the whole board is rejected.
 */
function hasExcessiveDirectionRun(pieces, rows, cols, maxShare) {
  const dirAt = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const piece of pieces) {
    const cell = piece.cells[0];
    dirAt[cell.r][cell.c] = piece.headDir;
  }

  function dominantShare(dirsInLine) {
    const counts = {};
    for (const d of dirsInLine) counts[d.name] = (counts[d.name] || 0) + 1;
    return Math.max(...Object.values(counts)) / dirsInLine.length;
  }

  for (let r = 0; r < rows; r++) {
    if (dominantShare(dirAt[r]) > maxShare) return true;
  }
  for (let c = 0; c < cols; c++) {
    const column = [];
    for (let r = 0; r < rows; r++) column.push(dirAt[r][c]);
    if (dominantShare(column) > maxShare) return true;
  }
  return false;
}

/**
 * Generates a board guaranteed solvable, retrying until it verifies
 * AND satisfies the row/column direction-variety cap above. `maxDirShare`
 * defaults to a permissive 0.5 for any caller that doesn't pass one.
 */
function generatePuzzle(rows, cols, maxDirShare) {
  const shareLimit = typeof maxDirShare === 'number' ? maxDirShare : 0.5;
  for (let attempt = 0; attempt < CONFIG.MAX_GENERATION_TRIES; attempt++) {
    const built = tryBuildPieces(rows, cols);
    if (!built) continue;

    const verifyGrid = built.cellOwner.map((row) => row.slice());
    if (!verifySolution(built.pieces, verifyGrid, rows, cols)) continue;

    if (hasExcessiveDirectionRun(built.pieces, rows, cols, shareLimit)) continue;

    return { pieces: built.pieces, cellOwner: built.cellOwner, rows, cols };
  }
  throw new Error('Untangle: could not generate a solvable board after ' + CONFIG.MAX_GENERATION_TRIES + ' tries');
}

// =================================================================
// 2. DIFFICULTY PRESETS
//
// Board size, how many mistakes are forgiven (maxAttempts), and how
// tightly hasExcessiveDirectionRun caps any single row/column being
// dominated by one direction (maxDirShare, 0-1 — lower = stricter =
// harder to "read" at a glance) — all fed into the untouched
// generation algorithm above.
// =================================================================

// maxDirShare values below are empirically calibrated against
// tools/verify-generation.js (real timed runs, not guesses). A flat
// 30-50% target was tried first and rejection-sampling against it
// never once succeeded in 5000 tries at ANY difficulty — not slow,
// impossible, because the wouldStrandAnyCell safety guard
// structurally favors "sweeping" a whole row/column in one direction
// (it's the fill order least likely to strand a cell). What actually
// moved these numbers down from the original 85-90% is the
// boundaryWithChoice/interiorWithChoice/forced placement order in
// tryBuildPieces plus the trivial-escape penalty in pickVariedDirection
// (see their comments) — together those cut the share of perimeter
// cells that point straight off the board with zero thought needed
// from 65-90% down to ~50-58% at every size, which is the real,
// structural answer to "harder exit directions, not just a bigger
// grid": it holds for every tier below, not only the hardest one.
// Each maxDirShare value here is the lowest that stayed comfortably
// fast (avg well under 1s, worst case observed under ~1.5s) with that
// placement order in place; bigger boards need a bit more headroom —
// abyss (20x25, the new hardest tier) needed the most: 0.96 was the
// tightest that stayed reliably fast across a 60-run stress test
// (avg 343ms, p90 702ms, max 1143ms); 0.95 occasionally spiked past
// 2.5s. It's still meaningfully harder than impossible in the way
// that matters — same ~55-58% instant-exit-edge share on a board
// with 180 more cells and longer forced dependency chains — not
// "harder" purely because the grid got bigger.
const DIFFICULTY_PRESETS = {
  easy: { rows: 6, cols: 6, maxAttempts: 3, maxDirShare: 0.72, labelKey: 'diff_easy' },
  medium: { rows: 8, cols: 10, maxAttempts: 3, maxDirShare: 0.80, labelKey: 'diff_medium' },
  hard: { rows: 10, cols: 13, maxAttempts: 3, maxDirShare: 0.85, labelKey: 'diff_hard' },
  nightmare: { rows: 13, cols: 16, maxAttempts: 3, maxDirShare: 0.89, labelKey: 'diff_nightmare' },
  impossible: { rows: 16, cols: 20, maxAttempts: 1, maxDirShare: 0.93, labelKey: 'diff_impossible' },
  abyss: { rows: 20, cols: 25, maxAttempts: 1, maxDirShare: 0.96, labelKey: 'diff_abyss' },
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
  maxAttempts: CONFIG.MAX_ATTEMPTS,
  maxDirShare: undefined,
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
    const puzzle = generatePuzzle(state.rows, state.cols, state.maxDirShare);
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
  state.attemptsLeft = state.maxAttempts;
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
  for (let i = 0; i < state.maxAttempts; i++) {
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
  state.maxAttempts = preset.maxAttempts;
  state.maxDirShare = preset.maxDirShare;
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
