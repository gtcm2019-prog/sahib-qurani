// Carte « Coran mémorisé » (Mes statistiques) : acquis de départ + apprentissages du suivi.
// Trois vues : sourates (1–114), hizb (1–60), juz (1–30). Vert = mémorisé, bleu = reste.
// « Modifier mes acquis » : toucher les disques (hizb, juz = 2 hizb, sourates) puis enregistrer.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { el, fmtPct } from './card.js';
import * as D from './data.js';
import { hizbPages, surahPages } from './hizbpages.js';

const fmtNum = n => Number(n || 0).toLocaleString(lang());
let view = (() => { try { return ['s', 'h', 'j'].includes(localStorage.getItem('sq_q_view')) ? localStorage.getItem('sq_q_view') : 'h'; } catch (e) { return 'h'; } })();

// Même calcul que private.hifz_map dans la base
export function coverage(map, ah, as) {
  const hp = hizbPages(map?.riwaya), sp = surahPages(map?.riwaya);
  const pages = new Set(map?.track_pages || []), thumns = new Set(map?.track_thumns || []);
  for (const h of ah) { for (let p = hp.start[h - 1]; p <= hp.last[h - 1]; p++) pages.add(p); for (let f = 1; f <= 8; f++) thumns.add((h - 1) * 8 + f); }
  for (const s of as) for (let p = sp.start[s - 1]; p <= sp.last[s - 1]; p++) pages.add(p);
  const all = (a, b, set) => { for (let x = a; x <= b; x++) if (!set.has(x)) return false; return true; };
  const hizbs = new Set(), surahs = new Set();
  for (let h = 1; h <= 60; h++) if (all((h - 1) * 8 + 1, h * 8, thumns) || all(hp.start[h - 1], hp.last[h - 1], pages)) hizbs.add(h);
  for (let s = 1; s <= 114; s++) if (as.has(s) || all(sp.start[s - 1], sp.last[s - 1], pages)) surahs.add(s);
  for (const h of hizbs) for (let p = hp.start[h - 1]; p <= hp.last[h - 1]; p++) pages.add(p);
  let juz = 0;
  for (let j = 1; j <= 30; j++) if (hizbs.has(2 * j - 1) && hizbs.has(2 * j)) juz++;
  return { pages, hizbs, surahs, juz };
}

export function quranCard(st, onSaved) {
  const map = st.map || {};
  // Anciennes données (sans « track_pages ») : on garde ce que la base a renvoyé
  if (!map.track_pages) { map.track_pages = map.pages || []; map.track_thumns = map.thumns || []; }
  let ah = new Set(map.acquis?.hizbs || []), as = new Set(map.acquis?.surahs || []);
  let edit = false, saving = false;
  const q = el('div', 'card st-card q-card');

  function draw() {
    const c = coverage(map, ah, as);
    const pct = Math.round(c.pages.size / 604 * 100);
    q.replaceChildren();
    const head = el('div', 'q-head');
    head.append(el('h3', 'st-h3', t('stat.quran')), el('b', 'q-pct', fmtPct(pct)));
    const line = el('div', 'st-prog');
    const fill = el('i'); fill.style.width = Math.min(100, c.pages.size / 604 * 100) + '%';
    line.append(fill);
    q.append(head, line, el('p', 'muted small', t('acq.sub', {
      h: fmtNum(c.hizbs.size), j: fmtNum(c.juz), s: fmtNum(c.surahs.size), r: fmtNum(60 - c.hizbs.size) })));

    const seg = el('div', 'plan-units q-tabs');
    for (const v of ['s', 'h', 'j']) {
      const b = el('button', v === view ? 'on' : '', t('acq.v_' + v)); b.type = 'button';
      b.setAttribute('aria-pressed', String(v === view));
      b.addEventListener('click', () => { view = v; try { localStorage.setItem('sq_q_view', v); } catch (e) { /* ignore */ } draw(); });
      seg.append(b);
    }
    q.append(seg);
    if (edit) q.append(el('p', 'q-help', t('acq.help_' + view)));

    const g = el('div', 'q-grid' + (view === 's' ? ' q-s' : ''));
    g.dir = 'ltr';
    const disc = (n, on, label, onTap) => {
      const d = el('button', 'q-d' + (on ? ' on' : ''), String(n)); d.type = 'button';
      d.title = label; d.setAttribute('aria-label', label); d.setAttribute('aria-pressed', String(on));
      if (edit) d.addEventListener('click', onTap); else d.tabIndex = -1;
      return d;
    };
    if (view === 'h') for (let h = 1; h <= 60; h++) g.append(disc(h, c.hizbs.has(h), t('plan.one_hizb', { n: h }),
      () => { ah.has(h) ? ah.delete(h) : ah.add(h); draw(); }));
    else if (view === 'j') for (let j = 1; j <= 30; j++) {
      const a = 2 * j - 1, b = 2 * j, on = c.hizbs.has(a) && c.hizbs.has(b);
      g.append(disc(j, on, t('plan.one_juz', { n: j }), () => { if (ah.has(a) && ah.has(b)) { ah.delete(a); ah.delete(b); } else { ah.add(a); ah.add(b); } draw(); }));
    } else for (let s = 1; s <= 114; s++) {
      const name = s + '. ' + (lang() === 'ar' ? D.SURAHS_AR[s - 1] : D.SURAHS_LATIN[s - 1]);
      g.append(disc(s, c.surahs.has(s), name, () => { as.has(s) ? as.delete(s) : as.add(s); draw(); }));
    }
    q.append(g);

    const lg = el('div', 'pk-legend');
    const item = (cls, key) => { const s = el('span'); s.append(el('i', cls), t(key)); return s; };
    lg.append(item('lg-learned', 'acq.lg_done'), item('lg-todo', 'acq.lg_todo'));
    q.append(lg);

    const msg = el('p', 'msg error'); msg.hidden = true;
    const act = el('div', 'p-actions');
    if (!edit) {
      const b = el('button', 'btn btn-line', t('acq.edit')); b.type = 'button';
      b.addEventListener('click', () => { edit = true; draw(); });
      act.append(b);
    } else {
      const save = el('button', 'btn btn-gold', t('acq.save')); save.type = 'button';
      const cancel = el('button', 'btn btn-line', t('plan.cancel')); cancel.type = 'button';
      cancel.addEventListener('click', () => {
        ah = new Set(map.acquis?.hizbs || []); as = new Set(map.acquis?.surahs || []); edit = false; draw();
      });
      save.addEventListener('click', async () => {
        if (saving) return;
        saving = true; save.disabled = true;
        const { data, error } = await sb.rpc('set_acquis', { p_hizbs: [...ah].sort((x, y) => x - y), p_surahs: [...as].sort((x, y) => x - y) });
        saving = false; save.disabled = false;
        if (error) { console.warn(error); msg.textContent = t('err.generic'); msg.hidden = false; return; }
        Object.assign(map, data);
        edit = false; draw();
        onSaved?.(data);
      });
      act.append(save, cancel);
    }
    q.append(msg, act);
  }
  draw();
  return q;
}
