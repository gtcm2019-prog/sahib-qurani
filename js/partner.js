// Carte « Mon partenaire » sur l'accueil : un seul partenaire actif, deux horloges, WhatsApp.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $ } from './ui.js';
import * as D from './data.js';
import { el, countryName } from './card.js';
import { avatarEl } from './avatar.js';
import { clockPair } from './clock.js';

const COLS = 'id, first_name, gender, country, city, age_range, avatar, timezone';
let seq = 0;

const waLink = (number, text) => 'https://wa.me/' + String(number).replace(/\D/g, '') + '?text=' + encodeURIComponent(text);

// Partenariat actif le plus récent (accepté et non terminé)
export async function activePartnership(uid) {
  const { data, error } = await sb.from('requests').select('id, sender_id, receiver_id, status, created_at, responded_at')
    .eq('status', 'accepted').or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
    .order('responded_at', { ascending: false, nullsFirst: false }).limit(1);
  if (error) throw error;
  return data[0] || null;
}

export function endPartnership(id) {
  return sb.rpc('end_partnership', { p_request: id });
}

export async function showPartnerCard(session) {
  const box = $('#partner-home');
  const my = ++seq;
  if (!session) { box.hidden = true; box.replaceChildren(); return; }
  const uid = session.user.id;
  let r, other = null, me = null, priv = null;
  try {
    r = await activePartnership(uid);
    const ids = r ? [uid, r.sender_id === uid ? r.receiver_id : r.sender_id] : [uid];
    const { data } = await sb.from('profiles').select(COLS).in('id', ids);
    me = (data || []).find(p => p.id === uid) || null;
    if (r) other = (data || []).find(p => p.id !== uid) || null;
    if (other) ({ data: priv } = await sb.from('profiles_private').select('whatsapp, guardian_name, guardian_whatsapp').eq('id', other.id).maybeSingle());
  } catch (e) { console.warn(e); if (my === seq) box.hidden = true; return; }
  if (my !== seq) return;
  if (!me) { box.hidden = true; return; } // pas encore de profil
  box.replaceChildren();
  box.hidden = false;

  const head = el('div', 'ph-head');
  head.append(el('h2', null, t('partner.title')));
  box.append(head);

  if (!r || !other) {
    box.classList.add('empty');
    box.append(el('p', 'muted', t('partner.none')));
    box.append(clockPair(null, '', { compact: true, solo: true }));
    const a = el('a', 'btn btn-gold', t('partner.find'));
    a.href = '#/search';
    box.append(a);
    return;
  }
  box.classList.remove('empty');
  const who = el('a', 'ph-who');
  who.href = '#/member?id=' + other.id;
  const txt = el('div');
  txt.append(el('b', null, other.first_name));
  const pl = [other.city, other.country ? countryName(other.country) : ''].filter(Boolean).join(lang() === 'ar' ? '، ' : ', ');
  if (pl) txt.append(el('small', 'muted', pl));
  if (r.responded_at) txt.append(el('small', 'muted', t('partner.since', { date: new Intl.DateTimeFormat(lang(), { dateStyle: 'medium' }).format(new Date(r.responded_at)) })));
  who.append(avatarEl(other.avatar, other.gender, other.first_name, 52), txt);
  box.append(who, clockPair(other.timezone, other.first_name));

  const actions = el('div', 'p-actions');
  const theyMinor = D.MINOR_AGES.includes(other.age_range);
  const number = theyMinor ? priv?.guardian_whatsapp : priv?.whatsapp;
  if (number) {
    const text = t(theyMinor ? 'wa.minor' : 'wa.adult', { name: other.first_name, me: me.first_name });
    const a = el('a', 'btn btn-wa', t('req.wa'));
    a.href = waLink(number, text); a.target = '_blank'; a.rel = 'noopener';
    actions.append(a);
  }
  const f = el('a', 'btn btn-line', t('partner.profile'));
  f.href = '#/member?id=' + other.id;
  actions.append(f);
  box.append(actions);
}
