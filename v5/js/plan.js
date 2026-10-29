// Suivi quotidien (V4) : deux programmes par jour et par membre.
//   hifz   = apprentissage (nouveau) : page (1–604) ou thumn (1–480, « thumn f du hizb h »)
//   muraja = révision : sourate (1–114), hizb (1–60) ou juz (1–30), plusieurs à la suite
// Choix au doigt : disques numérotés (1er appui = début, 2e = fin). Pages : carrousel à glisser.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $ } from './ui.js';
import { el, surahName, fmtPct, assidTag } from './card.js';
import * as D from './data.js';
import { hizbPages } from './hizbpages.js';

export const KINDS = ['hifz', 'muraja'];
const UNITS = { hifz: ['page', 'thumn'], muraja: ['surah', 'hizb', 'juz'] };
const MAX = { page: 604, thumn: 480, surah: 114, hizb: 60, juz: 30 };
const fmtNum = n => Number(n || 0).toLocaleString(lang());
const arrow = () => (lang() === 'ar' ? ' ← ' : ' → ');

/* ---------- Dates (AAAA-MM-JJ, jour local du membre donné par la base) ---------- */
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/* ---------- Libellés ---------- */
export function partLabel(unit, n) {
  if (unit === 'surah') return t('plan.u_surah') + ' ' + surahName(n);
  if (unit === 'thumn') return t('plan.one_thumn', { f: (n - 1) % 8 + 1, h: Math.floor((n - 1) / 8) + 1 });
  return t('plan.one_' + unit, { n });
}
export const planLabel = p => p.start_no === p.end_no ? partLabel(p.unit, p.start_no)
  : partLabel(p.unit, p.start_no) + arrow() + partLabel(p.unit, p.end_no);
const countLabel = (unit, n) => t('plan.cnt_' + unit, { n: fmtNum(n) });

function statusTag(status) {
  const s = status || 'planned';
  return el('span', 'tag plan-st plan-st-' + s, s === 'done' ? '✔ ' + t('plan.done') : s === 'missed' ? '✖ ' + t('plan.missed') : t('plan.pending'));
}

function errText(error) {
  const m = String(error?.message || '');
  if (m.includes('already_done')) return t('plan.err_done');
  if (m.includes('check constraint')) return t('plan.err_range');
  if (m.toLowerCase().includes('fetch') || m.toLowerCase().includes('network')) return t('err.network');
  return t('err.generic');
}

/* ---------- Ce qui est déjà appris (pour colorer en vert) ---------- */
export function learnedSets(map) {
  const pages = new Set(map?.pages || []), thumns = new Set(map?.thumns || []), hizbs = new Set(map?.hizbs || []);
  const hp = hizbPages(map?.riwaya);
  for (const h of hizbs) for (let p = hp.start[h - 1]; p <= hp.last[h - 1]; p++) pages.add(p);
  for (const h of hizbs) for (let f = 1; f <= 8; f++) thumns.add((h - 1) * 8 + f);
  // hizb commencé : au moins un thumn ou une page appris
  const started = new Set();
  for (let h = 1; h <= 60; h++) {
    if (hizbs.has(h)) continue;
    let s = false;
    for (let f = 1; f <= 8 && !s; f++) s = thumns.has((h - 1) * 8 + f);
    for (let p = hp.start[h - 1]; p <= hp.last[h - 1] && !s; p++) s = pages.has(p);
    if (s) started.add(h);
  }
  return { pages, thumns, hizbs, started };
}

