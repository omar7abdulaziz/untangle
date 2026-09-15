'use strict';

/* ============================================================
   Untangle — core game logic + presentation.

   File is split into four parts:
     1. Board generation (reverse construction + solvability proof)
     2. Difficulty presets
     3. Game state + rules (piece exit check, attempts, progress)
     4. Rendering + DOM interaction

   Generation logic (parts 1) is unchanged from the previous
   milestone except that MAX_PIECE_LEN is now a parameter instead of
   a hardcoded constant, so difficulty presets can drive it without
   touching the algorithm itself.
   ============================================================ */

// ---------------------------------------------------------------
// Config — single place to tune defaults / timing.
// ---------------------------------------------------------------
const CONFIG = Object.freeze({
  GRID_ROWS: 8,
  GRID_COLS: 10,
  MAX_PIECE_LEN: 6,        // fallback longest piece, in cells
  CONTINUE_BIAS: 0.72,     // chance to keep growing in the same direction
  MAX_ATTEMPTS: 3,         // player mistakes allowed per board
  MAX_GENERATION_TRIES: 5000,
  EXIT_STAGGER_MS: 70,     // delay between each cell's exit animation
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
const OPPOSITE_OF = {
  UP: DIR.DOWN,
  DOWN: DIR.UP,
  LEFT: DIR.RIGHT,
  RIGHT: DIR.LEFT,
};

function opposite(dir) {
  return OPPOSITE_OF[dir.name];
}

function inBounds(r, c, rows, cols) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function cellKey(r, c) {
  return r + ',' + c;
}

// =================================================================
// 1. BOARD GENERATION
//
// Pieces are built in reverse. Each new piece starts from a cell
// that is currently reachable from the board's edge through empty
// cells only (its "head") — the route back to the edge may bend, so
// we track it as a recorded sequence of directions (headExitPath),
// not just a single direction. The piece then grows into the empty
// interior, biased to keep going straight.
//
// Because every cell a piece touches (its own body, and every cell
// along its head's exit route) is empty *at build time*, each of
// those cells will necessarily end up claimed by some piece built
// *later*. Playing pieces back in the exact opposite order of
// construction (last built = first removed) therefore always finds
// every head's exit route clear — which is what makes the board
// provably solvable.
//
// A per-cell connectivity guard (isSafeToFill) additionally makes
// sure no placement ever strands empty cells in a sealed pocket, so
// generation succeeds on the first attempt in practice; the outer
// retry loop in generatePuzzle() is kept only as a safety net.
// =================================================================

/**
 * Multi-source BFS from the board's edge, through empty cells only.
 * Returns which empty cells are reachable from the edge, and for
 * each one, the direction to take one step back toward the edge
 * (chained, that eventually walks a cell off the board).
 */
function computeBoundaryReachability(grid, rows, cols) {
  const visited = new Set();
  const parentDir = new Map();
  const queue = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== null) continue;
      const onEdge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      if (!onEdge) continue;
      for (const dir of ALL_DIRS) {
        const nr = r + dir.dr;
        const nc = c + dir.dc;
        if (!inBounds(nr, nc, rows, cols)) {
          const k = cellKey(r, c);
          if (!visited.has(k)) {
            visited.add(k);
            parentDir.set(k, dir);
            queue.push({ r, c });
          }
          break;
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const { r, c } = queue[head++];
    for (const dir of ALL_DIRS) {
      const nr = r + dir.dr;
      const nc = c + dir.dc;
      if (!inBounds(nr, nc, rows, cols) || grid[nr][nc] !== null) continue;
      const nk = cellKey(nr, nc);
      if (visited.has(nk)) continue;
      visited.add(nk);
      parentDir.set(nk, opposite(dir));
      queue.push({ r: nr, c: nc });
    }
  }

  return { visited, parentDir };
}

/** Walks parentDir from (startR, startC) out to the board edge. */
function reconstructExitPath(startR, startC, parentDir, rows, cols) {
  const path = [];
  let r = startR;
  let c = startC;
  let guard = rows * cols + 5; // defends against an unexpected cycle
  while (guard-- > 0) {
    const dir = parentDir.get(cellKey(r, c));
    path.push(dir);
    const nr = r + dir.dr;
    const nc = c + dir.dc;
    if (!inBounds(nr, nc, rows, cols)) break; // stepped off the board
    r = nr;
    c = nc;
  }
  return path;
}

function countEmptyCells(grid, rows, cols) {
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === null) count++;
    }
  }
  return count;
}

/**
 * Would claiming (r,c) for `pieceId` leave every other still-empty cell
 * reachable from the board edge? Filling the last cell that connects two
 * pockets is only safe once nothing else remains to strand.
 */
