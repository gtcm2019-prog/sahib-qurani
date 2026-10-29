// Statistiques personnelles du membre (V5) : onglet « Statistiques » de la barre du bas.
// Résumé simple : période (7 jours / 30 jours / 12 mois), 4 chiffres clés,
// un graphique en barres (programmes accomplis) et la part du Coran apprise.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $ } from './ui.js';
import { el, fmtPct } from './card.js';
import { learnedSets } from './plan.js';

const fmtNum = n => Number(n || 0).toLocaleString(lang());
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (d, o) => new Intl.DateTimeFormat(lang(), { ...o, timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + n, 1)); return x.toISOString().slice(0, 7); };

let period = (() => { try { return ['w', 'm', 'y'].includes(localStorage.getItem('sq_stat_p')) ? localStorage.getItem('sq_stat_p') : 'w'; } catch (e) { return 'w'; } })();
let seq = 0;
let cache = null;   // { uid, st, rows }

/* ---------- Calculs ---------- */
function volume(rows) {
  const v = { pages: 0, thumns: 0, hizbs: 0, surahs: 0, done: 0, missed: 0 };
  for (const r of rows) {
    if (r.status === 'done') {
      v.done++;
      const n = r.end_no - r.start_no + 1;
      if (r.unit === 'page') v.pages += n;
      else if (r.unit === 'thumn') v.thumns += n;
      else if (r.unit === 'hizb') v.hizbs += n;
      else if (r.unit === 'juz') v.hizbs += 2 * n;
      else if (r.unit === 'surah') v.surahs += n;
    } else if (r.status === 'missed') v.missed++;
  }
  return v;
}

// Colonnes du graphique : une par jour (7 ou 30) ou une par mois (12)
function buckets(rows, today) {
  const cols = [];
  if (period === 'y') {
    const m0 = today.slice(0, 7);
    for (let i = 11; i >= 0; i--) {
      const ym = addMonths(m0, -i);
      cols.push({ key: ym, label: fmt(ym + '-01', { month: 'narrow' }), title: fmt(ym + '-01', { month: 'long', year: 'numeric' }), today: i === 0 });
    }
  } else {
    const n = period === 'w' ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const label = period === 'w' ? fmt(d, { weekday: 'narrow' }) : (i % 5 === 0 ? fmt(d, { day: 'numeric' }) : '');
      cols.push({ key: d, label, title: fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }), today: i === 0 });
    }
  }
  const by = Object.fromEntries(cols.map(c => [c.key, Object.assign(c, { hifz: 0, muraja: 0, missed: 0 })]));
  for (const r of rows) {
    const c = by[period === 'y' ? r.plan_date.slice(0, 7) : r.plan_date];
    if (!c) continue;
    if (r.status === 'done') c[r.kind]++;
    else if (r.status === 'missed') c.missed++;
  }
  return cols;
}

/* ---------- Affichage ---------- */
function tile(icon, label, value, sub, cls) {
  const x = el('div', 'st-tile' + (cls ? ' ' + cls : ''));
  x.append(el('span', 'st-ico', icon), el('b', 'st-val', value), el('span', 'st-lbl', label));
  if (sub) x.append(el('small', 'st-sub', sub));
  return x;
}

function chart(cols) {
  const max = Math.max(period === 'y' ? 1 : 2, ...cols.map(c => c.hifz + c.muraja));
  const wrap = el('div', 'st-chart st-chart-' + period);
  const grid = el('div', 'st-bars');
  grid.style.gridTemplateColumns = `repeat(${cols.length}, minmax(0, 1fr))`;
  for (const c of cols) {
    const col = el('div', 'st-col' + (c.today ? ' st-today' : ''));
    col.title = c.title + ' · ' + t('plan.k_hifz') + ' ' + fmtNum(c.hifz) + ' · ' + t('plan.k_muraja') + ' ' + fmtNum(c.muraja);
    const bar = el('div', 'st-bar');
    if (c.muraja) { const s = el('i', 'st-m'); s.style.height = (c.muraja / max * 100) + '%'; bar.append(s); }
    if (c.hifz) { const s = el('i', 'st-h'); s.style.height = (c.hifz / max * 100) + '%'; bar.append(s); }
    if (period === 'y' && c.hifz + c.muraja) bar.append(el('em', 'st-n', fmtNum(c.hifz + c.muraja)));
    if (period !== 'y' && c.missed) bar.append(el('em', 'st-miss', '✖'));
    col.append(bar, el('span', 'st-x', c.label));
    grid.append(col);
  }
  const leg = el('div', 'st-leg');
  leg.append(el('span', 'st-lh', t('stat.leg_hifz')), el('span', 'st-lm', t('stat.leg_muraja')));
  if (period !== 'y') leg.append(el('span', 'st-lx', '✖ ' + t('stat.leg_missed')));
  wrap.append(grid, leg);
  return wrap;
}

