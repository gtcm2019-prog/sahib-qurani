// Partage de l'application via WhatsApp + lien de parrainage personnel.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $ } from './ui.js';

const SITE = 'https://sahibqurani.com';
const CODE_RE = /^[A-Z2-9]{6}$/;
let code = null, codeFor = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
const quiet = q => q.then(() => {}, () => {});

// Arrivée par un lien ?r=CODE : compter la visite une fois par navigateur, garder le parrain
export function captureRef() {
  const url = new URL(location.href);
  const r = (url.searchParams.get('r') || '').toUpperCase();
  if (!url.searchParams.has('r')) return;
  url.searchParams.delete('r');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (!CODE_RE.test(r)) return;
  if (!store.get('sq_ref')) store.set('sq_ref', r);
  const seen = (store.get('sq_ref_seen') || '').split(',').filter(Boolean);
  if (!seen.includes(r)) {
    store.set('sq_ref_seen', [...seen, r].slice(-20).join(','));
    quiet(sb.rpc('track_ref_visit', { p_code: r }));
  }
}

// Membre connecté : préparer son code, rattacher son éventuel parrain
export async function onSession(session) {
  if (!session) { code = null; codeFor = null; return; }
  const uid = session.user.id;
  if (codeFor !== uid) {
    codeFor = uid; code = null;
    const { data } = await sb.rpc('get_my_share_code');
    if (codeFor === uid && typeof data === 'string' && CODE_RE.test(data)) code = data;
  }
  const ref = store.get('sq_ref');
  if (ref) {
    store.del('sq_ref');
    if (ref !== code) quiet(sb.rpc('claim_referral', { p_code: ref }));
  }
}

// Bouton « Partager » : WhatsApp s'ouvre tout de suite (sinon le navigateur bloque la fenêtre)
export function bindShare() {
  $('#tab-share').addEventListener('click', () => {
    const url = code ? `${SITE}/?r=${code}` : SITE;
    window.open('https://wa.me/?text=' + encodeURIComponent(t('share.msg', { url })), '_blank', 'noopener');
    quiet(sb.rpc('log_share', { p_lang: lang() }));
  });
}
