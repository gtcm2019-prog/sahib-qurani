// Notifications push : abonnement de l'appareil et envoi via la fonction « notify ».
import { sb } from './sb.js';
import { t } from './i18n.js';
import { $ } from './ui.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;

function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

// Prévenir l'autre membre (ne bloque jamais l'action en cas d'échec)
export function notify(type, id) {
  sb.functions.invoke('notify', { body: { type, id } }).catch(() => {});
}

// Ne jamais attendre indéfiniment le service worker (sinon des boutons restent bloqués)
async function currentSub() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, no) => setTimeout(() => no(new Error('sw timeout')), 3000))
  ]);
  return reg.pushManager.getSubscription();
}

function setState(key, type = 'muted') {
  const s = $('#notif-state');
  s.textContent = key ? t(key) : '';
  s.className = 'small ' + type;
}

export async function renderNotif() {
  const chk = $('#chk-notif'), test = $('#btn-notif-test');
  test.hidden = true;
  if (!supported()) {
    chk.disabled = true; chk.checked = false;
    setState(isIOS && !isStandalone() ? 'notif.ios_install' : 'notif.unsupported');
    return;
  }
  if (Notification.permission === 'denied') {
    chk.disabled = true; chk.checked = false;
    setState('notif.denied', 'error-text');
    return;
  }
  chk.disabled = false;
  const sub = await currentSub().catch(() => null);
  chk.checked = !!sub && Notification.permission === 'granted';
  test.hidden = !chk.checked;
  setState(chk.checked ? 'notif.on' : '');
}

async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return renderNotif();
  const { data, error } = await sb.functions.invoke('notify', { body: { type: 'key' } });
  if (error || !data?.key) { setState('notif.server', 'error-text'); return false; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(data.key) });
  const j = sub.toJSON();
  const { error: e2 } = await sb.rpc('save_push_subscription',
    { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (e2) { console.warn(e2); setState('err.generic', 'error-text'); return false; }
  return true;
}

export async function disable() {
  if (!supported()) return;
  const sub = await currentSub().catch(() => null);
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).then(() => {}, () => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export function bindNotif() {
  const chk = $('#chk-notif');
  chk.addEventListener('change', async () => {
    chk.disabled = true;
    try {
      if (chk.checked) await enable(); else await disable();
    } catch (e) { console.warn(e); setState('err.generic', 'error-text'); }
    chk.disabled = false;
    renderNotif();
  });
  $('#btn-notif-test').addEventListener('click', async () => {
    const { data, error } = await sb.functions.invoke('notify', { body: { type: 'test' } });
    if (data?.sent) return setState('notif.test_sent');
    // Diagnostic : code renvoyé par le serveur
    let detail = data ? JSON.stringify(data) : '';
    if (error) {
      const res = error.context;
      let body = '';
      try { body = res && typeof res.text === 'function' ? await res.text() : ''; } catch (e) { /* ignore */ }
      detail = `${res?.status || ''} ${body || error.message}`.trim();
    }
    setState('notif.server', 'error-text');
    $('#notif-state').textContent += ' [' + detail.slice(0, 160) + ']';
  });
}
