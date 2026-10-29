// Programme de révision quotidien (V4) : un programme par jour, « Accompli », demain, partenaire.
// Unités en base : surah, hizb, nisf, rub, thumn, page (numéro global). Affichage « … du hizb … ».
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $ } from './ui.js';
import { el, surahName, fmtPct, assidTag } from './card.js';

export const UNITS = ['hizb', 'nisf', 'rub', 'thumn', 'surah', 'page'];
const PER_HIZB = { nisf: 2, rub: 4, thumn: 8 };
const MAX = { surah: 114, hizb: 60, nisf: 120, rub: 240, thumn: 480, page: 604 };
const fmtNum = n => Number(n || 0).toLocaleString(lang());
const arrow = () => (lang() === 'ar' ? ' ← ' : ' → ');

/* ---------- Dates (AAAA-MM-JJ, jour local du membre donné par la base) ---------- */
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayNum = d => new Intl.DateTimeFormat(lang(), { day: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
const dayName = d => new Intl.DateTimeFormat(lang(), { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));

/* ---------- Libellés ---------- */
export function partLabel(unit, n) {
  if (unit === 'surah') return t('plan.u_surah') + ' ' + surahName(n);
  const k = PER_HIZB[unit];
  if (k) return t('plan.one_' + unit, { f: (n - 1) % k + 1, h: Math.floor((n - 1) / k) + 1 });
  return t('plan.one_' + unit, { n });
}
export const planLabel = p => p.start_no === p.end_no ? partLabel(p.unit, p.start_no)
  : partLabel(p.unit, p.start_no) + arrow() + partLabel(p.unit, p.end_no);

function statusTag(status) {
  const s = status || 'planned';
  return el('span', 'tag plan-st plan-st-' + s, s === 'done' ? '✔ ' + t('plan.done') : s === 'missed' ? '✖ ' + t('plan.missed') : t('plan.pending'));
}

function errText(error) {
  const m = String(error?.message || '');
  if (m.includes('already_done')) return t('plan.err_done');
  if (m.includes('check constraint') || m.includes('bad_range')) return t('plan.err_range');
  if (m.toLowerCase().includes('fetch') || m.toLowerCase().includes('network')) return t('err.network');
  return t('err.generic');
}

/* ---------- Formulaire : unité + de… à… ---------- */
function opt(value, text, sel) { const o = el('option', null, text); o.value = value; if (sel) o.selected = true; return o; }
function numSelect(max, value, labelOf = n => String(n)) {
  const s = el('select');
  for (let i = 1; i <= max; i++) s.append(opt(i, labelOf(i), i === value));
  return s;
}

// Un point de la plage (« thumn 3 du hizb 12 », « sourate 18 », « page 300 »…). get() → numéro global.
function pointField(unit, value) {
  const box = el('div', 'plan-point');
  const k = PER_HIZB[unit];
  if (k) {
    const f = numSelect(k, (value - 1) % k + 1);
    const h = numSelect(60, Math.floor((value - 1) / k) + 1);
    box.append(el('span', null, t('plan.u_' + unit)), f, el('span', null, t('plan.of_hizb')), h);
    return { box, get: () => (Number(h.value) - 1) * k + Number(f.value) };
  }
  if (unit === 'page') {
    const i = el('input'); i.type = 'number'; i.inputMode = 'numeric'; i.min = 1; i.max = 604; i.value = value;
    box.append(el('span', null, t('plan.u_page')), i);
    return { box, get: () => Math.round(Number(i.value)) };
  }
  const s = numSelect(MAX[unit], value, unit === 'surah' ? surahName : String);
  box.append(el('span', null, t('plan.u_' + unit)), s);
  return { box, get: () => Number(s.value) };
}

function planForm(dateStr, initial, onSaved, onCancel) {
  const form = el('form', 'plan-form');
  let unit = initial?.unit || 'hizb';
  let start = initial?.start_no || 1, end = initial?.end_no || start;
  const unitRow = el('div', 'plan-units');
  const zone = el('div', 'plan-range');
  const msg = el('p', 'msg error'); msg.hidden = true;
  let from, to;

  const clamp = n => Math.min(Math.max(1, n || 1), MAX[unit]);
  function draw() {
    start = clamp(start); end = clamp(end);
    from = pointField(unit, start); to = pointField(unit, end);
    const l1 = el('div', 'plan-lbl', t('plan.from')), l2 = el('div', 'plan-lbl', t('plan.to'));
    zone.replaceChildren(l1, from.box, l2, to.box);
    unitRow.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.unit === unit));
  }
  for (const u of UNITS) {
    const b = el('button', null, t('plan.u_' + u)); b.type = 'button'; b.dataset.unit = u;
    b.addEventListener('click', () => {
      if (u === unit) return;
      // Garder à peu près le même endroit en changeant d'unité (sourates et pages : on repart du début)
      const hizbOf = n => PER_HIZB[unit] ? Math.floor((n - 1) / PER_HIZB[unit]) + 1 : unit === 'hizb' ? n : 1;
      const h = hizbOf(from.get());
      unit = u;
      start = end = PER_HIZB[u] ? (h - 1) * PER_HIZB[u] + 1 : u === 'hizb' ? h : 1;
      draw();
    });
    unitRow.append(b);
  }
  const actions = el('div', 'p-actions');
  const save = el('button', 'btn btn-gold', t('plan.save')); save.type = 'submit';
  actions.append(save);
  if (onCancel) { const c = el('button', 'btn btn-line', t('plan.cancel')); c.type = 'button'; c.addEventListener('click', onCancel); actions.append(c); }
  form.append(el('div', 'plan-lbl', t('plan.unit')), unitRow, zone, msg, actions);
  draw();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const s = from.get(), en = to.get();
    if (!(s >= 1 && en <= MAX[unit] && s <= en)) { msg.textContent = t('plan.err_range'); msg.hidden = false; return; }
    save.disabled = true;
    const { error } = await sb.rpc('set_revision_plan', { p_date: dateStr, p_unit: unit, p_start: s, p_end: en });
    save.disabled = false;
    if (error) { console.warn(error); msg.textContent = errText(error); msg.hidden = false; return; }
    onSaved();
  });
  return form;
}