function draw(box, st, rows) {
  const today = st.today;
  const from = period === 'w' ? addDays(today, -6) : period === 'm' ? addDays(today, -29) : addMonths(today.slice(0, 7), -11) + '-01';
  const inP = rows.filter(r => r.plan_date >= from && r.plan_date <= today);
  const v = volume(inP);

  box.replaceChildren();
  const card = el('div', 'card st-card');
  card.append(el('h2', null, t('stat.title')));

  const seg = el('div', 'seg seg-full st-seg');
  for (const p of ['w', 'm', 'y']) {
    const b = el('button', p === period ? 'on' : '', t('stat.p_' + p)); b.type = 'button';
    b.setAttribute('aria-pressed', String(p === period));
    b.addEventListener('click', () => {
      if (p === period) return;
      period = p; try { localStorage.setItem('sq_stat_p', p); } catch (e) { /* ignore */ }
      draw(box, st, rows);
    });
    seg.append(b);
  }
  card.append(seg);

  if (!rows.length) {
    card.append(el('p', 'muted center st-empty', t('stat.empty')));
    const a = el('a', 'btn btn-gold', t('stat.go_home')); a.href = '#/';
    const c = el('div', 'center'); c.append(a); card.append(c);
    box.append(card);
    return;
  }

  // 4 chiffres clés
  const tiles = el('div', 'st-tiles');
  const rate = v.done + v.missed ? Math.round(v.done / (v.done + v.missed) * 100) : null;
  tiles.append(
    tile('✔', t('stat.rate'), rate === null ? '—' : fmtPct(rate), t('stat.rate_sub', { d: fmtNum(v.done), m: fmtNum(v.missed) }), 'st-rate'),
    tile('🔥', t('stat.streak'), fmtNum(st.streak), t('stat.streak_sub'), 'st-streak'),
    tile('📖', t('stat.learn'), fmtNum(v.pages), (v.thumns ? t('stat.plus_thumn', { n: fmtNum(v.thumns) }) + ' · ' : '') + t('stat.learn_unit'), 'st-learn'),
    tile('🔁', t('stat.rev'), fmtNum(v.hizbs), (v.surahs ? t('stat.plus_surah', { n: fmtNum(v.surahs) }) + ' · ' : '') + t('stat.rev_unit'), 'st-rev'));
  card.append(tiles);

  // Graphique
  card.append(el('h3', 'st-h3', t('stat.chart')), chart(buckets(inP, today)));
  box.append(card);

  // Part du Coran apprise (depuis le début)
  const L = learnedSets(st.map);
  const pct = Math.round(L.pages.size / 604 * 100);
  const q = el('div', 'card st-card');
  q.append(el('h3', 'st-h3', t('stat.quran')));
  const line = el('div', 'st-prog');
  const fill = el('i'); fill.style.width = Math.min(100, L.pages.size / 604 * 100) + '%';
  line.append(fill);
  const big = el('p', 'st-big');
  big.append(el('b', null, fmtPct(pct)));
  q.append(big, line, el('p', 'muted small center', t('stat.quran_sub', { p: fmtNum(L.pages.size), h: fmtNum(st.hizb_memorized ?? L.hizbs.size) })));
  box.append(q);
}

export async function showStats(session) {
  const box = $('#stats-box');
  const my = ++seq;
  if (!session) { box.replaceChildren(); return; }
  const uid = session.user.id;
  if (cache?.uid === uid) draw(box, cache.st, cache.rows);
  else box.replaceChildren(el('p', 'muted center', t('common.loading')));
  try {
    const r1 = await sb.rpc('revision_stats');
    if (r1.error) throw r1.error;
    const st = r1.data;
    if (my !== seq) return;
    if (!st) { box.replaceChildren(el('p', 'muted center', t('stat.empty'))); return; }
    const r2 = await sb.from('revision_plans').select('plan_date, kind, unit, start_no, end_no, status')
      .eq('user_id', uid).gte('plan_date', addMonths(st.today.slice(0, 7), -11) + '-01')
      .order('plan_date', { ascending: false }).limit(800);
    if (r2.error) throw r2.error;
    if (my !== seq) return;
    // Jour passé resté « en attente » = non accompli (comme dans la base)
    const rows = (r2.data || []).map(r => (r.status === 'planned' && r.plan_date < st.today ? { ...r, status: 'missed' } : r));
    cache = { uid, st, rows };
    draw(box, st, rows);
  } catch (e) {
    console.warn(e);
    if (my === seq && !cache) box.replaceChildren(el('p', 'msg error', t('err.generic')));
  }
}
export function resetStats() { seq++; cache = null; }
