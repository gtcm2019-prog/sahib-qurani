// Application installable : service worker, bouton « Installer », guide iPhone.
import { $, $$ } from './ui.js';
import { sb } from './sb.js';

let deferred = null;   // événement d'installation (Android / Chrome / Edge)

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------- Statistiques d'installation (identifiant aléatoire, anonyme) ---------- */
const platform = () => /android/i.test(ua) ? 'android' : isIOS ? 'ios' : /Windows|Macintosh|Linux|CrOS/.test(ua) ? 'desktop' : 'other';
function deviceId() {
  try {
    let d = localStorage.getItem('sq_dev');
    if (!d && crypto.randomUUID) { d = crypto.randomUUID(); localStorage.setItem('sq_dev', d); }
    return d;
  } catch (e) { return null; }
}
// Appli installée ouverte : signal au plus toutes les 12 h (ou tout de suite à l'installation / connexion)
export function pingApp(force, install) {
  if (!install && !isStandalone()) return;
  const id = deviceId();
  if (!id) return;
  try {
    const last = Number(localStorage.getItem('sq_ping')) || 0;
    if (!force && !install && Date.now() - last < 12 * 3600e3) return;
    localStorage.setItem('sq_ping', String(Date.now()));
  } catch (e) { /* ignore */ }
  sb.rpc('app_ping', { p_device: id, p_platform: platform(), p_install: !!install }).then(() => {}, () => {});
}

function refresh() {
  const installed = isStandalone();
  // On montre le bouton si l'installation est possible (Android/ordinateur) ou si on est sur iPhone
  const canShow = !installed && (deferred || isIOS);
  $$('[data-install]').forEach(el => { el.hidden = !canShow; });
  $$('[data-installed]').forEach(el => { el.hidden = !installed; });
}

async function onInstallClick() {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    refresh();
    return;
  }
  if (isIOS) {
    $('#ios-guide-other').hidden = isSafari;
    $('#ios-guide').showModal();
  }
}

export function initPwa() {
  if ('serviceWorker' in navigator) {
    const reg = () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('sw', err));
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    refresh();
  });
  window.addEventListener('appinstalled', () => { deferred = null; refresh(); pingApp(true, true); });
  $$('.btn-install').forEach(b => b.addEventListener('click', onInstallClick));
  $('#ios-guide-close').addEventListener('click', () => $('#ios-guide').close());
  $('#ios-guide').addEventListener('click', e => { if (e.target.id === 'ios-guide') e.target.close(); });
  refresh();
  pingApp();
}