// Suite logique : on continue juste après la dernière révision, même unité, même longueur
function nextAfter(p) {
  if (!p) return null;
  const len = p.end_no - p.start_no;
  const s = p.end_no + 1 > MAX[p.unit] ? 1 : p.end_no + 1;
  return { unit: p.unit, start_no: s, end_no: Math.min(s + len, MAX[p.unit]) };
}

/* ---------- Calendrier des 14 derniers jours ---------- */
function calendar(days, today) {
  const by = Object.fromEntries((days || []).map(x => [x.d, x.s]));
  const wrap = el('div', 'plan-cal');
  wrap.setAttribute('aria-label', t('plan.last_days'));
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const s = by[d] || 'none';
    const c = el('div', 'pc pc-' + s + (d === today ? ' pc-today' : ''));
    c.title = d + ' · ' + (s === 'done' ? t('plan.done') : s === 'missed' ? t('plan.missed') : s === 'planned' ? t('plan.pending') : '—');
    c.append(el('small', null, dayName(d)), el('b', null, s === 'done' ? '✔' : s === 'missed' ? '✖' : '·'), el('small', null, dayNum(d)));
    wrap.append(c);
  }
  return wrap;
}

function statsLine(st) {
  const p = el('p', 'plan-stats');
  if (st.streak > 0) p.append(el('span', 'plan-streak', '🔥 ' + t('plan.streak', { n: fmtNum(st.streak) })));
  if (st.rate30 !== null && st.rate30 !== undefined) p.append(el('span', null, t('plan.rate', { p: fmtPct(st.rate30) })));
  p.append(el('span', null, t('plan.total', { n: fmtNum(st.done_total), h: Number(st.hizb_total || 0).toLocaleString(lang(), { maximumFractionDigits: 1 }) })));
  return p;
}

