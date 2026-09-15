'use strict';

/* Untangle — landing page interactions:
   - smooth scroll to the difficulty section from the hero CTA
   - each difficulty card shows a "Best: mm:ss" badge once one exists
   - the last-played difficulty card gets a subtle highlight

   Difficulty cards are plain links (?difficulty=easy|medium|hard|
   nightmare), so navigation itself needs no JS and still works with
   JS disabled — everything here is a progressive enhancement. */

function formatClockTime(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

function enhanceDifficultyCards() {
  const cards = document.querySelectorAll('.difficulty-card[data-difficulty]');
  const lastDifficulty = typeof getLastDifficulty === 'function' ? getLastDifficulty() : null;

  cards.forEach((card) => {
    const key = card.dataset.difficulty;

    const best = typeof getBestTimeMs === 'function' ? getBestTimeMs(key) : null;
    if (best !== null) {
      const badge = document.createElement('span');
      badge.className = 'difficulty-best-badge';
      const label = typeof t === 'function' ? t('diff_best_label') : 'Best';
      badge.innerHTML = label + ' <span dir="ltr">' + formatClockTime(best) + '</span>';
      card.appendChild(badge);
    }

    if (key === lastDifficulty) {
      card.classList.add('is-last-played');
      const tag = document.createElement('span');
      tag.className = 'difficulty-last-tag';
      tag.dataset.i18n = 'diff_last_played';
      tag.textContent = typeof t === 'function' ? t('diff_last_played') : 'Last played';
      card.appendChild(tag);
    }
  });

}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  enhanceDifficultyCards();
  // Re-run on language toggle so the injected "Best" / "Last played"
  // text swaps languages along with everything else on the page.
  document.addEventListener('untangle:langchange', () => {
    document.querySelectorAll('.difficulty-best-badge, .difficulty-last-tag').forEach((el) => el.remove());
    enhanceDifficultyCards();
  });
});