function isSafeToFill(grid, rows, cols, r, c, pieceId) {
  grid[r][c] = pieceId;
  const emptyAfter = countEmptyCells(grid, rows, cols);
  const reachable = computeBoundaryReachability(grid, rows, cols).visited.size;
  grid[r][c] = null;
  return reachable === emptyAfter;
}

function shuffled(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Grows one piece starting at (startR, startC), whose head exits the
 * board along `exitPath`. Mutates `grid`, marking claimed cells with
 * `pieceId`. Every extension is checked with isSafeToFill so the piece
 * never seals off empty cells elsewhere on the board. `maxPieceLen`
 * caps how long the piece can grow (difficulty knob only — the growth
 * rule itself is unchanged).
 */
function growPiece(grid, rows, cols, startR, startC, exitPath, pieceId, maxPieceLen) {
  const cells = [{ r: startR, c: startC }];
  const arrows = {};
  arrows[cellKey(startR, startC)] = exitPath[0];
  grid[startR][startC] = pieceId;

  let current = { r: startR, c: startC };
  let growDir = null;
  const targetLen = 1 + Math.floor(Math.random() * maxPieceLen);

  for (let i = 1; i < targetLen; i++) {
    const options = ALL_DIRS.filter((d) => {
      const nr = current.r + d.dr;
      const nc = current.c + d.dc;
      return inBounds(nr, nc, rows, cols) && grid[nr][nc] === null;
    });
    if (options.length === 0) break;

    let ordered;
    if (growDir && options.some((d) => d.name === growDir.name) && Math.random() < CONFIG.CONTINUE_BIAS) {
      ordered = [growDir, ...shuffled(options.filter((d) => d.name !== growDir.name))];
    } else {
      ordered = shuffled(options);
    }

    let chosen = null;
    for (const candidate of ordered) {
      const nr = current.r + candidate.dr;
      const nc = current.c + candidate.dc;
      if (isSafeToFill(grid, rows, cols, nr, nc, pieceId)) {
        grid[nr][nc] = pieceId;
        chosen = candidate;
        cells.push({ r: nr, c: nc });
        arrows[cellKey(nr, nc)] = opposite(candidate);
        current = { r: nr, c: nc };
        growDir = candidate;
        break;
      }
    }
    if (!chosen) break; // no safe extension left; finalize the piece here
  }

  return {
    id: pieceId,
    cells,
    arrows,
    headExitPath: exitPath,
    headDir: exitPath[0],
    headCell: { r: startR, c: startC },
  };
}

/** One full attempt at filling the grid with pieces. Null on (rare) dead end. */
function tryBuildPieces(rows, cols, maxPieceLen) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const pieces = [];
  const totalCells = rows * cols;
  let filled = 0;
  let nextId = 0;

  while (filled < totalCells) {
    const { visited, parentDir } = computeBoundaryReachability(grid, rows, cols);
    if (visited.size === 0) return null; // sealed pocket — dead end, retry generation

    const candidateKeys = shuffled(Array.from(visited));
    let head = null;
    for (const k of candidateKeys) {
      const [r, c] = k.split(',').map(Number);
      if (isSafeToFill(grid, rows, cols, r, c, nextId)) {
        head = { r, c };
        break;
      }
    }
    if (!head) return null; // every candidate alone would strand another cell

    const exitPath = reconstructExitPath(head.r, head.c, parentDir, rows, cols);
    const piece = growPiece(grid, rows, cols, head.r, head.c, exitPath, nextId, maxPieceLen);
    pieces.push(piece);
    filled += piece.cells.length;
    nextId++;
  }

  return { pieces, cellOwner: grid };
}

/**
 * Can `piece` currently slide out, given `grid` (piece-id-or-null per
 * cell)? Walks the head's recorded exit route; the rest of the chain
 * only ever moves into cells vacated by its own earlier segments, so
 * it never needs its own collision check.
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

/** Generates a board guaranteed solvable, retrying until verification passes. */
function generatePuzzle(rows, cols, maxPieceLen) {
  for (let attempt = 0; attempt < CONFIG.MAX_GENERATION_TRIES; attempt++) {
    const built = tryBuildPieces(rows, cols, maxPieceLen);
    if (!built) continue;

    const verifyGrid = built.cellOwner.map((row) => row.slice());
    if (verifySolution(built.pieces, verifyGrid, rows, cols)) {
      return { pieces: built.pieces, cellOwner: built.cellOwner, rows, cols };
    }
  }
  throw new Error('Untangle: could not generate a solvable board after ' + CONFIG.MAX_GENERATION_TRIES + ' tries');
}

// =================================================================
// 2. DIFFICULTY PRESETS
//
// Purely parameters fed into the untouched generation algorithm
// above — board size and max piece length only.
// =================================================================