/* ---------- Carte « Mon programme » sur l'accueil ---------- */
let seq = 0;
export async function showPlanCard(session, gender) {
  const box = $('#plan-home');
  const my = ++seq;
  if (!session) { box.hidden = true; box.replaceChildren(); return; }
  const uid = session.user.id;
  let st, rows;
  try {
    const r1 = await sb.rpc('revision_stats');
    if (r1.error) throw r1.error;
    st = r1.data;
    if (!st) { if (my === seq) box.hidden = true; return; }   // pas encore de profil
    const r2 = await sb.from('revision_plans').select('plan_date, unit, start_no, end_no, status')
      .eq('user_id', uid).order('plan_date', { ascending: false }).limit(3);
    if (r2.error) throw r2.error;
    rows = r2.data || [];
  } catch (e) { console.warn(e); if (my === seq) box.hidden = true; return; }
  if (my !== seq) return;

  const today = st.today, tomorrow = addDays(today, 1);
  const pToday = rows.find(r => r.plan_date === today) || null;
  const pTomorrow = rows.find(r => r.plan_date === tomorrow) || null;
  const last = rows.find(r => r.plan_date < today) || null;
  const g = gender === 'f' ? 'f' : 'm';
  const reload = () => showPlanCard(session, gender);

  box.replaceChildren();
  box.hidden = false;
  const head = el('div', 'plan-head');
  head.append(el('h2', null, t('plan.title')), assidTag({ assiduity: st.assiduity, assiduity_rate: st.rate30, gender: g }));
  box.append(head, statsLine(st));

  /* Aujourd'hui */
  const sToday = el('div', 'plan-day');
  sToday.append(el('h3', null, t('plan.today')));
  if (!pToday) {
    sToday.append(el('p', 'muted', t('plan.none_today')));
    sToday.append(planForm(today, nextAfter(last), reload));
  } else {
    const line = el('div', 'plan-line');
    line.append(el('b', null, planLabel(pToday)), statusTag(pToday.status));
    sToday.append(line);
    const act = el('div', 'p-actions');
    if (pToday.status === 'planned') {
      const done = el('button', 'btn btn-gold btn-done', t('plan.done_btn')); done.type = 'button';
      done.addEventListener('click', async () => {
        done.disabled = true;
        const { error } = await sb.rpc('mark_revision_done', { p_date: today, p_done: true });
        if (error) { console.warn(error); done.disabled = false; alert(errText(error)); return; }
        reload();
      });
      const edit = el('button', 'btn btn-line', t('plan.edit')); edit.type = 'button';
      edit.addEventListener('click', () => { act.remove(); sToday.append(planForm(today, pToday, reload, reload)); });
      act.append(done, edit);
    } else if (pToday.status === 'done') {
      const undo = el('button', 'btn btn-line btn-sm', t('plan.undo')); undo.type = 'button';
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        const { error } = await sb.rpc('mark_revision_done', { p_date: today, p_done: false });
        if (error) { console.warn(error); undo.disabled = false; return; }
        reload();
      });
      act.append(undo);
    }
    sToday.append(act);
  }
  box.append(sToday);

  /* Demain */
  const sTom = el('div', 'plan-day');
  sTom.append(el('h3', null, t('plan.tomorrow')));
  if (pTomorrow) {
    const line = el('div', 'plan-line');
    line.append(el('b', null, planLabel(pTomorrow)), statusTag('planned'));
    const act = el('div', 'p-actions');
    const edit = el('button', 'btn btn-line btn-sm', t('plan.edit')); edit.type = 'button';
    edit.addEventListener('click', () => { act.remove(); sTom.append(planForm(tomorrow, pTomorrow, reload, reload)); });
    const del = el('button', 'btn btn-line btn-sm', t('plan.delete')); del.type = 'button';
    del.addEventListener('click', async () => { del.disabled = true; await sb.rpc('delete_revision_plan', { p_date: tomorrow }); reload(); });
    act.append(edit, del);
    sTom.append(line, act);
  } else if (pToday?.status === 'done') {
    sTom.append(el('p', 'plan-hint', t('plan.tomorrow_hint_' + g)));
    sTom.append(planForm(tomorrow, nextAfter(pToday), reload));
  } else {
    const b = el('button', 'btn btn-line', t('plan.set_tomorrow')); b.type = 'button';
    b.addEventListener('click', () => { b.remove(); sTom.append(planForm(tomorrow, nextAfter(pToday || last), reload, reload)); });
    sTom.append(b);
  }
  box.append(sTom);

  box.append(el('h3', 'plan-cal-t', t('plan.last_days')), calendar(st.days, today));
}
export function resetPlan() { seq++; }

/* ---------- Programme du jour du partenaire (dans la carte « Mon partenaire ») ---------- */
export function partnerPlanEl(other) {
  const box = el('div', 'plan-partner');
  (async () => {
    try {
      const { data: st, error } = await sb.rpc('revision_stats', { p_user: other.id });
      if (error || !st) return;
      const { data } = await sb.from('revision_plans').select('plan_date, unit, start_no, end_no, status')
        .eq('user_id', other.id).eq('plan_date', st.today).maybeSingle();
      const head = el('div', 'plan-head');
      head.append(el('h3', null, t('plan.partner_today', { name: other.first_name })),
        assidTag({ assiduity: st.assiduity, assiduity_rate: st.rate30, gender: other.gender }));
      box.append(head);
      if (data) {
        const line = el('div', 'plan-line');
        line.append(el('b', null, planLabel(data)), statusTag(data.status));
        box.append(line);
      } else box.append(el('p', 'muted', t('plan.partner_none', { name: other.first_name })));
      box.append(statsLine(st), calendar(st.days, st.today));
    } catch (e) { console.warn(e); }
  })();
  return box;
}