/* ---------- Sélecteur à disques ---------- */
function picker(kind, initial, map) {
  const L = kind === 'hifz' ? learnedSets(map) : null;
  let unit = initial?.unit && UNITS[kind].includes(initial.unit) ? initial.unit : UNITS[kind][0];
  let a = initial?.start_no || null, b = initial?.end_no || null;
  let panel = null, openHizb = 0;
  const root = el('div', 'pk');
  const units = el('div', 'plan-units');
  const zone = el('div', 'pk-zone');
  const sum = el('div', 'pk-sum');
  root.append(el('div', 'plan-lbl', t('plan.unit')), units, zone, sum);

  for (const u of UNITS[kind]) {
    const x = el('button', null, t('plan.u_' + u)); x.type = 'button'; x.dataset.unit = u;
    x.addEventListener('click', () => { if (u !== unit) { unit = u; a = b = null; panel = null; openHizb = 0; draw(); } });
    units.append(x);
  }

  function pick(n) {
    if (a && b) { a = n; b = null; }
    else if (!a) a = n;
    else if (n < a) { b = a; a = n; }
    else b = n;
    draw();
  }
  const inSel = n => a && n >= a && n <= (b || a);
  function disc(n, learned, label, cls) {
    const d = el('button', 'disc' + (cls ? ' ' + cls : ''), String(label ?? n)); d.type = 'button';
    if (inSel(n)) d.classList.add(b && b !== a && n === b ? 'end' : 'sel');
    else if (learned) d.classList.add('learned');
    d.setAttribute('aria-pressed', String(!!inSel(n)));
    d.addEventListener('click', () => pick(n));
    return d;
  }

  function drawPages() {
    const nP = Math.ceil(604 / 50);
    if (panel === null) {
      const first = a || (L ? [...Array(604).keys()].map(i => i + 1).find(p => !L.pages.has(p)) || 1 : 1);
      panel = Math.floor((first - 1) / 50);
    }
    const lbl = i => t('plan.pages_range', { a: i * 50 + 1, b: Math.min(604, i * 50 + 50) });
    const nav = el('div', 'pk-nav');
    nav.dir = 'ltr';
    const pv = el('button', 'pk-arrow', '‹'); pv.type = 'button'; pv.setAttribute('aria-label', '‹');
    const nx = el('button', 'pk-arrow', '›'); nx.type = 'button'; nx.setAttribute('aria-label', '›');
    const title = el('b', null, lbl(panel));
    nav.append(pv, title, nx);
    const sw = el('div', 'pk-swipe'); sw.dir = 'ltr';
    for (let i = 0; i < nP; i++) {
      const g = el('div', 'pk-grid pk-panel');
      for (let n = i * 50 + 1; n <= Math.min(604, i * 50 + 50); n++) g.append(disc(n, L?.pages.has(n)));
      sw.append(g);
    }
    const dots = el('div', 'pk-dots'); dots.dir = 'ltr';
    const mark = () => { title.textContent = lbl(panel); [...dots.children].forEach((x, i) => x.classList.toggle('on', i === panel)); };
    const goTo = (i, smooth) => { panel = Math.max(0, Math.min(nP - 1, i)); sw.scrollTo({ left: panel * sw.clientWidth, behavior: smooth ? 'smooth' : 'auto' }); mark(); };
    for (let i = 0; i < nP; i++) { const x = el('button'); x.type = 'button'; x.setAttribute('aria-label', lbl(i)); x.addEventListener('click', () => goTo(i, true)); dots.append(x); }
    let tm;
    sw.addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(() => { if (sw.clientWidth) { panel = Math.round(sw.scrollLeft / sw.clientWidth); mark(); } }, 80); });
    pv.addEventListener('click', () => goTo(panel - 1, true));
    nx.addEventListener('click', () => goTo(panel + 1, true));
    zone.append(nav, sw, dots);
    mark();
    requestAnimationFrame(() => goTo(panel, false));
  }

  function drawThumn() {
    zone.append(el('p', 'pk-help', t('plan.pick_hizb')));
    const g = el('div', 'pk-grid pk-g6');
    for (let h = 1; h <= 60; h++) {
      const first = (h - 1) * 8 + 1, last = h * 8;
      const d = el('button', 'disc', String(h)); d.type = 'button';
      if (a && last >= a && first <= (b || a)) d.classList.add('sel');
      else if (L?.hizbs.has(h)) d.classList.add('learned');
      else if (L?.started.has(h)) d.classList.add('half');
      if (h === openHizb) d.classList.add('open');
      d.setAttribute('aria-expanded', String(h === openHizb));
      d.addEventListener('click', () => { openHizb = openHizb === h ? 0 : h; draw(); });
      g.append(d);
      if (openHizb && h === Math.min(60, Math.ceil(openHizb / 6) * 6)) {
        const bub = el('div', 'pk-bubble');
        const col = (openHizb - 1) % 6;
        bub.style.setProperty('--x', ((lang() === 'ar' ? 5 - col : col) + 0.5) / 6 * 100 + '%');
        bub.append(el('div', 'pk-bub-t', t('plan.bubble', { h: openHizb })));
        const r = el('div', 'pk-grid');
        for (let f = 1; f <= 8; f++) { const n = (openHizb - 1) * 8 + f; r.append(disc(n, L?.thumns.has(n), f)); }
        bub.append(r);
        g.append(bub);
      }
    }
    zone.append(g);
  }

  function drawSurahs() {
    const list = el('div', 'pk-surahs');
    for (let n = 1; n <= 114; n++) {
      const x = el('button', 'pk-surah'); x.type = 'button';
      if (inSel(n)) x.classList.add('sel');
      x.setAttribute('aria-pressed', String(!!inSel(n)));
      x.append(el('span', 'n', String(n)), el('span', null, lang() === 'ar' ? D.SURAHS_AR[n - 1] : D.SURAHS_LATIN[n - 1]));
      x.addEventListener('click', () => pick(n));
      list.append(x);
    }
    zone.append(list);
    if (a) requestAnimationFrame(() => { const s = list.children[a - 1]; if (s) list.scrollTop = Math.max(0, s.offsetTop - list.offsetTop - 40); });
  }

  function drawGrid(max, note) {
    if (note) zone.append(el('p', 'pk-help', note));
    const g = el('div', 'pk-grid pk-g6');
    for (let n = 1; n <= max; n++) g.append(disc(n, false));
    zone.append(g);
  }

  function legend() {
    const lg = el('div', 'pk-legend');
    const item = (cls, key) => { const s = el('span'); s.append(el('i', cls), t(key)); return s; };
    if (L) lg.append(item('lg-learned', 'plan.lg_learned'), item('lg-todo', 'plan.lg_todo'));
    lg.append(item('lg-sel', 'plan.lg_sel'));
    return lg;
  }

  function draw() {
    units.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.unit === unit));
    zone.replaceChildren();
    if (unit === 'page') drawPages();
    else if (unit === 'thumn') drawThumn();
    else if (unit === 'surah') drawSurahs();
    else if (unit === 'hizb') drawGrid(60);
    else drawGrid(30, t('plan.juz_note'));
    if (unit !== 'surah') zone.append(legend());
    sum.replaceChildren();
    if (a) {
      const p = { unit, start_no: a, end_no: b || a };
      sum.append(el('b', null, planLabel(p)), el('small', null, countLabel(unit, p.end_no - p.start_no + 1)));
    } else sum.append(el('small', null, t('plan.pick_help')));
  }
  draw();
  return { root, get: () => (a ? { unit, start_no: a, end_no: b || a } : null) };
}

