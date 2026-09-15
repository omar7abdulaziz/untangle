'use strict';

/* ============================================================
   Untangle — generation solvability check (dev tool, Node only).

   Not loaded by any HTML page and not part of the shipped site —
   this is purely a way to re-prove, on demand, that every
   difficulty always produces a 100% solvable board with no gaps
   or overlaps. It works by loading js/game.js's own source (the
   exact code the browser runs) up to the difficulty-presets
   marker and exercising it directly, so it can never drift out of
   sync with the real generator.

   Run with:  node tools/verify-generation.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const os = require('os');

const GAME_JS_PATH = path.join(__dirname, '..', 'js', 'game.js');
const RUNS_PER_DIFFICULTY = 10;

// Keep these in sync with DIFFICULTY_PRESETS in js/game.js.
const DIFFICULTIES = [
  { key: 'easy', rows: 6, cols: 6, maxDirShare: 0.85 },
  { key: 'medium', rows: 8, cols: 10, maxDirShare: 0.85 },
  { key: 'hard', rows: 10, cols: 13, maxDirShare: 0.85 },
  { key: 'nightmare', rows: 13, cols: 16, maxDirShare: 0.88 },
  { key: 'impossible', rows: 16, cols: 20, maxDirShare: 0.90 },
];

function loadGenerationModule() {
  const fullSource = fs.readFileSync(GAME_JS_PATH, 'utf8');
  // Generation code runs through hasExcessiveDirectionRun, which is
  // defined right before "2. DIFFICULTY PRESETS" — cut just after it
  // instead of at the marker itself so it's included.
  const marker = '// 2. DIFFICULTY PRESETS';
  const cut = fullSource.indexOf(marker);
  if (cut === -1) {
    throw new Error('Could not find the "' + marker + '" marker in js/game.js — has the file been restructured?');
  }
  const generationSource = fullSource.slice(0, cut) + '\nmodule.exports = { generatePuzzle, verifySolution, cellKey };\n';

  const tmpFile = path.join(os.tmpdir(), 'untangle-generation-extract-' + Date.now() + '.js');
  fs.writeFileSync(tmpFile, generationSource);
  try {
    return require(tmpFile);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

/** Independent re-derivation (not calling the game's own
 *  hasExcessiveDirectionRun) of the highest same-direction share in
 *  any row or column, so this check can't silently agree with a bug
 *  in that function. */
function worstRowColShare(pieces, rows, cols, cellKey) {
  const dirAt = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const piece of pieces) {
    const cell = piece.cells[0];
    dirAt[cell.r][cell.c] = piece.headDir.name;
  }
  function maxShareOf(line) {
    const counts = {};
    for (const name of line) counts[name] = (counts[name] || 0) + 1;
    return Math.max(...Object.values(counts)) / line.length;
  }
  let worst = 0;
  for (let r = 0; r < rows; r++) worst = Math.max(worst, maxShareOf(dirAt[r]));
  for (let c = 0; c < cols; c++) {
    const col = [];
    for (let r = 0; r < rows; r++) col.push(dirAt[r][c]);
    worst = Math.max(worst, maxShareOf(col));
  }
  return worst;
}

function checkFullCoverage(cellOwner, rows, cols, pieces, cellKey) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellOwner[r][c] === null) {
        return 'gap at (' + r + ',' + c + ')';
      }
    }
  }
  const seen = new Set();
  let total = 0;
  for (const piece of pieces) {
    for (const cell of piece.cells) {
      const k = cellKey(cell.r, cell.c);
      if (seen.has(k)) return 'overlapping cell at (' + cell.r + ',' + cell.c + ')';
      seen.add(k);
      total++;
    }
  }
  if (total !== rows * cols) return 'cell count mismatch: ' + total + ' vs ' + (rows * cols);
  return null;
}

function main() {
  const { generatePuzzle, verifySolution, cellKey } = loadGenerationModule();

  let allPassed = true;
  const summary = [];

  for (const diff of DIFFICULTIES) {
    let passed = 0;
    let totalMs = 0;
    let maxMs = 0;
    let worstShareSeen = 0;
    let firstFailure = null;

    for (let i = 0; i < RUNS_PER_DIFFICULTY; i++) {
      const t0 = Date.now();
      let puzzle;
      try {
        puzzle = generatePuzzle(diff.rows, diff.cols, diff.maxDirShare);
      } catch (err) {
        firstFailure = firstFailure || ('generation threw: ' + err.message);
        continue;
      }
      const elapsed = Date.now() - t0;
      totalMs += elapsed;
      maxMs = Math.max(maxMs, elapsed);

      const coverageError = checkFullCoverage(puzzle.cellOwner, diff.rows, diff.cols, puzzle.pieces, cellKey);
      if (coverageError) {
        firstFailure = firstFailure || ('run ' + i + ': ' + coverageError);
        continue;
      }

      const verifyGrid = puzzle.cellOwner.map((row) => row.slice());
      const solvable = verifySolution(puzzle.pieces, verifyGrid, diff.rows, diff.cols);
      if (!solvable) {
        firstFailure = firstFailure || ('run ' + i + ': reverse-order playback did not fully clear the board');
        continue;
      }

      const worstShare = worstRowColShare(puzzle.pieces, diff.rows, diff.cols, cellKey);
      worstShareSeen = Math.max(worstShareSeen, worstShare);
      if (worstShare > diff.maxDirShare + 1e-9) {
        firstFailure = firstFailure || ('run ' + i + ': a row/column was ' + (worstShare * 100).toFixed(1) + '% one direction, over the ' + (diff.maxDirShare * 100).toFixed(0) + '% cap');
        continue;
      }

      passed++;
    }

    const ok = passed === RUNS_PER_DIFFICULTY;
    allPassed = allPassed && ok;
    summary.push({
      key: diff.key,
      grid: diff.rows + 'x' + diff.cols,
      passed,
      of: RUNS_PER_DIFFICULTY,
      avgMs: (totalMs / Math.max(passed, 1)).toFixed(2),
      maxMs,
      worstShareSeen: (worstShareSeen * 100).toFixed(1),
      capPct: (diff.maxDirShare * 100).toFixed(0),
      ok,
      firstFailure,
    });
  }

  console.log('Untangle — generation solvability + direction-variety check (' + RUNS_PER_DIFFICULTY + ' runs per difficulty)\n');
  for (const row of summary) {
    const status = row.ok ? 'PASS' : 'FAIL';
    console.log(
      '  [' + status + ']  ' + row.key.padEnd(11) + row.grid.padEnd(8) +
      row.passed + '/' + row.of + ' solvable    cap=' + row.capPct + '%  worstSeen=' + row.worstShareSeen + '%' +
      '    avg ' + row.avgMs + 'ms  max ' + row.maxMs + 'ms'
    );
    if (!row.ok && row.firstFailure) {
      console.log('           ↳ first failure: ' + row.firstFailure);
    }
  }

  console.log('\n' + (allPassed ? 'ALL DIFFICULTIES: 100% SOLVABLE ✔' : 'FAILURES DETECTED ✘'));
  process.exit(allPassed ? 0 : 1);
}

main();
