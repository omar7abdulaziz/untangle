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
const RUNS_PER_DIFFICULTY = 20;

const DIFFICULTIES = [
  { key: 'easy', rows: 6, cols: 6 },
  { key: 'medium', rows: 8, cols: 10 },
  { key: 'hard', rows: 10, cols: 13 },
  { key: 'nightmare', rows: 13, cols: 16 },
];

function loadGenerationModule() {
  const fullSource = fs.readFileSync(GAME_JS_PATH, 'utf8');
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
    let firstFailure = null;

    for (let i = 0; i < RUNS_PER_DIFFICULTY; i++) {
      const t0 = Date.now();
      let puzzle;
      try {
        puzzle = generatePuzzle(diff.rows, diff.cols);
      } catch (err) {
        firstFailure = firstFailure || ('generation threw: ' + err.message);
        continue;
      }
      totalMs += Date.now() - t0;

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
      ok,
      firstFailure,
    });
  }

  console.log('Untangle — generation solvability check (' + RUNS_PER_DIFFICULTY + ' runs per difficulty)\n');
  for (const row of summary) {
    const status = row.ok ? 'PASS' : 'FAIL';
    console.log(
      '  [' + status + ']  ' + row.key.padEnd(10) + row.grid.padEnd(8) +
      row.passed + '/' + row.of + ' solvable    avg ' + row.avgMs + 'ms'
    );
    if (!row.ok && row.firstFailure) {
      console.log('           ↳ first failure: ' + row.firstFailure);
    }
  }

  console.log('\n' + (allPassed ? 'ALL DIFFICULTIES: 100% SOLVABLE ✔' : 'FAILURES DETECTED ✘'));
  process.exit(allPassed ? 0 : 1);
}

main();
