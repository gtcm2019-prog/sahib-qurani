// Application installable : service worker, bouton « Installer », guide iPhone.
import { $, $$ } from './ui.js';

let deferred = null;   // événement d'installation (Android / Chrome / Edge)

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

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
  window.addEventListener('appinstalled', () => { deferred = null; refresh(); });
  $$('.btn-install').forEach(b => b.addEventListener('click', onInstallClick));
  $('#ios-guide-close').addEventListener('click', () => $('#ios-guide').close());
  $('#ios-guide').addEventListener('click', e => { if (e.target.id === 'ios-guide') e.target.close(); });
  refresh();
}
