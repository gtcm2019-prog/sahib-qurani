// Service worker Sahib Qurani : site disponible hors ligne (coquille), données toujours en direct.
const VERSION = 'sq5-v4';   // test V5 : caches séparés du site principal
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/sb.js', 'js/ui.js', 'js/i18n.js', 'js/config.js', 'js/data.js', 'js/card.js',
  'js/avatar.js', 'js/profile.js', 'js/match.js', 'js/trust.js', 'js/admin.js', 'js/pwa.js', 'js/notify.js', 'js/share.js', 'js/clock.js', 'js/partner.js', 'js/plan.js', 'js/hizbpages.js', 'js/onboard.js', 'js/stats.js', 'js/pseudo.js',
  'js/vendor/supabase.js',
  'lang/ar.json', 'lang/fr.json', 'lang/en.json', 'lang/es.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'icons/flags/ar.svg', 'icons/flags/fr.svg', 'icons/flags/en.svg', 'icons/flags/es.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  // Pas d'activation immédiate : la page affiche le bandeau « Mise à jour disponible »
});

// Bouton « Mettre à jour » : activer la nouvelle version
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sq5-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase (comptes, base) : jamais en cache
  if (url.hostname.endsWith('supabase.co')) return;
  // Polices Google : cache d'abord
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // Fichiers du site : réseau d'abord (toujours à jour), cache si hors ligne
  // cache: 'no-cache' = toujours revérifier auprès du serveur (pas de vieille version du navigateur)
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});

// Notifications push
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Sahib Qurani', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag: d.tag || 'sq',
    renotify: true,
    data: { url: d.url || '' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(self.registration.scope).href + (e.notification.data && e.notification.data.url || '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
