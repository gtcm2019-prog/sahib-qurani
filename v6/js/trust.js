// Avis, signalements, blocage, suppression de compte.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $, showMsg, busy } from './ui.js';
import { el } from './card.js';
import { avatarEl } from './avatar.js';
import { notify } from './notify.js';

let trustSeq = 0;
const REASONS = ['absences', 'not_serious', 'inappropriate', 'false_info', 'sudden_stop', 'other'];
const fmtDate = d => new Intl.DateTimeFormat(lang(), { dateStyle: 'medium' }).format(new Date(d));
const fmtAvg = n => Number(n).toLocaleString(lang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/* ---------- Étoiles ---------- */
export function starsEl(avg, total) {
  const s = el('span', 'stars');
  if (!total) { s.textContent = t('rev.no_reviews'); s.classList.add('muted'); return s; }
  const full = Math.round(avg);
  s.append(el('span', 'stars-ico', '★'.repeat(full) + '☆'.repeat(5 - full)));
  s.append(el('b', null, fmtAvg(avg)));
  s.append(el('small', 'muted', '(' + total.toLocaleString(lang()) + ')'));
  s.setAttribute('aria-label', t('rev.aria', { avg: fmtAvg(avg), n: total }));
  return s;
}

export async function loadRatings(ids) {
  if (!ids.length) return {};
  const { data, error } = await sb.rpc('get_ratings', { p_ids: ids });
  if (error) { console.warn(error); return {}; }
  return Object.fromEntries(data.map(r => [r.target_id, r]));
}

// Ajoute les étoiles aux lignes de résultats déjà affichées
export async function decorateRows(container) {
  const rows = [...container.querySelectorAll('.m-row[data-id]:not([data-rated])')];
  const map = await loadRatings(rows.map(r => r.dataset.id));
  for (const row of rows) {
    row.dataset.rated = '1';
    const r = map[row.dataset.id];
    if (r) row.querySelector('.m-top').append(starsEl(r.avg_rating, Number(r.total)));
  }
}

function starPicker(current) {
  const box = el('div', 'star-pick');
  box.setAttribute('role', 'radiogroup');
  for (let i = 1; i <= 5; i++) {
    const lab = el('label');
    const inp = el('input'); inp.type = 'radio'; inp.name = 'rating'; inp.value = String(i); inp.checked = i === current;
    lab.setAttribute('aria-label', t('rev.n_stars', { n: i }));
    lab.append(inp, el('span', null, '★'));
    box.append(lab);
  }
  const paint = () => {
    const v = Number(box.querySelector('input:checked')?.value || 0);
    [...box.children].forEach((l, i) => l.classList.toggle('on', i < v));
  };
  box.addEventListener('change', paint);
  paint();
  return box;
}

/* ---------- Fiche d'un membre : avis + sécurité ---------- */
export async function renderMemberTrust(p, me, isPartner, onBlocked) {
  const zone = $('#m-trust');
  const card = $('#member-card');
  const seq = ++trustSeq;
  zone.replaceChildren();

  // Moyenne dans l'en-tête
  const map = await loadRatings([p.id]);
  if (seq !== trustSeq) return;
  const r = map[p.id];
  const tags = card.querySelector('.p-tags');
  if (tags) { tags.querySelector('.stars')?.remove(); tags.append(starsEl(r?.avg_rating || 0, Number(r?.total || 0))); }

  // Laisser / modifier mon avis (seulement si mise en relation acceptée)
  if (isPartner) {
    const { data: mine } = await sb.from('reviews').select('id, rating, comment')
      .eq('author_id', me.id).eq('target_id', p.id).maybeSingle();
    if (seq !== trustSeq) return;
    const form = el('form', 'rev-form');
    form.noValidate = true;
    form.append(el('h3', null, t(mine ? 'rev.edit_title' : 'rev.add_title', { name: p.first_name })));
    const pick = starPicker(mine?.rating || 0);
    const ta = el('textarea'); ta.maxLength = 1000; ta.rows = 3; ta.dir = 'auto';
    ta.placeholder = t('rev.comment_ph'); ta.value = mine?.comment || '';
    const btn = el('button', 'btn btn-gold', t('rev.save')); btn.type = 'submit';
    form.append(pick, ta, btn);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const rating = Number(form.querySelector('input[name=rating]:checked')?.value || 0);
      if (!rating) return showMsg(card, 'rev.err_rating');
      busy(form, true);
      const payload = { rating, comment: ta.value.trim() || null };
      const res = mine
        ? await sb.from('reviews').update(payload).eq('id', mine.id)
        : await sb.from('reviews').insert({ author_id: me.id, target_id: p.id, ...payload });
      busy(form, false);
      if (res.error) { console.warn(res.error); return showMsg(card, 'err.generic'); }
      showMsg(card, 'rev.saved', 'ok');
      renderMemberTrust(p, me, isPartner, onBlocked);
    });
    zone.append(form);
  }

  // Avis reçus par ce membre
  const { data: reviews } = await sb.rpc('get_member_reviews', { p_target: p.id });
  if (seq !== trustSeq) return;
  const list = el('div', 'rev-list');
  list.append(el('h3', null, t('rev.list_title')));
  if (!reviews?.length) list.append(el('p', 'muted', t('rev.no_reviews')));
  for (const rv of reviews || []) list.append(reviewItem(rv));
  zone.append(list);

  // Signaler / bloquer
  const safety = el('details', 'safety');
  safety.append(el('summary', null, t('safe.title')));
  const rep = el('form', 'rep-form');
  rep.noValidate = true;
  const lab = el('label'); lab.append(el('span', null, t('safe.reason')));
  const sel = el('select'); sel.name = 'reason';
  sel.append(new Option(t('edit.choose'), ''));
  for (const k of REASONS) sel.append(new Option(t('reason.' + k), k));
  lab.append(sel);
  const det = el('textarea'); det.maxLength = 1000; det.rows = 3; det.dir = 'auto'; det.placeholder = t('safe.details_ph');
  const rb = el('button', 'btn btn-danger', t('safe.report')); rb.type = 'submit';
  rep.append(el('p', 'muted', t('safe.report_hint')), lab, det, rb);
  rep.addEventListener('submit', async e => {
    e.preventDefault();
    if (!sel.value) return showMsg(card, 'safe.err_reason');
    busy(rep, true);
    const { data: newRep, error } = await sb.from('reports').insert({
      reporter_id: me.id, reported_id: p.id, reason: sel.value, details: det.value.trim() || null
    }).select('id').single();
    if (!error && newRep) notify('report', newRep.id);
    busy(rep, false);
    if (error) { console.warn(error); return showMsg(card, error.code === '23505' ? 'safe.err_dup' : 'err.generic'); }
    rep.reset();
    showMsg(card, 'safe.reported', 'ok');
  });

  const bb = el('button', 'btn btn-line btn-block', t('safe.block', { name: p.first_name })); bb.type = 'button';
  bb.addEventListener('click', async () => {
    if (!confirm(t('safe.block_confirm', { name: p.first_name }))) return;
    const { error } = await sb.from('blocks').insert({ blocker_id: me.id, blocked_id: p.id });
    if (error && error.code !== '23505') { console.warn(error); return showMsg(card, 'err.generic'); }
    onBlocked && onBlocked();
  });
  safety.append(rep, el('hr'), el('p', 'muted', t('safe.block_hint')), bb);
  zone.append(safety);
}

