import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Messages ---------- */
export function showMsg(form, key, type = 'error', vars) {
  const box = $('.msg', form);
  box.textContent = t(key, vars);
  box.className = 'msg ' + type;
  box.hidden = false;
}

export function errKey(error) {
  const m = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (code === 'email_not_confirmed' || m.includes('not confirmed')) return 'err.not_confirmed';
  if (code === 'invalid_credentials' || m.includes('invalid login')) return 'err.invalid_login';
  if (m.includes('rate limit') || code.includes('rate_limit') || error?.status === 429) return 'err.rate_limit';
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return 'err.google_off';
  if (code === 'same_password') return 'err.same_password';
  if (code === 'weak_password' || m.includes('password')) return 'err.pw_rule';
  if (m.includes('failed to fetch') || m.includes('network')) return 'err.network';
  return 'err.generic';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const pwOk = pw => pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

export function busy(form, on) {
  $$('button, input, select, textarea', form).forEach(el => { el.disabled = on; });
}

