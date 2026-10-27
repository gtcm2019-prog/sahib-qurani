import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $, $$, showMsg, busy } from './ui.js';
import * as D from './data.js';
import { AVATARS, avatarEl } from './avatar.js';
import { countryName, languageName, surahName, profileCard } from './card.js';
import { renderMyReviews, renderMyBlocks, deleteAccount } from './trust.js';

let cache = null;      // { uid, pub, priv }
let goTo = () => {};

export function resetProfileCache() { cache = null; }

const collator = () => new Intl.Collator(lang());

/* ---------- Données ---------- */
export async function loadMine(session) {
  const uid = session.user.id;
  if (cache && cache.uid === uid) return cache;
  const [pub, priv] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    sb.from('profiles_private').select('whatsapp, guardian_name, guardian_whatsapp').eq('id', uid).maybeSingle()
  ]);
  if (pub.error) throw pub.error;
  cache = { uid, pub: pub.data, priv: priv.data };
  return cache;
}

/* ---------- Affichage du profil ---------- */
export async function showProfile(session) {
  const card = $('#profile-card'), loading = $('#profile-loading');
  card.hidden = true; loading.hidden = false; $('#account-card').hidden = true;
  let me;
  try { me = await loadMine(session); }
  catch (e) { loading.textContent = t('err.generic'); return; }
  if (!me.pub) { goTo('edit'); return; }
  const p = me.pub;
  loading.hidden = true;

  $('#p-public').replaceChildren(profileCard(p));
  card.dataset.gender = p.gender;

  // WhatsApp (visible par soi seul ici)
  const priv = me.priv || {};
  const isMinor = D.MINOR_AGES.includes(p.age_range);
  $('#p-wa').textContent = isMinor
    ? t('profile.guardian_line', { name: priv.guardian_name || '—', wa: priv.guardian_whatsapp || '—' })
    : (priv.whatsapp || '—');

  // Statut et pause
  $$('#seg-status button').forEach(btn => btn.classList.toggle('on', btn.dataset.status === p.status));
  $('#chk-pause').checked = !!p.is_paused;

  card.hidden = false;
  $('#account-card').hidden = false;
  renderMyReviews(p);
  renderMyBlocks(p);
}

async function updateField(fields) {
  const card = $('#profile-card');
  const { error } = await sb.from('profiles').update(fields).eq('id', cache.uid);
  if (error) { showMsg(card, 'err.generic'); return false; }
  Object.assign(cache.pub, fields);
  return true;
}

/* ---------- Formulaire ---------- */
function opt(value, label) {
  const o = document.createElement('option');
  o.value = value; o.textContent = label;
  return o;
}
function fillSelect(sel, items, placeholder) {
  sel.replaceChildren();
  if (placeholder) sel.append(opt('', placeholder));
  for (const [v, l] of items) sel.append(opt(v, l));
}
function chipGroup(box, name, items, type) {
  box.replaceChildren();
  for (const [v, l] of items) {
    const lab = document.createElement('label');
    lab.className = 'chip';
    const inp = document.createElement('input');
    inp.type = type; inp.name = name; inp.value = v;
    const span = document.createElement('span'); span.textContent = l;
    lab.append(inp, span);
    box.append(lab);
  }
}

function buildForm(f) {
  const choose = t('edit.choose');
  chipGroup($('#f-gender'), 'gender', D.GENDERS.map(g => [g, t('gender.' + g)]), 'radio');
  fillSelect(f.age_range, D.AGE_RANGES.map(a => [a, t('age.' + a)]), choose);
  const countries = D.COUNTRIES.map(c => [c, countryName(c)]).sort((a, b) => collator().compare(a[1], b[1]));
  fillSelect(f.country, countries, choose);
  const langs = D.LANGUAGES.filter(l => l !== 'other').map(l => [l, languageName(l)])
    .sort((a, b) => collator().compare(a[1], b[1]));
  langs.push(['other', languageName('other')]);
  chipGroup($('#f-languages'), 'languages', langs, 'checkbox');
  fillSelect(f.level, D.LEVELS.map(l => [l, t('level.' + l)]), choose);
  chipGroup($('#f-riwaya'), 'riwaya', D.RIWAYAT.map(r => [r, t('riwaya.' + r)]), 'radio');
  const surahs = Array.from({ length: 114 }, (_, i) => [String(i + 1), surahName(i + 1)]);
  fillSelect(f.surah_from, surahs, '—');
  fillSelect(f.surah_to, surahs, '—');
  chipGroup($('#f-availability'), 'availability', D.AVAILABILITY.map(a => [a, t('avail.' + a)]), 'checkbox');
  fillSelect(f.contact_mode, D.CONTACT_MODES.map(c => [c, t('contact.' + c)]), choose);
}

function buildAvatars(f, selected) {
  const box = $('#f-avatar');
  const gender = checkedValues(f, 'gender')[0];
  const cur = selected !== undefined ? selected : (checkedValues(f, 'avatar')[0] ?? '');
  box.replaceChildren();
  for (const code of ['', ...AVATARS]) {
    const lab = document.createElement('label');
    lab.className = 'av-opt';
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = 'avatar'; inp.value = code; inp.checked = code === (cur || '');
    lab.setAttribute('aria-label', code ? code : t('edit.avatar_initial'));
    lab.append(inp, avatarEl(code || null, gender, f.first_name.value, 44));
    box.append(lab);
  }
}

function setChecked(f, name, values) {
  const vals = Array.isArray(values) ? values : [values];
  $$(`input[name="${name}"]`, f).forEach(i => { i.checked = vals.includes(i.value); });
}
function checkedValues(f, name) {
  return $$(`input[name="${name}"]:checked`, f).map(i => i.value);
}

