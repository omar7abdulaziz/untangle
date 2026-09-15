'use strict';

/* ============================================================
   Untangle — tiny bilingual (EN/AR) text layer.
   Shared by index.html (landing) and play.html (game).
   ============================================================ */

const I18N_DICT = {
  en: {
    // Page titles (tab title only — kept distinct from on-page headings
    // so the SEO-friendly long form survives language toggling)
    title_landing: 'Untangle — A Calm Sliding Puzzle',
    title_play: 'Untangle — Play',

    // Landing
    brand: 'Untangle',
    brand_tagline: 'A calm puzzle of knots and lines.',
    nav_play: 'Play',
    hero_kicker: 'A quiet sliding puzzle',
    hero_title: 'Untangle',
    hero_subtitle: 'Every board is a tangle of arrows. Slide each piece free in the right order and the whole thing comes undone.',
    hero_cta: 'Play Now',
    how_title: 'How to play',
    how_1_title: 'Tap a piece',
    how_1_body: 'Every group of cells is one piece, marked with its own arrows.',
    how_2_title: 'Follow its arrows',
    how_2_body: 'The arrows trace the exact path the piece would slide along.',
    how_3_title: 'Clear path, clean exit',
    how_3_body: 'If nothing blocks that path, the piece slides off the board.',
    how_4_title: 'Empty the board',
    how_4_body: 'Clear every piece before you run out of attempts to win.',
    difficulty_title: 'Choose your difficulty',
    difficulty_subtitle: 'Board size and piece length scale up — the puzzle logic stays exactly the same.',
    diff_easy: 'Easy',
    diff_easy_desc: 'A small board and short pieces. Good for a first try.',
    diff_medium: 'Medium',
    diff_medium_desc: 'A balanced board with a bit more tangle.',
    diff_hard: 'Hard',
    diff_hard_desc: 'A large board with long, winding pieces.',
    diff_nightmare: 'Nightmare',
    diff_nightmare_desc: 'As big and as tangled as it gets.',
    diff_impossible: 'Impossible',
    diff_impossible_desc: 'A huge board, one mistake and it’s over. Not for the faint of heart.',
    diff_grid_label: 'Grid',
    diff_play: 'Play',
    footer_signature: 'Made by Omar',

    // Game page
    back: 'Back',
    attempts: 'Attempts',
    new_puzzle: 'New Puzzle',
    win_title: 'Board Cleared!',
    win_desc: 'Every piece slid off the board.',
    new_level: 'New Level',
    lose_title: 'Out of Attempts',
    lose_desc: 'No moves left. Try this board again.',
    retry: 'Retry',
    mute_on: 'Mute sound',
    mute_off: 'Unmute sound',
    cleared_in: 'Cleared in',
    new_best: 'New personal best!',
    best_time: 'Best',
    loading: 'Shuffling the board…',
    diff_best_label: 'Best',
    diff_last_played: 'Last played',
    theme_dark: 'Switch to dark mode',
    theme_light: 'Switch to light mode',
    hint: 'Hint',
    share: 'Share',
    share_copied: 'Copied to clipboard',
    share_cleared: 'I cleared Untangle’s',
    share_board_in: 'board in',
  },
  ar: {
    // Page titles (tab title only)
    title_landing: 'Untangle — لغز انزلاقي هادئ',
    title_play: 'Untangle — العب',

    // Landing
    brand: 'Untangle',
    brand_tagline: 'فَكّ — لغز هادئ من العقد والخطوط.',
    nav_play: 'العب',
    hero_kicker: 'لغز انزلاقي هادئ',
    hero_title: 'Untangle',
    hero_subtitle: 'كل لوحة عبارة عن عقدة من الأسهم. أخرج كل قطعة بالترتيب الصحيح، وستنحل العقدة كاملة.',
    hero_cta: 'العب الآن',
    how_title: 'كيف تلعب',
    how_1_title: 'اضغط على قطعة',
    how_1_body: 'كل مجموعة خلايا متصلة هي قطعة واحدة، مُعلَّمة بأسهمها الخاصة.',
    how_2_title: 'تابع اتجاه أسهمها',
    how_2_body: 'الأسهم ترسم المسار الذي ستنزلق عبره القطعة بالضبط.',
    how_3_title: 'مسار خالٍ = خروج نظيف',
    how_3_body: 'إذا لم يكن هناك ما يعيق هذا المسار، تنزلق القطعة خارج اللوحة.',
    how_4_title: 'أفرغ اللوحة',
    how_4_body: 'أخرج كل القطع قبل نفاد محاولاتك لتفوز.',
    difficulty_title: 'اختر مستوى الصعوبة',
    difficulty_subtitle: 'حجم اللوحة وطول القطع يتغيران — ومنطق اللغز يبقى كما هو تمامًا.',
    diff_easy: 'سهل',
    diff_easy_desc: 'لوحة صغيرة وقطع قصيرة. مناسبة لأول محاولة.',
    diff_medium: 'متوسط',
    diff_medium_desc: 'لوحة متوازنة بتعقيد أكبر قليلًا.',
    diff_hard: 'صعب',
    diff_hard_desc: 'لوحة كبيرة بقطع طويلة ومتعرجة.',
    diff_nightmare: 'كابوس',
    diff_nightmare_desc: 'أكبر وأكثر تعقيدًا ما يمكن.',
    diff_impossible: 'مستحيل',
    diff_impossible_desc: 'لوحة ضخمة، وخطأ واحد يُنهي اللعبة. ليست لضعاف القلوب.',
    diff_grid_label: 'الشبكة',
    diff_play: 'العب',
    footer_signature: 'Made by Omar',

    // Game page
    back: 'رجوع',
    attempts: 'المحاولات',
    new_puzzle: 'لوحة جديدة',
    win_title: 'اكتملت اللوحة!',
    win_desc: 'خرجت كل القطع من اللوحة.',
    new_level: 'مستوى جديد',
    lose_title: 'نفدت المحاولات',
    lose_desc: 'لا محاولات متبقية. جرّب هذه اللوحة مجددًا.',
    retry: 'أعد المحاولة',
    mute_on: 'كتم الصوت',
    mute_off: 'تشغيل الصوت',
    cleared_in: 'أنجزتها خلال',
    new_best: 'رقم قياسي جديد!',
    best_time: 'الأفضل',
    loading: 'يُعاد ترتيب اللوحة…',
    diff_best_label: 'الأفضل',
    diff_last_played: 'آخر ما لعبته',
    theme_dark: 'التبديل للوضع الداكن',
    theme_light: 'التبديل للوضع الفاتح',
    hint: 'تلميح',
    share: 'شارك',
    share_copied: 'تم النسخ',
    share_cleared: 'فكّيت لوحة Untangle',
    share_board_in: 'خلال',
  },
};

