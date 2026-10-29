// Horloges « chez moi / chez le partenaire » : fuseau horaire du téléphone (jamais de GPS).
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { el } from './card.js';

const SVGNS = 'http://www.w3.org/2000/svg';
export const MY_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; }
})();

export function validTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; }
}

// Heure, minute et jour (date locale) dans un fuseau
function partsIn(tz, d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
// Décalage du fuseau par rapport à UTC, en minutes
function offsetMin(tz, d) {
  const p = partsIn(tz, d);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - d.getTime()) / 60000);
}
const isDay = h => h >= 6 && h < 18;

/* ---------- Enregistrer mon fuseau (une fois par chargement, seulement s'il a changé) ---------- */
let synced = null;
export async function syncTz(session) {
  if (!session || !validTz(MY_TZ) || synced === session.user.id) return;
  synced = session.user.id;
  const { data } = await sb.from('profiles').select('timezone').eq('id', session.user.id).maybeSingle();
  if (data && data.timezone !== MY_TZ) await sb.from('profiles').update({ timezone: MY_TZ }).eq('id', session.user.id);
  if (!data) synced = null; // profil pas encore créé : réessayer plus tard
}
export function resetTz() { synced = null; }

/* ---------- Une horloge ---------- */
function face(size) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('clk-face');
  const add = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
  add('circle', { cx: 50, cy: 50, r: 46, class: 'clk-dial' });
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6, r1 = i % 3 ? 38 : 34, r2 = 42;
    add('line', { x1: 50 + r1 * Math.sin(a), y1: 50 - r1 * Math.cos(a), x2: 50 + r2 * Math.sin(a), y2: 50 - r2 * Math.cos(a), class: i % 3 ? 'clk-tick' : 'clk-tick big' });
  }
  const hh = add('line', { x1: 50, y1: 50, x2: 50, y2: 26, class: 'clk-h' });
  const mm = add('line', { x1: 50, y1: 50, x2: 50, y2: 15, class: 'clk-m' });
  add('circle', { cx: 50, cy: 50, r: 3.5, class: 'clk-pin' });
  return { svg, hh, mm };
}

function oneClock(label, tz, size) {
  const box = el('div', 'clk');
  const f = face(size);
  const icon = el('span', 'clk-ico');
  const time = el('strong', 'clk-time');
  const sub = el('small', 'clk-sub');
  const lab = el('span', 'clk-label', label);
  const foot = el('span', 'clk-foot');
  foot.append(icon, sub);
  box.append(lab, f.svg, time, foot);
  const update = (now, refDay) => {
    const p = partsIn(tz, now);
    const day = isDay(p.h);
    box.classList.toggle('night', !day);
    icon.textContent = day ? '☀️' : '🌙';
    icon.title = t(day ? 'clock.day' : 'clock.night');
    time.textContent = new Intl.DateTimeFormat(lang(), { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const ha = ((p.h % 12) + p.mi / 60) * 30, ma = p.mi * 6;
    f.hh.setAttribute('transform', `rotate(${ha} 50 50)`);
    f.mm.setAttribute('transform', `rotate(${ma} 50 50)`);
    const dayKey = p.y * 10000 + p.mo * 100 + p.d;
    sub.textContent = refDay === undefined || dayKey === refDay ? new Intl.DateTimeFormat(lang(), { timeZone: tz, weekday: 'long' }).format(now)
      : t(dayKey > refDay ? 'clock.tomorrow' : 'clock.yesterday');
    return dayKey;
  };
  return { box, update };
}

function diffText(mins) {
  if (mins === 0) return t('clock.same');
  const sign = mins > 0 ? '+' : '−';
  const a = Math.abs(mins), h = Math.floor(a / 60), m = a % 60;
  return sign + (m ? t('clock.hm', { h, m }) : t('clock.h', { h }));
}

/* ---------- Deux horloges : chez moi / chez l'autre ---------- */
export function clockPair(otherTz, otherName, opts = {}) {
  const wrap = el('div', 'clk-pair' + (opts.compact ? ' compact' : ''));
  const size = opts.compact ? 54 : 74;
  const mine = validTz(MY_TZ) ? MY_TZ : 'UTC';
  const a = oneClock(t('clock.me'), mine, size);
  const mid = el('div', 'clk-mid');
  if (opts.solo) {
    wrap.classList.add('solo');
    wrap.append(a.box);
    const tick = () => { if (!wrap.isConnected && wrap.dataset.started) return clearInterval(timer); wrap.dataset.started = '1'; a.update(new Date()); };
    const timer = setInterval(tick, 20000); tick();
    return wrap;
  }
  if (!validTz(otherTz)) {
    const unk = el('div', 'clk clk-unknown');
    unk.append(el('span', 'clk-label', t('clock.other', { name: otherName })), el('span', 'clk-q', '?'), el('small', 'clk-sub', t('clock.unknown', { name: otherName })));
    wrap.append(a.box, mid, unk);
    const tick = () => { if (!wrap.isConnected && wrap.dataset.started) return clearInterval(timer); wrap.dataset.started = '1'; a.update(new Date()); };
    const timer = setInterval(tick, 20000); tick();
    return wrap;
  }
  const b = oneClock(t('clock.other', { name: otherName }), otherTz, size);
  wrap.append(a.box, mid, b.box);
  const tick = () => {
    if (!wrap.isConnected && wrap.dataset.started) { clearInterval(timer); return; }
    wrap.dataset.started = '1';
    const now = new Date();
    const ref = a.update(now);
    b.update(now, ref);
    mid.textContent = diffText(offsetMin(otherTz, now) - offsetMin(mine, now));
  };
  const timer = setInterval(tick, 20000);
  tick();
  return wrap;
}

/* ---------- Petite pastille (liste des demandes) ---------- */
export function clockChip(tz) {
  const s = el('span', 'clk-chip');
  if (!validTz(tz)) return s;
  const now = new Date();
  const p = partsIn(tz, now);
  s.textContent = (isDay(p.h) ? '☀️ ' : '🌙 ') + new Intl.DateTimeFormat(lang(), { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  s.title = t('clock.local_time');
  return s;
}
