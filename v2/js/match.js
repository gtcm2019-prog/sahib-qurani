// Recherche, fiche d'un membre et demandes de mise en relation.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $, $$, showMsg, busy } from './ui.js';
import * as D from './data.js';
import { loadMine } from './profile.js';
import { el, profileCard, memberRow, countryName, languageName } from './card.js';
import { avatarEl } from './avatar.js';
import { decorateRows, renderMemberTrust } from './trust.js';

const COLS = 'id, first_name, gender, country, city, age_range, languages, level, riwaya, surah_from, surah_to, hizb_memorized, availability, contact_mode, status, badge, avatar, is_paused, created_at';
const PAGE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let goTo = () => {};
let session = null;
let me = null;              // mon profil public
let page = 0;
let searchedLang = null;    // pour relancer si la langue change
let box = 'in';
let lastCount = 0;
let searchSeq = 0, relSeq = 0, reqSeq = 0, memSeq = 0;

const fmtDate = d => new Intl.DateTimeFormat(lang(), { dateStyle: 'medium' }).format(new Date(d));
const minor = p => D.MINOR_AGES.includes(p.age_range);

function reqErr(error) {
  if (error?.code === '23505') return 'req.err_dup';
  if (error?.code === '42501') return 'req.err_unavailable';
  return 'err.generic';
}

async function ensureMe(s) {
  session = s;
  const mine = await loadMine(s);
  me = mine.pub;
  if (!me) { goTo('edit'); return false; }
  return true;
}

/* ================= RECHERCHE ================= */
function opt(v, l) { const o = document.createElement('option'); o.value = v; o.textContent = l; return o; }
function fill(sel, items, anyLabel) {
  const cur = sel.value;
  sel.replaceChildren(opt('', anyLabel));
  for (const [v, l] of items) sel.append(opt(v, l));
  sel.value = cur;
}

function buildFilters(f) {
  const any = t('search.any');
  const coll = new Intl.Collator(lang());
  fill(f.age_range, D.AGE_RANGES.filter(a => minor(me) === D.MINOR_AGES.includes(a)).map(a => [a, t('age.' + a)]), any);
  fill(f.level, D.LEVELS.map(l => [l, t('level.' + l)]), any);
  fill(f.riwaya, D.RIWAYAT.map(r => [r, t('riwaya.' + r)]), any);
  fill(f.hizb_min, [5, 10, 15, 20, 30, 40, 50, 60].map(n => [String(n), t('search.hizb_n', { n })]), any);
  fill(f.contact_mode, [['online', t('contact.online')], ['in_person', t('contact.in_person')]], any);
  fill(f.availability, ['morning', 'afternoon', 'evening'].map(a => [a, t('avail.' + a)]), any);
  fill(f.country, D.COUNTRIES.map(c => [c, countryName(c)]).sort((a, b) => coll.compare(a[1], b[1])), any);
  fill(f.language, D.LANGUAGES.filter(l => l !== 'other').map(l => [l, languageName(l)]).sort((a, b) => coll.compare(a[1], b[1])), any);
  fill(f.status, D.STATUSES.map(s => [s, t('status.' + s)]), any);
  if (!f.dataset.init) { f.status.value = 'searching'; f.dataset.init = '1'; }
}

