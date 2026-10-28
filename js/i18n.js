import { LANGS, DEFAULT_LANG } from './config.js';

let dict = {};
let current = DEFAULT_LANG;

export function detectLang() {
  try {
    const saved = localStorage.getItem('sq_lang');
    if (LANGS.includes(saved)) return saved;
  } catch (e) { /* stockage indisponible */ }
  const prefs = navigator.languages || [navigator.language || ''];
  for (const p of prefs) {
    const code = String(p).slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return DEFAULT_LANG;
}

export async function setLang(code) {
  if (!LANGS.includes(code)) code = DEFAULT_LANG;
  const res = await fetch(`lang/${code}.json`, { cache: 'no-cache' });
  dict = await res.json();
  current = code;
  try { localStorage.setItem('sq_lang', code); } catch (e) { /* ignore */ }
  document.documentElement.lang = code;
  document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
  apply(document);
}

export function lang() { return current; }

// Traduction avec variables {n}. Retourne la clé si absente.
export function t(key, vars) {
  let s = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
  if (typeof s !== 'string') return key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, String(vars[k]));
  return s;
}

// Remplit les éléments marqués, toujours en textContent (jamais innerHTML).
export function apply(root) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.title = t('app.title');
}
