// V6 – Profils de la famille : un compte adulte, jusqu'à 20 profils (enfants, conjoint…).
// Chaque profil a son propre suivi, ses demandes et ses statistiques. Le parent agit pour l'enfant.
import { sb, meId, setActiveProfile, isMainProfile, accountId } from './sb.js';
import { t } from './i18n.js';
import { $ } from './ui.js';
import { el } from './card.js';
import { avatarEl } from './avatar.js';
import * as D from './data.js';

export const MAX_PROFILES = 20;
let list = null;          // [{ id, first_name, gender, age_range, avatar, is_main, pending }]
let loadedAt = 0;
let goTo = () => {};

export function resetFamily() { list = null; loadedAt = 0; }

export async function loadFamily(force = false) {
  if (!force && list && Date.now() - loadedAt < 30000) return list;
  const { data, error } = await sb.rpc('my_profiles');
  if (error) { console.warn(error); return list || []; }
  list = data || []; loadedAt = Date.now();
  return list;
}

// Changer de profil : on recharge l'appli (tous les écrans repartent du bon profil)
export function switchTo(pid, view = '') {
  setActiveProfile(pid);
  location.hash = '#/' + view;
  location.reload();
}

export function addFamilyMember() {
  if (list && list.length >= MAX_PROFILES) { alert(t('fam.max')); return; }
  closeSheet();
  goTo('start?s=name&f=1');
}

/* ---------- En-tête : profil actif + bandeau ---------- */
export async function renderFamilyBar(session) {
  const chip = $('#pf-chip'), banner = $('#fam-banner');
  if (!session) { chip.hidden = true; banner.hidden = true; return; }
  const all = await loadFamily();
  const me = all.find(p => p.id === meId(session)) || all.find(p => p.is_main);
  if (!me) { chip.hidden = true; banner.hidden = true; return; }
  chip.replaceChildren(avatarEl(me.avatar, me.gender, me.first_name, 26), el('span', 'pf-name', me.first_name), el('span', 'pf-caret', '▾'));
  const others = all.filter(p => p.id !== me.id).reduce((n, p) => n + Number(p.pending || 0), 0);
  if (others) chip.append(el('span', 'pf-dot', String(others)));
  chip.title = t('fam.switch_title');
  chip.hidden = false;
  if (!me.is_main) {
    banner.replaceChildren(el('span', null, '👪 ' + t('fam.acting', { name: me.first_name })));
    const b = el('button', 'link', t('fam.change'));
    b.type = 'button';
    b.addEventListener('click', openSheet);
    banner.append(b);
    banner.hidden = false;
  } else banner.hidden = true;
}

/* ---------- Sélecteur ---------- */
function closeSheet() { const d = $('#fam-sheet'); if (d.open) d.close(); }

export async function openSheet() {
  const dlg = $('#fam-sheet'), body = $('#fam-list');
  body.replaceChildren(el('p', 'muted center', t('common.loading')));
  if (!dlg.open) dlg.showModal();
  const all = await loadFamily(true);
  const cur = meId();
  body.replaceChildren();
  for (const p of all) {
    const row = el('button', 'fam-row' + (p.id === cur ? ' on' : ''));
    row.type = 'button';
    row.dataset.gender = p.gender;
    const txt = el('span', 'fam-txt');
    txt.append(el('b', null, p.first_name),
      el('small', 'muted', (p.is_main ? t('fam.main') + ' · ' : '') + t('age.' + p.age_range)));
    row.append(avatarEl(p.avatar, p.gender, p.first_name, 40), txt);
    if (Number(p.pending)) row.append(el('span', 'count', String(p.pending)));
    if (p.id === cur) row.append(el('span', 'fam-tick', '✓'));
    if (D.MINOR_AGES.includes(p.age_range)) row.classList.add('minor');
    row.addEventListener('click', () => { if (p.id === cur) closeSheet(); else switchTo(p.is_main ? null : p.id); });
    body.append(row);
  }
  $('#fam-count').textContent = t('fam.count', { n: all.length, max: MAX_PROFILES });
  $('#fam-add').hidden = all.length >= MAX_PROFILES;
}

/* ---------- Page profil : supprimer un profil de la famille ---------- */
export async function deleteFamilyProfile(p) {
  if (isMainProfile()) return;
  if (!confirm(t('fam.delete_confirm', { name: p.first_name }))) return;
  const { data, error } = await sb.rpc('delete_family_profile', { p_profile: p.id });
  if (error || !data) { console.warn(error); alert(t('err.generic')); return; }
  alert(t('fam.deleted'));
  switchTo(null);
}

// Lien de notification « …?p=<profil> » : ouvrir directement le bon profil
export function applyProfileFromHash(session) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const p = q.get('p');
  if (!p || !session) return false;
  q.delete('p');
  const view = location.hash.replace(/^#\/?/, '').split('?')[0];
  const rest = q.toString();
  history.replaceState(null, '', location.pathname + location.search + '#/' + view + (rest ? '?' + rest : ''));
  const target = p === session.user.id ? null : p;
  if ((target || null) === (isMainProfile() ? null : meId(session))) return false;
  setActiveProfile(target);
  return true;
}

export function bindFamily(go) {
  goTo = go;
  $('#pf-chip').addEventListener('click', openSheet);
  $('#fam-add').addEventListener('click', addFamilyMember);
  $('#fam-close').addEventListener('click', closeSheet);
  $('#fam-sheet').addEventListener('click', e => { if (e.target.id === 'fam-sheet') closeSheet(); });
}

export { accountId };
