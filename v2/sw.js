// Ancienne version de test retirée : ce service worker se désinstalle et renvoie vers le site principal.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(self.registration.unregister()
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then(cs => cs.forEach(c => c.navigate('/'))));
});