async function runSearch(reset) {
  const f = $('#form-search');
  const list = $('#results'), more = $('#btn-more'), count = $('#search-count');
  const seq = ++searchSeq;
  if (reset) { page = 0; list.replaceChildren(); }
  busy(f, true); more.hidden = true;

  let q = sb.from('profiles').select(COLS, { count: 'exact' })
    .neq('id', me.id).eq('is_paused', false).or('badge.is.null,badge.neq.banned');
  q = q.eq('gender', me.gender);   // même genre obligatoire (aussi verrouillé dans la base)
  if (f.age_range.value) q = q.eq('age_range', f.age_range.value);
  if (f.level.value) q = q.eq('level', f.level.value);
  if (f.riwaya.value) q = q.eq('riwaya', f.riwaya.value);
  if (f.hizb_min.value) q = q.gte('hizb_memorized', Number(f.hizb_min.value));
  if (f.contact_mode.value) q = q.in('contact_mode', [f.contact_mode.value, 'both']);
  if (f.availability.value) q = q.overlaps('availability', [f.availability.value, 'flexible']);
  if (f.country.value) q = q.eq('country', f.country.value);
  if (f.language.value) q = q.contains('languages', [f.language.value]);
  if (f.status.value) q = q.eq('status', f.status.value);
  q = q.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);

  const { data, error, count: total } = await q;
  if (seq !== searchSeq) return;   // une recherche plus récente a été lancée
  busy(f, false);
  if (error) { console.warn(error); count.textContent = t('err.generic'); count.hidden = false; return; }
  searchedLang = lang();
  count.textContent = total ? t('search.count', { n: total.toLocaleString(lang()) }) : t('search.none');
  count.hidden = false;
  for (const p of data) list.append(memberRow(p, '#/member?id=' + p.id));
  decorateRows(list);
  page++;
  more.hidden = !(total > page * PAGE);
}

export async function showSearch(s) {
  if (!(await ensureMe(s))) return;
  const f = $('#form-search');
  buildFilters(f);
  if (searchedLang !== lang() || (!$('#results').children.length && !searchSeq)) runSearch(true);
}

/* ================= FICHE MEMBRE ================= */
function waLink(number, text) {
  return 'https://wa.me/' + String(number).replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
}

async function latestRequest(otherId) {
  const uid = me.id;
  const { data, error } = await sb.from('requests').select('*')
    .or(`and(sender_id.eq.${uid},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${uid})`)
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data[0] || null;
}

async function renderRelation(p) {
  const zone = $('#m-relation');
  const card = $('#member-card');
  const seq = ++relSeq;
  zone.replaceChildren(el('p', 'muted', t('common.loading')));
  let r;
  try { r = await latestRequest(p.id); }
  catch (e) { if (seq === relSeq) { zone.replaceChildren(); showMsg(card, 'err.generic'); } return; }
  if (seq !== relSeq) return;
  zone.replaceChildren();
  const iSent = r && r.sender_id === me.id;
  renderMemberTrust(p, me, r?.status === 'accepted', () => {
    searchedLang = null; $('#results').replaceChildren(); searchSeq = 0;
    goTo('search');
  });

  // Aucune demande en cours : formulaire
  if (!r || r.status === 'declined' || r.status === 'cancelled') {
    if (r && r.status === 'declined' && iSent) zone.append(el('p', 'note', t('req.was_declined')));
    const form = el('form', 'req-form');
    form.noValidate = true;
    const lab = el('label');
    lab.append(el('span', null, t('req.message_label')));
    const ta = el('textarea');
    ta.name = 'message'; ta.maxLength = 500; ta.rows = 3; ta.dir = 'auto';
    ta.placeholder = t('req.message_ph');
    lab.append(ta);
    const btn = el('button', 'btn btn-gold', t('req.send'));
    btn.type = 'submit';
    form.append(el('h3', null, t('req.send_title')), lab, btn);
    if (minor(me)) form.insertBefore(el('p', 'note', t('req.minor_note')), btn);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      busy(form, true);
      const { error } = await sb.from('requests').insert({ sender_id: me.id, receiver_id: p.id, message: ta.value.trim() || null });
      busy(form, false);
      if (error) { console.warn(error); return showMsg(card, reqErr(error)); }
      showMsg(card, 'req.sent_ok', 'ok');
      renderRelation(p);
    });
    zone.append(form);
    return;
  }

  // En attente
  if (r.status === 'pending') {
    if (iSent) {
      zone.append(el('p', 'state', t('req.pending_out', { date: fmtDate(r.created_at) })));
      const c = el('button', 'btn btn-line', t('req.cancel'));
      c.type = 'button';
      c.addEventListener('click', () => answer(r.id, 'cancelled', () => renderRelation(p)));
      zone.append(c);
    } else {
      zone.append(el('p', 'state', t('req.pending_in', { name: p.first_name })));
      if (r.message) { const q = el('blockquote', 'req-msg', r.message); q.dir = 'auto'; zone.append(q); }
      const row = el('div', 'p-actions');
      const a = el('button', 'btn btn-gold', t('req.accept')); a.type = 'button';
      const d = el('button', 'btn btn-line', t('req.decline')); d.type = 'button';
      a.addEventListener('click', () => answer(r.id, 'accepted', () => renderRelation(p)));
      d.addEventListener('click', () => answer(r.id, 'declined', () => renderRelation(p)));
      row.append(a, d);
      zone.append(row);
    }
    return;
  }

  // Acceptée : WhatsApp
  if (r.status === 'accepted') {
    zone.append(el('p', 'state ok', t('req.accepted_line', { date: fmtDate(r.responded_at || r.created_at) })));
    const { data: priv } = await sb.from('profiles_private')
      .select('whatsapp, guardian_name, guardian_whatsapp').eq('id', p.id).maybeSingle();
    if (seq !== relSeq) return;
    const theyMinor = minor(p);
    const number = theyMinor ? priv?.guardian_whatsapp : priv?.whatsapp;
    if (number) {
      const text = theyMinor
        ? t('wa.minor', { name: p.first_name, me: me.first_name })
        : t('wa.adult', { name: p.first_name, me: me.first_name });
      const a = el('a', 'btn btn-wa', theyMinor ? t('req.wa_guardian', { name: priv.guardian_name || '' }) : t('req.wa'));
      a.href = waLink(number, text);
      a.target = '_blank'; a.rel = 'noopener';
      zone.append(a);
    } else {
      zone.append(el('p', 'muted', t('req.no_wa')));
    }
    if (iSent) {
      const c = el('button', 'link', t('req.end'));
      c.type = 'button';
      c.addEventListener('click', () => {
        if (confirm(t('req.end_confirm'))) answer(r.id, 'cancelled', () => renderRelation(p));
      });
      zone.append(c);
    }
  }
}

