import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { detectLang, setLang, lang, t } from './i18n.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
});

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Adresse de base du site (fonctionne aussi dans un sous-dossier).
const BASE = location.origin + location.pathname;

let session = null;

/* ---------- Navigation ---------- */
const PUBLIC_VIEWS = ['home', 'login', 'signup', 'forgot'];
const PRIVATE_VIEWS = ['profile', 'reset'];

function currentView() {
  const v = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'home';
  return [...PUBLIC_VIEWS, ...PRIVATE_VIEWS].includes(v) ? v : 'home';
}

export function go(view) { location.hash = '#/' + view; }

function render() {
  let v = currentView();
  if (PRIVATE_VIEWS.includes(v) && !session) v = 'login';
  if (['login', 'signup'].includes(v) && session) v = 'profile';
  $$('[data-view]').forEach(el => { el.hidden = el.dataset.view !== v; });
  $$('.msg').forEach(el => { el.hidden = true; el.textContent = ''; });
  $$('[data-auth]').forEach(el => { el.hidden = (el.dataset.auth === 'in') !== !!session; });
  window.scrollTo(0, 0);
}

/* ---------- Messages ---------- */
function showMsg(form, key, type = 'error', vars) {
  const box = $('.msg', form);
  box.textContent = t(key, vars);
  box.className = 'msg ' + type;
  box.hidden = false;
}

function errKey(error) {
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const pwOk = pw => pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

function busy(form, on) {
  $$('button, input', form).forEach(el => { el.disabled = on; });
}

/* ---------- Formulaires ---------- */
function bindForms() {
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim(), password = f.password.value;
    if (!EMAIL_RE.test(email)) return showMsg(f, 'err.invalid_email');
    busy(f, true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    busy(f, false);
    if (error) {
      const k = errKey(error);
      showMsg(f, k);
      $('#resend-wrap').hidden = k !== 'err.not_confirmed';
      return;
    }
    f.reset();
  });

  $('#btn-resend').addEventListener('click', async () => {
    const f = $('#form-login');
    const email = f.email.value.trim();
    if (!EMAIL_RE.test(email)) return showMsg(f, 'err.invalid_email');
    const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: BASE } });
    showMsg(f, error ? errKey(error) : 'auth.resent', error ? 'error' : 'ok');
  });

  $('#form-signup').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim(), pw = f.password.value, pw2 = f.password2.value;
    if (!EMAIL_RE.test(email)) return showMsg(f, 'err.invalid_email');
    if (!pwOk(pw)) return showMsg(f, 'err.pw_rule');
    if (pw !== pw2) return showMsg(f, 'err.pw_mismatch');
    busy(f, true);
    const { error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: BASE } });
    busy(f, false);
    if (error) return showMsg(f, errKey(error));
    f.reset();
    showMsg(f, 'auth.check_email', 'ok');
  });

  $('#form-forgot').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    if (!EMAIL_RE.test(email)) return showMsg(f, 'err.invalid_email');
    busy(f, true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: BASE + '?reset=1' });
    busy(f, false);
    if (error) return showMsg(f, errKey(error));
    f.reset();
    showMsg(f, 'auth.reset_sent', 'ok');
  });

  $('#form-reset').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const pw = f.password.value, pw2 = f.password2.value;
    if (!pwOk(pw)) return showMsg(f, 'err.pw_rule');
    if (pw !== pw2) return showMsg(f, 'err.pw_mismatch');
    busy(f, true);
    const { error } = await sb.auth.updateUser({ password: pw });
    busy(f, false);
    if (error) return showMsg(f, errKey(error));
    f.reset();
    showMsg(f, 'auth.reset_done', 'ok');
    setTimeout(() => go('profile'), 1500);
  });

  $$('.btn-google').forEach(btn => btn.addEventListener('click', async () => {
    const f = btn.closest('form') || btn.closest('section');
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: BASE } });
    if (error) showMsg(f, errKey(error));
  }));

  $('#btn-logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    go('home');
  });

  // Afficher / masquer le mot de passe
  $$('.pw-toggle').forEach(btn => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
  }));
}

/* ---------- Langue ---------- */
function bindLang() {
  const sel = $('#lang-select');
  sel.value = lang();
  sel.addEventListener('change', async () => { await setLang(sel.value); render(); loadStats(); });
}

/* ---------- Statistiques publiques ---------- */
async function loadStats() {
  const box = $('#stats');
  try {
    const { data, error } = await sb.rpc('count_members_by_country');
    if (error || !Array.isArray(data) || !data.length) { box.hidden = true; return; }
    let total = 0;
    for (const row of data) {
      const n = Object.values(row).find(v => typeof v === 'number' || /^\d+$/.test(String(v)));
      total += Number(n) || 0;
    }
    if (!total) { box.hidden = true; return; }
    box.textContent = t('home.members', { n: total.toLocaleString(lang()), c: data.length });
    box.hidden = false;
  } catch (e) { box.hidden = true; }
}

/* ---------- Démarrage ---------- */
async function start() {
  await setLang(detectLang());
  bindLang();
  bindForms();

  const params = new URLSearchParams(location.search);
  const wantsReset = params.has('reset');

  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === 'PASSWORD_RECOVERY') go('reset');
    else if (event === 'SIGNED_IN' && ['login', 'signup', 'home'].includes(currentView()) && !wantsReset) go('profile');
    render();
  });

  const { data } = await sb.auth.getSession();
  session = data.session;

  // Nettoyer l'adresse après un lien e-mail ou Google (?code=…)
  if (params.has('code') || wantsReset || params.has('error')) {
    if (params.has('error')) console.warn('auth', params.get('error_description'));
    history.replaceState(null, '', BASE + (wantsReset && session ? '#/reset' : location.hash));
  }

  window.addEventListener('hashchange', render);
  render();
  loadStats();
  document.body.classList.add('ready');
}

start();
