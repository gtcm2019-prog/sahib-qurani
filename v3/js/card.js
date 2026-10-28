// Affichage d'un profil public (le sien ou celui d'un autre membre). Tout en textContent.
import { t, lang } from './i18n.js';
import * as D from './data.js';
import { avatarEl } from './avatar.js';

const override = key => { const s = t(key); return s === key ? null : s; };
export const sep = () => (lang() === 'ar' ? '، ' : ', ');

export function countryName(code) {
  if (!code) return '';
  try { return override('names.country_' + code) || new Intl.DisplayNames([lang()], { type: 'region' }).of(code); }
  catch (e) { return code; }
}
export function languageName(code) {
  try { return override('names.lang_' + code) || new Intl.DisplayNames([lang()], { type: 'language' }).of(code); }
  catch (e) { return code; }
}
export function surahName(n) {
  if (!n) return '';
  return lang() === 'ar' ? `${n}. ${D.SURAHS_AR[n - 1]}` : `${n}. ${D.SURAHS_LATIN[n - 1]}`;
}
export const place = p => [p.city, countryName(p.country)].filter(Boolean).join(sep());
export const pctOf = p => Math.round((p.hizb_memorized / D.HIZB_TOTAL) * 100);
export const fmtPct = n => new Intl.NumberFormat(lang(), { style: 'percent' }).format(n / 100);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

const SVGNS = 'http://www.w3.org/2000/svg';
let ringId = 0;
export function ring(p, size = 132) {
  const pct = pctOf(p);
  const wrap = el('div', 'ring');
  wrap.style.width = wrap.style.height = size + 'px';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', t('profile.progress_aria', { p: pct }));
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  const gid = 'rg' + (++ringId);
  svg.innerHTML = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E3C774"/><stop offset="1" stop-color="#C49A28"/></linearGradient></defs>`;
  const track = document.createElementNS(SVGNS, 'circle');
  const bar = document.createElementNS(SVGNS, 'circle');
  for (const c of [track, bar]) { c.setAttribute('cx', 60); c.setAttribute('cy', 60); c.setAttribute('r', 50); }
  track.setAttribute('class', 'ring-track');
  bar.setAttribute('class', 'ring-bar');
  bar.setAttribute('stroke', `url(#${gid})`);
  const circ = 2 * Math.PI * 50;
  bar.style.strokeDasharray = circ;
  bar.style.strokeDashoffset = circ;
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = circ * (1 - pct / 100); }));
  svg.append(track, bar);
  const txt = el('div', 'ring-text');
  txt.append(el('strong', null, fmtPct(pct)), el('small', null, t('profile.hizb_of', { n: p.hizb_memorized, total: D.HIZB_TOTAL })));
  if (size < 110) wrap.classList.add('ring-sm');
  wrap.append(svg, txt);
  return wrap;
}

export function tags(p) {
  const box = el('p', 'p-tags');
  box.append(el('span', 'tag tag-' + p.gender, t('gender.' + p.gender)));
  box.append(el('span', 'tag tag-status-' + p.status, t('status.' + p.status)));
  if (p.badge) box.append(el('span', 'tag badge-' + p.badge, t('badge.' + p.badge)));
  if (p.is_paused) box.append(el('span', 'tag tag-pause', t('profile.paused_tag')));
  return box;
}

// Bloc complet : cercle + identité + informations
export function profileCard(p) {
  const root = el('div', 'p-public');
  root.dataset.gender = p.gender;
  const head = el('div', 'p-head');
  const id = el('div', 'p-id');
  const title = el('div', 'p-title');
  title.append(avatarEl(p.avatar, p.gender, p.first_name, 52), el('h2', null, p.first_name));
  id.append(title, el('p', 'muted', place(p)), tags(p));
  head.append(ring(p), id);

  const facts = [
    ['edit.level', t('level.' + p.level)],
    ['edit.riwaya', t('riwaya.' + p.riwaya)],
    ['edit.age_range', t('age.' + p.age_range)],
    ['edit.languages', (p.languages || []).map(languageName).join(sep())],
    ['profile.surahs', p.surah_from && p.surah_to ? `${surahName(p.surah_from)} ${lang() === 'ar' ? '←' : '→'} ${surahName(p.surah_to)}` : '—'],
    ['edit.availability', (p.availability || []).map(a => t('avail.' + a)).join(sep()) || '—'],
    ['edit.contact_mode', t('contact.' + p.contact_mode)]
  ];
  const dl = el('dl', 'p-facts');
  for (const [k, v] of facts) {
    const w = el('div');
    w.append(el('dt', null, t(k)), el('dd', null, v));
    dl.append(w);
  }
  root.append(head, dl);
  return root;
}

// Carte compacte pour la liste de résultats
export function memberRow(p, href) {
  const a = el('a', 'm-row');
  a.href = href;
  a.dataset.gender = p.gender;
  a.dataset.id = p.id;
  const info = el('div', 'm-info');
  const top = el('div', 'm-top');
  top.append(el('b', null, p.first_name));
  if (p.badge === 'reliable') top.append(el('span', 'tag badge-reliable', t('badge.reliable')));
  info.append(top, el('small', 'muted', place(p)),
    el('small', 'm-meta', [t('level.' + p.level), t('riwaya.' + p.riwaya), t('contact.' + p.contact_mode)].join(' · ')));
  const side = el('div', 'm-side');
  side.append(el('strong', 'm-pct', fmtPct(pctOf(p))), el('small', 'tag tag-status-' + p.status, t('status.' + p.status)));
  a.append(avatarEl(p.avatar, p.gender, p.first_name, 48), info, side);
  return a;
}