function planForm(kind, dateStr, initial, map, onSaved, onCancel) {
  const form = el('form', 'plan-form');
  const pk = picker(kind, initial, map);
  const msg = el('p', 'msg error'); msg.hidden = true;
  const actions = el('div', 'p-actions');
  const save = el('button', 'btn btn-gold', t('plan.save')); save.type = 'submit';
  actions.append(save);
  if (onCancel) { const c = el('button', 'btn btn-line', t('plan.cancel')); c.type = 'button'; c.addEventListener('click', onCancel); actions.append(c); }
  form.append(pk.root, msg, actions);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = pk.get();
    if (!v) { msg.textContent = t('plan.pick_help'); msg.hidden = false; return; }
    save.disabled = true;
    const { error } = await sb.rpc('set_revision_plan', { p_kind: kind, p_date: dateStr, p_unit: v.unit, p_start: v.start_no, p_end: v.end_no });
    save.disabled = false;
    if (error) { console.warn(error); msg.textContent = errText(error); msg.hidden = false; return; }
    onSaved();
  });
  return form;
}

// Proposition par défaut : juste après le dernier programme (même unité, même longueur) ;
// apprentissage sans historique : première page pas encore apprise.
function nextAfter(p, kind, map) {
  if (p) {
    const len = p.end_no - p.start_no;
    const s = p.end_no + 1 > MAX[p.unit] ? 1 : p.end_no + 1;
    return { unit: p.unit, start_no: s, end_no: Math.min(s + len, MAX[p.unit]) };
  }
  if (kind === 'hifz') {
    const L = learnedSets(map);
    for (let n = 1; n <= 604; n++) if (!L.pages.has(n)) return { unit: 'page', start_no: n, end_no: n };
  }
  return null;
}