const I18N_STORAGE_KEY = 'untangle-lang';

function i18nGetSavedLang() {
  try {
    return localStorage.getItem(I18N_STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

function i18nSaveLang(lang) {
  try {
    localStorage.setItem(I18N_STORAGE_KEY, lang);
  } catch (e) {
    /* private mode / storage disabled — language just won't persist */
  }
}

function i18nDetectInitialLang() {
  const saved = i18nGetSavedLang();
  if (saved === 'en' || saved === 'ar') return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('ar') ? 'ar' : 'en';
}

let currentLang = i18nDetectInitialLang();

function t(key) {
  const dict = I18N_DICT[currentLang] || I18N_DICT.en;
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
}

function applyTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  if (document.title && document.body.dataset.titleKey) {
    document.title = t(document.body.dataset.titleKey);
  }
}

function refreshLangUI() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
  applyTranslations();
  document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
    btn.textContent = currentLang === 'ar' ? 'English' : 'العربية';
  });
}

function setLang(lang) {
  currentLang = lang === 'ar' ? 'ar' : 'en';
  i18nSaveLang(currentLang);
  refreshLangUI();
  document.dispatchEvent(new CustomEvent('untangle:langchange', { detail: { lang: currentLang } }));
}

function initI18n() {
  refreshLangUI();
  document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => setLang(currentLang === 'ar' ? 'en' : 'ar'));
  });
}

document.addEventListener('DOMContentLoaded', initI18n);
