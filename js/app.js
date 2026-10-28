import { sb } from './sb.js';
import { detectLang, setLang, lang, t } from './i18n.js';
import { $, $$, showMsg, errKey, busy, EMAIL_RE, pwOk } from './ui.js';
import { showProfile, showEdit, bindProfile, resetProfileCache } from './profile.js';
import { showSearch, showMember, showRequests, bindMatch, refreshCount, resetMatch } from './match.js';
import { initPwa } from './pwa.js';
import { disable as disableNotif } from './notify.js';
import { showAdmin, bindAdmin, checkAdmin, resetAdmin, refreshAdminCount } from './admin.js';
import { captureRef, onSession as shareSession, bindShare } from './share.js';
import { showPartnerCard } from './partner.js';
import { syncTz, resetTz } from './clock.js';
// Adresse de base du site (fonctionne aussi dans un sous-dossier).
const BASE = location.origin + location.pathname;

let session = null;

/* ---------- Navigation ---------- */
const PUBLIC_VIEWS = ['home', 'login', 'signup', 'forgot'];
const PRIVATE_VIEWS = ['profile', 'edit', 'reset', 'search', 'member', 'requests', 'admin'];

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
  if (v === 'profile') showProfile(session);
  if (v === 'edit') showEdit(session);
  if (v === 'search') showSearch(session);
  if (v === 'member') showMember(session);
  if (v === 'requests') showRequests(session);
  if (v === 'admin') showAdmin(session);
  if (v === 'home') showPartnerCard(session);
  const tab = v === 'member' ? 'search' : v === 'edit' ? 'profile' : v;
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  document.body.classList.toggle('has-tabs', !!session);
  if (session) { syncTz(session); refreshCount(false, session); checkAdmin(session).then(a => { if (a) refreshAdminCount(); }); }
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
    await disableNotif().catch(() => {});   // cet appareil ne reçoit plus les notifications du compte
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
  const seg = $('#lang-seg');
  const mark = () => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang())));
  mark();
  seg.addEventListener('click', async e => {
    const b = e.target.closest('button[data-lang]');
    if (!b || b.dataset.lang === lang()) return;
    await setLang(b.dataset.lang); mark(); render(); loadStats();
  });
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
  bindShare();
  bindForms();
  bindProfile(go);
  bindMatch(go);
  bindAdmin();
  initPwa();
  // Nouvelle version installée : recharger une fois pour l'utiliser
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  captureRef();
  const params = new URLSearchParams(location.search);
  const wantsReset = params.has('reset');

  sb.auth.onAuthStateChange((event, s) => {
    const changed = (session?.user?.id || null) !== (s?.user?.id || null);
    session = s;
    if (changed) { resetProfileCache(); resetMatch(); resetAdmin(); resetTz(); }
    // Hors du rappel d'authentification (évite un blocage de supabase-js)
    setTimeout(() => shareSession(s), 0);
    if (!changed && event === 'TOKEN_REFRESHED') return;
    if (event === 'PASSWORD_RECOVERY') go('reset');
    else if (event === 'SIGNED_IN' && changed && ['login', 'signup'].includes(currentView()) && !wantsReset) go('home');
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
  // Pastille des demandes : mise à jour au retour sur l'onglet et chaque minute
  document.addEventListener('visibilitychange', () => { if (!document.hidden && session) refreshCount(true, session); });
  setInterval(() => { if (!document.hidden && session) refreshCount(true, session); }, 60000);
  render();
  loadStats();
  document.body.classList.add('ready');
}

start();
