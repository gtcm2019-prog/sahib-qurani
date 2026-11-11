// « Mon rythme » (V6) : chaque membre fixe son engagement, l'assiduité est notée selon ce rythme.
//   Apprentissage : quantité + unité (page ou thumn) + période (jour, 2 jours, semaine)
//   Révision      : façon de réviser (sourate, hizb, juz) + quantité chaque jour
// Modifiable une fois par semaine (correction libre le jour même) : règle tenue par la base.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $ } from './ui.js';
import { el, fmtPct } from './card.js';

const H_UNITS = ['page', 'thumn'];
const M_UNITS = ['surah', 'hizb', 'juz'];
const PERIODS = ['day', '2days', 'week'];
const MAXQ = { hifz: 60, muraja: 30 };
const fmtNum = n => Number(n || 0).toLocaleString(lang(), { maximumFractionDigits: 1 });
const fmtDate = d => new Intl.DateTimeFormat(lang(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  .format(new Date(d + 'T00:00:00Z'));
const cnt = (unit, n) => t('plan.cnt_' + unit, { n });

export async function loadRhythm(userId) {
  const { data, error } = await sb.rpc('rhythm_status', userId ? { p_user: userId } : {});
  if (error) throw error;
  return data;
}

/* ---------- Petits éléments ---------- */
function chips(items, value, label, onPick) {
  const box = el('div', 'plan-units');
  for (const v of items) {
    const b = el('button', v === value ? 'on' : '', label(v)); b.type = 'button';
    b.setAttribute('aria-pressed', String(v === value));
    b.addEventListener('click', () => onPick(v));
    box.append(b);
  }
  return box;
}
function stepper(value, max, onChange) {
  const box = el('div', 'rh-step');
  box.dir = 'ltr';
  const minus = el('button', null, '−'); minus.type = 'button'; minus.setAttribute('aria-label', '−');
  const plus = el('button', null, '+'); plus.type = 'button'; plus.setAttribute('aria-label', '+');
  const out = el('output', null, fmtNum(value));
  minus.addEventListener('click', () => onChange(Math.max(1, value - 1)));
  plus.addEventListener('click', () => onChange(Math.min(max, value + 1)));
  box.append(minus, out, plus);
  return box;
}
function bar(done, target) {
  const b = el('div', 'rh-bar');
  const f = el('i');
  f.style.width = Math.min(100, Math.round(100 * (done || 0) / (target || 1))) + '%';
  b.append(f);
  return b;
}

/* ---------- Résumé dans la carte « Mon suivi » de l'accueil ---------- */
export function rhythmSummary(rs) {
  const box = el('div', 'rh-sum');
  const r = rs?.rhythm;
  if (!r) {
    box.classList.add('rh-empty');
    box.append(el('p', null, t('rhythm.home_none')));
    const a = el('a', 'btn btn-gold btn-sm', t('rhythm.home_set')); a.href = '#/rythme';
    box.append(a);
    return box;
  }
  const head = el('div', 'rh-sum-h');
  head.append(el('b', null, t('rhythm.title')));
  const a = el('a', 'link small', t('rhythm.edit')); a.href = '#/rythme';
  head.append(a);
  box.append(head);
  if (rs.hifz) {
    const row = el('div', 'rh-row');
    const l = el('div', 'rh-row-t');
    l.append(el('span', null, t('plan.k_hifz') + ' · ' + t('rhythm.per_' + r.hifz_period)),
      el('b', null, cnt(r.hifz_unit, fmtNum(rs.hifz.done) + ' / ' + fmtNum(rs.hifz.target))));
    row.append(l, bar(rs.hifz.done, rs.hifz.target));
    box.append(row);
  }
  if (rs.muraja) {
    const ok = rs.muraja.done >= rs.muraja.target;
    const l = el('div', 'rh-row-t');
    l.append(el('span', null, t('plan.k_muraja') + ' · ' + t('rhythm.per_day')),
      el('b', ok ? 'rh-ok' : null, (ok ? '✔ ' : '') + cnt(r.muraja_unit, fmtNum(Math.min(rs.muraja.done, 999)) + ' / ' + fmtNum(rs.muraja.target))));
    box.append(l);
  }
  const ev = rs.eval;
  if (ev && ev.rate !== null && ev.rate !== undefined) box.append(el('p', 'rh-note', t('rhythm.kept', { p: fmtPct(ev.rate) })));
  return box;
}

/* ---------- Page « Mon rythme » ---------- */
let seq = 0;
export async function showRhythm(session) {
  const box = $('#rhythm-box');
  const my = ++seq;
  box.replaceChildren(el('p', 'muted center', t('common.loading')));
  let rs;
  try { rs = await loadRhythm(); } catch (e) { console.warn(e); if (my === seq) box.replaceChildren(el('p', 'msg error', t('err.generic'))); return; }
  if (my !== seq) return;
  const r = rs?.rhythm || {};
  const s = {
    hUnit: r.hifz_unit || (rs?.rhythm ? null : 'page'), hQty: r.hifz_qty || 5, hPer: r.hifz_period || 'week',
    mUnit: r.muraja_unit || (rs?.rhythm ? null : 'hizb'), mQty: r.muraja_qty || 1
  };

  const card = el('div', 'card rh');
  const h = el('h2', null, t('rhythm.title'));
  const intro = el('p', 'muted', t('rhythm.intro'));
  const hBox = el('div', 'rh-k'), mBox = el('div', 'rh-k');
  const msg = el('p', 'msg'); msg.hidden = true;
  const note = el('p', 'small muted', rs?.next_change ? t('rhythm.next', { d: fmtDate(rs.next_change) }) : t('rhythm.weekly'));
  const save = el('button', 'btn btn-gold rh-save', t('rhythm.save')); save.type = 'button';
  const back = el('a', 'btn btn-line', t('rhythm.back')); back.href = '#/';
  const actions = el('div', 'p-actions'); actions.append(save, back);
  card.append(h, intro, hBox, mBox, note, msg, actions);
  box.replaceChildren(card);

  function drawH() {
    hBox.replaceChildren(el('h3', null, '📖 ' + t('plan.k_hifz')));
    hBox.append(el('div', 'plan-lbl', t('rhythm.unit')),
      chips([...H_UNITS, null], s.hUnit, v => v ? t('rhythm.u_' + v) : t('rhythm.none'), v => { s.hUnit = v; drawH(); }));
    if (s.hUnit) {
      hBox.append(el('div', 'plan-lbl', t('rhythm.qty')), stepper(s.hQty, MAXQ.hifz, v => { s.hQty = v; drawH(); }),
        el('div', 'plan-lbl', t('rhythm.period')),
        chips(PERIODS, s.hPer, v => t('rhythm.p_' + v), v => { s.hPer = v; drawH(); }),
        el('p', 'rh-say', t('rhythm.say_hifz', { q: cnt(s.hUnit, fmtNum(s.hQty)), p: t('rhythm.p_' + s.hPer) })));
    } else hBox.append(el('p', 'rh-say', t('rhythm.say_hifz_none')));
  }
  function drawM() {
    mBox.replaceChildren(el('h3', null, '🔁 ' + t('rhythm.k_muraja')));
    mBox.append(el('div', 'plan-lbl', t('rhythm.way')),
      chips([...M_UNITS, null], s.mUnit, v => v ? t('rhythm.u_' + v) : t('rhythm.none'), v => { s.mUnit = v; drawM(); }));
    if (s.mUnit) {
      mBox.append(el('div', 'plan-lbl', t('rhythm.each_day')), stepper(s.mQty, MAXQ.muraja, v => { s.mQty = v; drawM(); }),
        el('p', 'rh-say', t('rhythm.say_muraja', { q: cnt(s.mUnit, fmtNum(s.mQty)) })));
    } else mBox.append(el('p', 'rh-say', t('rhythm.say_muraja_none')));
  }
  drawH(); drawM();

  const show = (text, ok) => { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'error'); msg.hidden = false; };
  save.addEventListener('click', async () => {
    if (!s.hUnit && !s.mUnit) return show(t('rhythm.empty'));
    save.disabled = true;
    const { error } = await sb.rpc('set_rhythm', {
      p_hifz_unit: s.hUnit, p_hifz_qty: s.hUnit ? s.hQty : null, p_hifz_period: s.hUnit ? s.hPer : null,
      p_muraja_unit: s.mUnit, p_muraja_qty: s.mUnit ? s.mQty : null
    });
    save.disabled = false;
    if (error) {
      console.warn(error);
      const m = String(error.message || '').match(/too_soon:(\d{4}-\d{2}-\d{2})/);
      return show(m ? t('rhythm.too_soon', { d: fmtDate(m[1]) }) : t('err.generic'));
    }
    show(t('rhythm.saved'), true);
    setTimeout(() => { if (location.hash.startsWith('#/rythme')) location.hash = '#/'; }, 900);
  });
}