function statsLine(kind, k, map) {
  const p = el('p', 'plan-stats');
  if (k?.streak > 0) p.append(el('span', 'plan-streak', '🔥 ' + t('plan.streak', { n: fmtNum(k.streak) })));
  if (k?.rate30 !== null && k?.rate30 !== undefined) p.append(el('span', null, t('plan.rate', { p: fmtPct(k.rate30) })));
  if (kind === 'hifz') {
    const L = learnedSets(map);
    p.append(el('span', null, t('plan.learned', { n: fmtNum(L.pages.size), p: fmtPct(Math.round(L.pages.size / 604 * 100)), h: fmtNum(L.hizbs.size) })));
  } else p.append(el('span', null, t('plan.total', { n: fmtNum(k?.done_total), h: fmtNum(k?.hizb_total) })));
  return p;
}

/* ---------- Carte « Mon suivi » sur l'accueil ---------- */
let seq = 0;
let tab = (() => { try { return localStorage.getItem('sq_plan_tab') === 'muraja' ? 'muraja' : 'hifz'; } catch (e) { return 'hifz'; } })();

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
    const r2 = await sb.from('revision_plans').select('plan_date, kind, unit, start_no, end_no, status')
      .eq('user_id', uid).gte('plan_date', addDays(st.today, -60)).order('plan_date', { ascending: false }).limit(60);
    if (r2.error) throw r2.error;
    rows = r2.data || [];
  } catch (e) { console.warn(e); if (my === seq) box.hidden = true; return; }
  if (my !== seq) return;

  const g = gender === 'f' ? 'f' : 'm';
  const reload = () => showPlanCard(session, gender);
  box.replaceChildren();
  box.hidden = false;
  const head = el('div', 'plan-head');
  head.append(el('h2', null, t('plan.title')), assidTag({ assiduity: st.assiduity, assiduity_rate: st.rate30, gender: g }));
  const tabs = el('div', 'plan-tabs');
  tabs.setAttribute('role', 'tablist');
  const body = el('div', 'plan-body');
  for (const k of KINDS) {
    const x = el('button', k === tab ? 'on' : ''); x.type = 'button'; x.setAttribute('role', 'tab');
    x.setAttribute('aria-selected', String(k === tab));
    x.append(el('b', null, t('plan.k_' + k)), el('small', null, t('plan.k_' + k + '_sub')));
    const todayRow = rows.find(r => r.kind === k && r.plan_date === st.today);
    if (todayRow?.status === 'done') x.append(el('span', 'plan-tab-ok', '✔'));
    x.addEventListener('click', () => {
      if (tab === k) return;
      tab = k; try { localStorage.setItem('sq_plan_tab', k); } catch (e) { /* ignore */ }
      tabs.querySelectorAll('button').forEach(b => { const on = b === x; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      drawKind();
    });
    tabs.append(x);
  }
  box.append(head, tabs, body);

  function drawKind() {
    const kind = tab, k = st[kind] || {};
    const today = st.today;
    const mine = rows.filter(r => r.kind === kind);
    const pToday = mine.find(r => r.plan_date === today) || null;
    const last = mine.find(r => r.plan_date < today && r.status === 'done') || mine.find(r => r.plan_date < today) || null;
    body.replaceChildren(statsLine(kind, k, st.map));

    /* Aujourd'hui */
    const sToday = el('div', 'plan-day');
    sToday.append(el('h3', null, t('plan.today')));
    if (!pToday) {
      sToday.append(el('p', 'muted', t('plan.none_today_' + kind)));
      sToday.append(planForm(kind, today, nextAfter(last, kind, st.map), st.map, reload));
    } else {
      const line = el('div', 'plan-line');
      line.append(el('b', null, planLabel(pToday)), statusTag(pToday.status));
      sToday.append(line);
      const act = el('div', 'p-actions');
      if (pToday.status === 'planned') {
        const done = el('button', 'btn btn-gold btn-done', t('plan.done_btn')); done.type = 'button';
        done.addEventListener('click', async () => {
          done.disabled = true;
          const { error } = await sb.rpc('mark_revision_done', { p_kind: kind, p_date: today, p_done: true });
          if (error) { console.warn(error); done.disabled = false; alert(errText(error)); return; }
          reload();
        });
        const edit = el('button', 'btn btn-line', t('plan.edit')); edit.type = 'button';
        edit.addEventListener('click', () => { act.remove(); sToday.append(planForm(kind, today, pToday, st.map, reload, reload)); });
        act.append(done, edit);
      } else if (pToday.status === 'done') {
        const undo = el('button', 'btn btn-line btn-sm', t('plan.undo')); undo.type = 'button';
        undo.addEventListener('click', async () => {
          undo.disabled = true;
          const { error } = await sb.rpc('mark_revision_done', { p_kind: kind, p_date: today, p_done: false });
          if (error) { console.warn(error); undo.disabled = false; return; }
          reload();
        });
        act.append(undo);
      }
      sToday.append(act);
    }
    body.append(sToday);

    if (pToday?.status === 'done') body.append(el('p', 'plan-hint', t('plan.done_hint_' + g)));
  }
  drawKind();
}
export function resetPlan() { seq++; }

/* ---------- Programmes du jour du partenaire (dans la carte « Mon partenaire ») ---------- */
export function partnerPlanEl(other) {
  const box = el('div', 'plan-partner');
  (async () => {
    try {
      const { data: st, error } = await sb.rpc('revision_stats', { p_user: other.id });
      if (error || !st) return;
      const { data } = await sb.from('revision_plans').select('kind, unit, start_no, end_no, status')
        .eq('user_id', other.id).eq('plan_date', st.today);
      const head = el('div', 'plan-head');
      head.append(el('h3', null, t('plan.partner_today', { name: other.first_name })),
        assidTag({ assiduity: st.assiduity, assiduity_rate: st.rate30, gender: other.gender }));
      box.append(head);
      for (const kind of KINDS) {
        const p = (data || []).find(r => r.kind === kind);
        const line = el('div', 'plan-line plan-pline');
        line.append(el('span', 'muted', t('plan.k_' + kind) + ' :'));
        if (p) line.append(el('b', null, planLabel(p)), statusTag(p.status));
        else line.append(el('span', 'muted', '—'));
        const k = st[kind];
        if (k?.streak > 0) line.append(el('small', 'plan-streak', '🔥 ' + fmtNum(k.streak)));
        box.append(line);
      }
      if (!(data || []).length) box.append(el('p', 'muted small', t('plan.partner_none', { name: other.first_name })));
    } catch (e) { console.warn(e); }
  })();
  return box;
}