function toggleGuardian(f) {
  const minor = D.MINOR_AGES.includes(f.age_range.value);
  $('#guardian').hidden = !minor;
  $('#wa-own').hidden = minor;
}

export async function showEdit(session) {
  const f = $('#form-profile');
  let me;
  try { me = await loadMine(session); }
  catch (e) { showMsg(f, 'err.generic'); return; }
  buildForm(f);
  const box = $('.msg', f); box.hidden = true; box.textContent = '';
  const p = me.pub, priv = me.priv || {};
  $('#edit-title').textContent = t(p ? 'edit.title_edit' : 'edit.title_new');
  $('#edit-cancel').hidden = !p;
  f.first_name.value = p?.first_name || '';
  setChecked(f, 'gender', p?.gender || '');
  buildAvatars(f, p?.avatar || '');
  f.age_range.value = p?.age_range || '';
  f.country.value = p?.country || '';
  f.city.value = p?.city || '';
  setChecked(f, 'languages', p?.languages || [lang()]);
  f.level.value = p?.level || '';
  setChecked(f, 'riwaya', p?.riwaya || '');
  f.hizb_memorized.value = p?.hizb_memorized ?? 0;
  $('#hizb-out').textContent = f.hizb_memorized.value;
  f.surah_from.value = p?.surah_from ? String(p.surah_from) : '';
  f.surah_to.value = p?.surah_to ? String(p.surah_to) : '';
  setChecked(f, 'availability', p?.availability || []);
  f.contact_mode.value = p?.contact_mode || '';
  f.whatsapp.value = priv.whatsapp || '';
  f.guardian_name.value = priv.guardian_name || '';
  f.guardian_whatsapp.value = priv.guardian_whatsapp || '';
  toggleGuardian(f);
}

// "+212 6-12 34" ou "00212…" → "+212612…" ; null si vide ; false si invalide
function normPhone(v) {
  let s = String(v || '').replace(/[\s().-]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  return /^\+[0-9]{8,15}$/.test(s) ? s : false;
}

async function saveProfile(e) {
  e.preventDefault();
  const f = e.target;
  const minor = D.MINOR_AGES.includes(f.age_range.value);
  const first = f.first_name.value.trim();
  const gender = checkedValues(f, 'gender')[0];
  const languages = checkedValues(f, 'languages');
  const riwaya = checkedValues(f, 'riwaya')[0];
  const availability = checkedValues(f, 'availability');
  const sFrom = f.surah_from.value ? Number(f.surah_from.value) : null;
  const sTo = f.surah_to.value ? Number(f.surah_to.value) : null;

  if (!first || !gender || !f.age_range.value || !f.country.value || !languages.length ||
      !f.level.value || !riwaya || !availability.length || !f.contact_mode.value) {
    return showMsg(f, 'err.required');
  }
  if (sFrom && sTo && sFrom > sTo) return showMsg(f, 'err.surah_order');

  let wa = null, gName = null, gWa = null;
  if (minor) {
    gName = f.guardian_name.value.trim();
    gWa = normPhone(f.guardian_whatsapp.value);
    if (!gName || !gWa) return showMsg(f, gWa === false ? 'err.phone' : 'err.guardian');
  } else {
    wa = normPhone(f.whatsapp.value);
    if (!wa) return showMsg(f, wa === false ? 'err.phone' : 'err.whatsapp');
  }

  const pub = {
    first_name: first, gender, age_range: f.age_range.value, country: f.country.value,
    city: f.city.value.trim() || null, languages, level: f.level.value, riwaya,
    hizb_memorized: Number(f.hizb_memorized.value), surah_from: sFrom, surah_to: sTo,
    availability, contact_mode: f.contact_mode.value, ui_language: lang(),
    avatar: checkedValues(f, 'avatar')[0] || null
  };
  const priv = { whatsapp: wa, guardian_name: gName, guardian_whatsapp: gWa };

  busy(f, true);
  const uid = cache.uid;
  let r = cache.pub
    ? await sb.from('profiles').update(pub).eq('id', uid)
    : await sb.from('profiles').insert({ id: uid, ...pub });
  if (!r.error) {
    r = cache.priv
      ? await sb.from('profiles_private').update(priv).eq('id', uid)
      : await sb.from('profiles_private').insert({ id: uid, ...priv });
  }
  busy(f, false);
  if (r.error) { console.warn(r.error); return showMsg(f, 'err.generic'); }
  cache = null;
  goTo('profile');
}

/* ---------- Liaisons ---------- */
export function bindProfile(go) {
  goTo = go;
  $('#btn-delete').addEventListener('click', () => deleteAccount(() => { cache = null; goTo('home'); }));
  const f = $('#form-profile');
  f.addEventListener('submit', saveProfile);
  f.age_range.addEventListener('change', () => toggleGuardian(f));
  $('#f-gender').addEventListener('change', () => buildAvatars(f));
  f.first_name.addEventListener('input', () => buildAvatars(f));
  f.hizb_memorized.addEventListener('input', () => { $('#hizb-out').textContent = f.hizb_memorized.value; });

  $$('#seg-status button').forEach(btn => btn.addEventListener('click', async () => {
    if (btn.classList.contains('on')) return;
    if (await updateField({ status: btn.dataset.status })) {
      $$('#seg-status button').forEach(x => x.classList.toggle('on', x === btn));
      $('#p-public').replaceChildren(profileCard(cache.pub));
    }
  }));

  $('#chk-pause').addEventListener('change', async e => {
    const on = e.target.checked;
    if (await updateField({ is_paused: on })) $('#p-public').replaceChildren(profileCard(cache.pub));
    else e.target.checked = !on;
  });
}
