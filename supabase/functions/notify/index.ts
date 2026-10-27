// Edge Function « notify » : notifications push de Sahib Qurani.
// Secrets (Edge Functions → Secrets) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex. mailto:...)
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.
//
// Appels (toujours avec la session du membre connecté) :
//   { type: 'key' }                        → renvoie la clé publique VAPID
//   { type: 'request',  id: <request id> } → prévient le destinataire d'une nouvelle demande
//   { type: 'accepted', id: <request id> } → prévient l'expéditeur que sa demande est acceptée
//   { type: 'report',   id: <report id> }  → prévient les administrateurs
//   { type: 'test' }                       → notification de test à soi-même
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const single = Deno.env.get('SUPABASE_SECRET_KEY');
  if (single) return single;
  try {
    const all = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return all.default ?? Object.values(all)[0] ?? '';
  } catch { return ''; }
}
const SERVICE = serviceKey();
const PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@sahibqurani.com';
if (PUB && PRIV) webpush.setVapidDetails(SUBJECT, PUB, PRIV);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Lang = 'ar' | 'fr' | 'en' | 'es';
const TEXT: Record<string, Record<Lang, [string, string]>> = {
  request: {
    fr: ['Nouvelle demande', '{name} vous propose de réviser ensemble.'],
    en: ['New request', '{name} suggests revising together.'],
    es: ['Nueva solicitud', '{name} te propone repasar juntos.'],
    ar: ['طلب جديد', 'يقترح عليك {name} المراجعة معًا.']
  },
  accepted: {
    fr: ['Demande acceptée', '{name} a accepté votre demande. Contactez-le sur WhatsApp.'],
    en: ['Request accepted', '{name} accepted your request. Contact them on WhatsApp.'],
    es: ['Solicitud aceptada', '{name} aceptó tu solicitud. Contáctale por WhatsApp.'],
    ar: ['تم قبول الطلب', 'قبل {name} طلبك. تواصل معه عبر واتساب.']
  },
  report: {
    fr: ['Nouveau signalement', 'Motif : {reason}'],
    en: ['New report', 'Reason: {reason}'],
    es: ['Nueva denuncia', 'Motivo: {reason}'],
    ar: ['بلاغ جديد', 'السبب: {reason}']
  },
  urgent: {
    fr: ['⚠️ Signalement URGENT', 'Comportement inapproprié signalé.'],
    en: ['⚠️ URGENT report', 'Inappropriate behaviour reported.'],
    es: ['⚠️ Denuncia URGENTE', 'Comportamiento inapropiado denunciado.'],
    ar: ['⚠️ بلاغ عاجل', 'تم الإبلاغ عن سلوك غير لائق.']
  },
  test: {
    fr: ['Sahib Qurani', 'Les notifications fonctionnent ✅'],
    en: ['Sahib Qurani', 'Notifications are working ✅'],
    es: ['Sahib Qurani', 'Las notificaciones funcionan ✅'],
    ar: ['صاحب القرآن', 'الإشعارات تعمل ✅']
  }
};
const REASONS: Record<string, Record<Lang, string>> = {
  absences: { fr: 'absences répétées', en: 'repeated absences', es: 'ausencias repetidas', ar: 'غياب متكرر' },
  not_serious: { fr: 'manque de sérieux', en: 'lack of seriousness', es: 'falta de seriedad', ar: 'عدم الجدية' },
  inappropriate: { fr: 'comportement inapproprié', en: 'inappropriate behaviour', es: 'comportamiento inapropiado', ar: 'سلوك غير لائق' },
  false_info: { fr: 'informations fausses', en: 'false information', es: 'información falsa', ar: 'معلومات خاطئة' },
  sudden_stop: { fr: 'arrêt soudain', en: 'sudden stop', es: 'abandono repentino', ar: 'توقف مفاجئ' },
  other: { fr: 'autre', en: 'other', es: 'otro', ar: 'أخرى' }
};

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

async function langOf(uid: string): Promise<Lang> {
  const { data } = await db.from('profiles').select('ui_language').eq('id', uid).maybeSingle();
  const l = data?.ui_language;
  return (['ar', 'fr', 'en', 'es'].includes(l) ? l : 'fr') as Lang;
}

// Envoie à tous les appareils d'un membre ; supprime les abonnements expirés.
async function pushTo(uid: string, kind: string, vars: Record<string, string>, url: string) {
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', uid);
  if (!subs?.length) return 0;
  const lang = await langOf(uid);
  const [title, body] = TEXT[kind][lang];
  let text = body;
  for (const k in vars) text = text.replaceAll(`{${k}}`, vars[k]);
  if (vars.reasonCode) text = text.replace('{reason}', REASONS[vars.reasonCode]?.[lang] ?? vars.reasonCode);
  const payload = JSON.stringify({ title, body: text, url, tag: kind });
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.warn('push error', code, (e as Error).message);
    }
  }));
  return sent;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // Membre connecté uniquement
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await db.auth.getUser(token);
  const me = u?.user?.id;
  if (!me) return json({ error: 'auth' }, 401);

  let body: { type?: string; id?: string } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const { type, id } = body;

  if (type === 'key') return json({ key: PUB });
  if (!PUB || !PRIV) return json({ error: 'vapid_missing' }, 500);

  if (type === 'test') return json({ sent: await pushTo(me, 'test', {}, '#/profile') });

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'id' }, 400);

  if (type === 'request' || type === 'accepted') {
    const { data: r } = await db.from('requests').select('sender_id, receiver_id, status').eq('id', id).maybeSingle();
    if (!r) return json({ error: 'not_found' }, 404);
    if (type === 'request' && (r.sender_id !== me || r.status !== 'pending')) return json({ error: 'forbidden' }, 403);
    if (type === 'accepted' && (r.receiver_id !== me || r.status !== 'accepted')) return json({ error: 'forbidden' }, 403);
    const { data: p } = await db.from('profiles').select('first_name').eq('id', me).maybeSingle();
    const name = p?.first_name ?? '';
    const target = type === 'request' ? r.receiver_id : r.sender_id;
    const url = type === 'request' ? '#/requests' : `#/member?id=${me}`;
    return json({ sent: await pushTo(target, type, { name }, url) });
  }

  if (type === 'report') {
    const { data: rep } = await db.from('reports').select('reporter_id, reason, created_at').eq('id', id).maybeSingle();
    if (!rep || rep.reporter_id !== me) return json({ error: 'forbidden' }, 403);
    if (Date.now() - new Date(rep.created_at).getTime() > 10 * 60 * 1000) return json({ error: 'too_old' }, 403);
    const { data: admins } = await db.from('admins').select('user_id');
    const kind = rep.reason === 'inappropriate' ? 'urgent' : 'report';
    let sent = 0;
    for (const a of admins ?? []) sent += await pushTo(a.user_id, kind, { reasonCode: rep.reason }, '#/admin');
    return json({ sent });
  }

  return json({ error: 'type' }, 400);
});