async function answer(id, status, then) {
  const { error } = await sb.from('requests').update({ status }).eq('id', id);
  if (error) { console.warn(error); alert(t('err.generic')); return; }
  refreshCount(true);
  then && then();
}

export async function showMember(s) {
  if (!(await ensureMe(s))) return;
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  const card = $('#member-card'), loading = $('#member-loading');
  card.hidden = true; loading.hidden = false; loading.textContent = t('common.loading');
  if (!id || !UUID_RE.test(id)) { loading.textContent = t('member.unavailable'); return; }
  if (id === me.id) { goTo('profile'); return; }
  const seq = ++memSeq;
  const { data: p, error } = await sb.from('profiles').select(COLS).eq('id', id).maybeSingle();
  if (seq !== memSeq) return;
  if (error || !p) { loading.textContent = t('member.unavailable'); return; }
  loading.hidden = true;
  $('#m-public').replaceChildren(profileCard(p));
  card.dataset.gender = p.gender;
  card.hidden = false;
  renderRelation(p);
}

/* ================= MES DEMANDES ================= */
const STATUS_CLASS = { pending: 'tag-pending', accepted: 'badge-reliable', declined: 'tag-pause', cancelled: 'tag-pause' };

async function renderRequests() {
  const list = $('#req-list'), loading = $('#req-loading');
  const seq = ++reqSeq;
  list.replaceChildren(); loading.hidden = false; loading.textContent = t('common.loading');
  $$('#seg-req button').forEach(b => b.classList.toggle('on', b.dataset.box === box));
  const col = box === 'in' ? 'receiver_id' : 'sender_id';
  const { data: reqs, error } = await sb.from('requests').select('*').eq(col, me.id)
    .order('created_at', { ascending: false }).limit(100);
  if (error) { loading.textContent = t('err.generic'); return; }
  const ids = [...new Set(reqs.map(r => (box === 'in' ? r.sender_id : r.receiver_id)))];
  let profs = [];
  if (ids.length) {
    const res = await sb.from('profiles').select(COLS).in('id', ids);
    profs = res.data || [];
  }
  if (seq !== reqSeq) return;
  const byId = Object.fromEntries(profs.map(p => [p.id, p]));
  loading.hidden = true;
  if (!reqs.length) { list.append(el('p', 'muted center', t(box === 'in' ? 'req.empty_in' : 'req.empty_out'))); return; }

  for (const r of reqs) {
    const other = byId[box === 'in' ? r.sender_id : r.receiver_id];
    const item = el('div', 'req-item' + (['declined', 'cancelled'].includes(r.status) ? ' faded' : ''));
    const head = el('div', 'req-head');
    if (other) {
      const a = el('a', 'req-who');
      a.href = '#/member?id=' + other.id;
      a.append(avatarEl(other.avatar, other.gender, other.first_name, 40), el('b', null, other.first_name));
      head.append(a);
    } else {
      head.append(el('span', 'req-who muted', t('member.unavailable_short')));
    }
    head.append(el('span', 'tag ' + STATUS_CLASS[r.status], t('req.st_' + r.status)));
    item.append(head, el('small', 'muted', fmtDate(r.created_at)));
    if (r.message) { const q = el('blockquote', 'req-msg', r.message); q.dir = 'auto'; item.append(q); }

    const actions = el('div', 'p-actions');
    if (r.status === 'pending' && box === 'in') {
      const a = el('button', 'btn btn-gold btn-sm', t('req.accept')); a.type = 'button';
      const d = el('button', 'btn btn-line btn-sm', t('req.decline')); d.type = 'button';
      a.addEventListener('click', () => answer(r.id, 'accepted', renderRequests));
      d.addEventListener('click', () => answer(r.id, 'declined', renderRequests));
      actions.append(a, d);
    } else if (r.status === 'pending' && box === 'out') {
      const c = el('button', 'btn btn-line btn-sm', t('req.cancel')); c.type = 'button';
      c.addEventListener('click', () => answer(r.id, 'cancelled', renderRequests));
      actions.append(c);
    } else if (r.status === 'accepted' && other) {
      const a = el('a', 'btn btn-wa btn-sm', t('req.contact'));
      a.href = '#/member?id=' + other.id;
      actions.append(a);
    }
    if (actions.children.length) item.append(actions);
    list.append(item);
  }
}

