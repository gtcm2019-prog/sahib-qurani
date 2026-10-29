import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Session expirée (« JWT expired ») : on renouvelle la session une fois et on refait la requête.
// Si le renouvellement échoue, déconnexion locale (l'écran de connexion s'affiche).
let refreshing = null;
async function fetchWithRefresh(input, init = {}) {
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
