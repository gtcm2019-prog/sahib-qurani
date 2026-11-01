import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Session expirée (« JWT expired ») : on renouvelle la session une fois et on refait la requête.
// Si le renouvellement échoue, déconnexion locale (l'écran de connexion s'affiche).
let refreshing = null;

/* ---------- Profil actif (V6 : profils de la famille) ----------
   Un compte = un adulte (profil principal, même id que le compte).
   Le profil actif est envoyé à la base dans l'en-tête « x-sq-profile » (vérifié côté base). */
let account = null;   // id du compte connecté
let active = null;    // id du profil de la famille actif (null = profil principal)
const PKEY = () => 'sq_profile_' + account;
export function setAccount(uid) {
  if (uid === account) return;
  account = uid || null; active = null;
  if (!account) return;
  try { const v = localStorage.getItem(PKEY()); if (v && v !== account) active = v; } catch (e) { /* ignore */ }
}
export function setActiveProfile(pid) {
  active = pid && pid !== account ? pid : null;
  try { if (active) localStorage.setItem(PKEY(), active); else localStorage.removeItem(PKEY()); } catch (e) { /* ignore */ }
}
export const accountId = () => account;
export const meId = session => active || session?.user?.id || account;
export const isMainProfile = () => !active;

function withProfile(input, init) {
  if (!active || !String(input).includes('/rest/v1/')) return init;
  const headers = new Headers(init.headers || {});
  headers.set('x-sq-profile', active);
  return { ...init, headers };
}

async function fetchWithRefresh(input, init = {}) {
  init = withProfile(input, init);
  const res = await fetch(input, init);
  if (res.status !== 401 || String(input).includes('/auth/v1/')) return res;
  let body = '';
  try { body = await res.clone().text(); } catch (e) { return res; }
  if (!/JWT expired|PGRST303|PGRST301/i.test(body)) return res;
  refreshing = refreshing || sb.auth.refreshSession().finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  const { data, error } = await refreshing;
  if (error || !data?.session) { await sb.auth.signOut({ scope: 'local' }).catch(() => {}); return res; }
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', 'Bearer ' + data.session.access_token);
  return fetch(input, { ...init, headers });
}

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  global: { fetch: fetchWithRefresh }
});

// Retour dans l'appli après une pause : vérifier la session (renouvelée si elle a expiré)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sb.auth.getSession().catch(() => {});
});
