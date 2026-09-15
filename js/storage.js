'use strict';

/* ============================================================
   Untangle — tiny safe localStorage wrapper.
   Every call is guarded; if storage is unavailable (private
   browsing, disabled, quota exceeded) the game just runs without
   persistence — never throws, never logs to console.
   ============================================================ */

const STORAGE_PREFIX = 'untangle:';

function storageProbe() {
  try {
    const key = STORAGE_PREFIX + '__probe__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

const STORAGE_OK = storageProbe();

function storageGet(key) {
  if (!STORAGE_OK) return null;
  try {
    return localStorage.getItem(STORAGE_PREFIX + key);
  } catch (e) {
    return null;
  }
}

function storageSet(key, value) {
  if (!STORAGE_OK) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch (e) {
    /* quota exceeded or storage disabled mid-session — ignore */
  }
}

function storageGetJSON(key) {
  const raw = storageGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function storageSetJSON(key, value) {
  try {
    storageSet(key, JSON.stringify(value));
  } catch (e) {
    /* ignore */
  }
}

// ---------------------------------------------------------------
// Untangle-specific helpers
// ---------------------------------------------------------------

function getLastDifficulty() {
  return storageGet('lastDifficulty');
}

function setLastDifficulty(key) {
  storageSet('lastDifficulty', key);
}

/** Best (lowest) clear time in ms for a difficulty, or null if none yet. */
function getBestTimeMs(difficultyKey) {
  const all = storageGetJSON('bestTimes') || {};
  return typeof all[difficultyKey] === 'number' ? all[difficultyKey] : null;
}

/**
 * Records a finished-board time if it beats the stored best.
 * Returns { best, isNewBest } — `best` is always the best known time
 * after this call (the new one if it won, the old one otherwise).
 */
function recordBestTimeMs(difficultyKey, elapsedMs) {
  const all = storageGetJSON('bestTimes') || {};
  const prev = typeof all[difficultyKey] === 'number' ? all[difficultyKey] : null;
  const isNewBest = prev === null || elapsedMs < prev;
  if (isNewBest) {
    all[difficultyKey] = elapsedMs;
    storageSetJSON('bestTimes', all);
  }
  return { best: isNewBest ? elapsedMs : prev, isNewBest };
}

function getMutedPref() {
  return storageGet('muted') === 'true';
}

function setMutedPref(muted) {
  storageSet('muted', muted ? 'true' : 'false');
}

/** 'light' | 'dark' | null (null = no explicit choice, follow system). */
function getThemePref() {
  const v = storageGet('theme');
  return v === 'light' || v === 'dark' ? v : null;
}

function setThemePref(theme) {
  storageSet('theme', theme === 'dark' ? 'dark' : 'light');
}