export async function showRequests(s) {
  if (!(await ensureMe(s))) return;
  renderRequests();
  refreshCount(true);
}

/* ---------- Compteur de demandes reçues ---------- */
let lastCheck = 0;
export async function refreshCount(force, sess) {
  const s = sess || session || (await sb.auth.getSession()).data.session;
  if (!s) return;
  if (!force && Date.now() - lastCheck < 30000) return;
  lastCheck = Date.now();
  const { count } = await sb.from('requests').select('id', { count: 'exact', head: true })
    .eq('receiver_id', s.user.id).eq('status', 'pending');
  lastCount = count || 0;
  for (const id of ['#tab-count', '#count-in']) {
    const b = $(id);
    b.textContent = lastCount > 9 ? '9+' : String(lastCount);
    b.hidden = !lastCount;
  }
}

export function resetMatch() { me = null; session = null; page = 0; searchedLang = null; searchSeq = 0; $('#results').replaceChildren(); lastCheck = 0; }

/* ---------- Liaisons ---------- */
export function bindMatch(go) {
  goTo = go;
  const f = $('#form-search');
  f.addEventListener('submit', e => { e.preventDefault(); runSearch(true); });
  $('#btn-more').addEventListener('click', () => runSearch(false));
  $('#btn-filters').addEventListener('click', e => {
    const more = $('#filters-more');
    more.hidden = !more.hidden;
    e.target.setAttribute('aria-expanded', String(!more.hidden));
  });
  $('#btn-reset-filters').addEventListener('click', () => {
    $$('select', f).forEach(s => { s.value = ''; });
    f.status.value = 'searching';
    runSearch(true);
  });
  $$('#seg-req button').forEach(b => b.addEventListener('click', () => { box = b.dataset.box; renderRequests(); }));
}
