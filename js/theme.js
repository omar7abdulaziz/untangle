'use strict';

/* ============================================================
   Untangle — light/dark theme toggle.
   The very first paint is handled by a tiny inline script in each
   page's <head> (reads storage directly, sets data-theme before any
   CSS is applied, avoids a flash of the wrong theme). This file
   only wires the toggle button(s) and keeps everything in sync
   after that, including repainting already-rendered puzzle pieces
   on the game page (their colors are inline JS styles, not CSS).
   ============================================================ */

function themeSystemPrefersDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getCurrentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return themeSystemPrefersDark() ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    const iconLight = btn.querySelector('.icon-theme-light');
    const iconDark = btn.querySelector('.icon-theme-dark');
    const isDark = theme === 'dark';
    if (iconLight) iconLight.hidden = isDark;
    if (iconDark) iconDark.hidden = !isDark;
    btn.dataset.i18nAttr = 'aria-label:' + (isDark ? 'theme_light' : 'theme_dark');
  });
  if (typeof applyTranslations === 'function') applyTranslations();
  document.dispatchEvent(new CustomEvent('untangle:themechange', { detail: { theme } }));
}

function toggleTheme() {
  const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (typeof setThemePref === 'function') setThemePref(next);
}

function initTheme() {
  applyTheme(getCurrentTheme());
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });
}

document.addEventListener('DOMContentLoaded', initTheme);