const DIFFICULTY_PRESETS = {
  easy: { rows: 6, cols: 6, maxPieceLen: 4, labelKey: 'diff_easy' },
  medium: { rows: 8, cols: 10, maxPieceLen: 6, labelKey: 'diff_medium' },
  hard: { rows: 10, cols: 13, maxPieceLen: 7, labelKey: 'diff_hard' },
  nightmare: { rows: 13, cols: 16, maxPieceLen: 8, labelKey: 'diff_nightmare' },
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
  maxPieceLen: CONFIG.MAX_PIECE_LEN,
  difficultyKey: 'medium',
  cellOwner: null,       // live grid: piece id or null per cell
  pieces: {},            // id -> piece (+ removed flag)
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
    const puzzle = generatePuzzle(state.rows, state.cols, state.maxPieceLen);
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

/**
 * Every cell's true exit route is: [catch up to the cell ahead of it in
 * the chain, one stored-arrow step at a time, all the way back to the
 * head's original cell] followed by [the head's own multi-step
 * headExitPath]. This is exactly what the chain mechanic guarantees —
 * canPieceExit() already verified headExitPath is clear of every OTHER
 * piece, and the catch-up portion only ever crosses this SAME piece's
 * own (safe) cells — so animating each cell along this full route can
 * never visually cross a cell that still belongs to someone else.
 *
 * (Animating each cell along just its own single stored arrow — what
 * this used to do — does not have that guarantee: that arrow only
 * describes the one step to the cell ahead of it, not a safe direction
 * to fly off the board in, which is exactly what let non-head cells,
 * especially on short edge-adjacent pieces, visually sail straight
 * through unrelated still-present pieces.)
 */
function buildCellFullExitPath(piece, cellIndex) {
  const path = [];
  for (let j = cellIndex; j >= 1; j--) {
    const chainCell = piece.cells[j];
    path.push(piece.arrows[cellKey(chainCell.r, chainCell.c)]);
  }
  for (const dir of piece.headExitPath) {
    path.push(dir);
  }
  return path;
}

/** Web Animations keyframes tracing that full path, in cell-relative
 *  percentages (100% = exactly one cell width/height, so this works
 *  regardless of the board's actual pixel size). Ends with a final
 *  flourish continuing past the board edge while fading out, so the
 *  piece visibly leaves rather than just stopping at the boundary. */
function buildCellExitKeyframes(piece, cellIndex) {
  const fullPath = buildCellFullExitPath(piece, cellIndex);
  const realSpan = 0.82; // fraction of the animation spent on the real, verified-clear route

  let cumDC = 0;
  let cumDR = 0;
  const keyframes = [{ transform: 'translate(0%, 0%)', opacity: 1, offset: 0 }];

  fullPath.forEach((dir, i) => {
    cumDC += dir.dc;
    cumDR += dir.dr;
    keyframes.push({
      transform: `translate(${cumDC * 100}%, ${cumDR * 100}%)`,
      opacity: 1,
      offset: ((i + 1) / fullPath.length) * realSpan,
    });
  });

  const lastDir = fullPath[fullPath.length - 1];
  keyframes.push({
    transform: `translate(${(cumDC + lastDir.dc * 14) * 100}%, ${(cumDR + lastDir.dr * 14) * 100}%)`,
    opacity: 0,
    offset: 1,
  });

  return keyframes;
}

function removePieceWithAnimation(piece) {
  piece.removed = true;
  for (const cell of piece.cells) {
    state.cellOwner[cell.r][cell.c] = null;
  }

  piece.cells.forEach((cell, index) => {
    const el = state.cellElements[cell.r][cell.c];
    const keyframes = buildCellExitKeyframes(piece, index);
    const anim = el.animate(keyframes, {
      duration: CONFIG.EXIT_DURATION_MS,
      delay: index * CONFIG.EXIT_STAGGER_MS,
      easing: 'ease',
      fill: 'forwards',
    });
    anim.onfinish = () => el.classList.add('cell-cleared');
  });

  const totalDelay = (piece.cells.length - 1) * CONFIG.EXIT_STAGGER_MS + CONFIG.EXIT_DURATION_MS;

  state.clearedCells += piece.cells.length;
  updateProgressUI();

  if (state.clearedCells >= state.totalCells) {
    state.gameOver = true;
    if (typeof SoundManager !== 'undefined') SoundManager.playWin();
    vibrate([25, 60, 25, 60, 45]);
    setTimeout(() => {
      recordAndShowWinTime();
      showWinOverlay();
    }, totalDelay + 150);
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
  state.maxPieceLen = preset.maxPieceLen;
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