function reviewItem(rv, extra) {
  const item = el('div', 'rev-item' + (rv.hidden_by_target ? ' faded' : ''));
  const head = el('div', 'rev-head');
  head.append(el('span', 'stars-ico', '★'.repeat(rv.rating) + '☆'.repeat(5 - rv.rating)), el('small', 'muted', fmtDate(rv.created_at)));
  item.append(head);
  if (rv.comment) { const q = el('p', 'rev-text', rv.comment); q.dir = 'auto'; item.append(q); }
  if (extra) item.append(extra);
  return item;
}

/* ---------- Mon profil : avis reçus (masquables) ---------- */
export async function renderMyReviews(me) {
  const zone = $('#p-reviews');
  zone.replaceChildren();
  const { data } = await sb.from('reviews').select('id, rating, comment, hidden_by_target, created_at')
    .eq('target_id', me.id).order('created_at', { ascending: false });
  const reviews = data || [];
  const head = el('div', 'rev-summary');
  head.append(el('h3', null, t('rev.my_title')));
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  head.append(starsEl(avg, reviews.length));
  zone.append(head);
  if (!reviews.length) { zone.append(el('p', 'muted', t('rev.my_empty'))); return; }
  zone.append(el('p', 'muted small', t('rev.hide_hint')));
  for (const rv of reviews) {
    const b = el('button', 'link', t(rv.hidden_by_target ? 'rev.show' : 'rev.hide')); b.type = 'button';
    b.addEventListener('click', async () => {
      const { error } = await sb.rpc('hide_my_review', { p_review: rv.id, p_hidden: !rv.hidden_by_target });
      if (!error) renderMyReviews(me);
    });
    zone.append(reviewItem(rv, b));
  }
}

/* ---------- Mon profil : membres bloqués ---------- */
export async function renderMyBlocks(me) {
  const zone = $('#p-blocks');
  zone.replaceChildren();
  const { data, error } = await sb.rpc('get_my_blocks');
  if (error) { console.warn(error); return; }
  if (!data.length) { zone.append(el('p', 'muted', t('safe.no_blocks'))); return; }
  for (const b of data) {
    const row = el('div', 'block-row');
    row.append(avatarEl(b.avatar, b.gender, b.first_name, 36), el('b', null, b.first_name || '—'));
    const u = el('button', 'link', t('safe.unblock')); u.type = 'button';
    u.addEventListener('click', async () => {
      const { error } = await sb.from('blocks').delete().eq('blocker_id', me.id).eq('blocked_id', b.blocked_id);
      if (!error) renderMyBlocks(me);
    });
    row.append(u);
    zone.append(row);
  }
}

/* ---------- Suppression du compte ---------- */
const LEAVE_REASONS = ['found_partner', 'no_time', 'no_match', 'not_useful', 'privacy', 'other'];

// Raison du départ (facultative). Renvoie { ok, reason } ; ok=false si annulé.
function askLeaveReason() {
  return new Promise(resolve => {
    const dlg = $('#leave-dialog'), list = $('#leave-reasons');
    list.replaceChildren();
    for (const k of LEAVE_REASONS) {
      const lab = el('label', 'leave-opt');
      const inp = el('input'); inp.type = 'radio'; inp.name = 'leave'; inp.value = k;
      lab.append(inp, el('span', null, t('leave.' + k)));
      list.append(lab);
    }
    const done = ok => {
      const reason = list.querySelector('input:checked')?.value || null;
      dlg.close(); resolve({ ok, reason });
    };
    $('#leave-next').onclick = () => done(true);
    $('#leave-cancel').onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

export async function deleteAccount(onDone) {
  const { ok, reason } = await askLeaveReason();
  if (!ok) return;
  if (!confirm(t('acct.delete_confirm1'))) return;
  const word = prompt(t('acct.delete_confirm2', { word: t('acct.delete_word') }));
  if (word === null) return;
  if (word.trim().toUpperCase() !== t('acct.delete_word').toUpperCase()) { alert(t('acct.delete_mismatch')); return; }
  if (reason) await sb.rpc('set_leave_reason', { p_reason: reason });
  const { error } = await sb.rpc('delete_my_account');
  if (error) { console.warn(error); alert(t('err.generic')); return; }
  await sb.auth.signOut({ scope: 'local' });
  alert(t('acct.deleted'));
  onDone && onDone();
}
