// Espace administrateur : signalements, membres, avis, statistiques.
// Toutes les protections sont dans la base (RLS + fonctions réservées à l'admin) ;
// cet écran ne fait qu'afficher ce que la base accepte de donner.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $, $$, showMsg } from './ui.js';
import * as D from './data.js';
import { el, profileCard, countryName, place, languageName } from './card.js';
import { avatarEl } from './avatar.js';
import { starsEl, loadRatings } from './trust.js';

const COLS = 'id, first_name, gender, country, city, age_range, languages, level, riwaya, surah_from, surah_to, hizb_memorized, availability, contact_mode, status, badge, avatar, is_paused, created_at, assiduity, assiduity_rate';
let isAdminUser = null;
let tab = 'reports';
let meId = null;
let seq = 0;

const fmtDate = d => new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
const fmtNum = n => Number(n || 0).toLocaleString(lang());
const btn = (cls, key, vars) => { const b = el('button', 'btn ' + cls, t(key, vars)); b.type = 'button'; return b; };

/* ---------- Suis-je admin ? ---------- */
export async function checkAdmin(session) {
  if (!session) { isAdminUser = false; toggleUi(); return false; }
  if (isAdminUser !== null && meId === session.user.id) return isAdminUser;
  meId = session.user.id;
  const { data } = await sb.from('admins').select('user_id').eq('user_id', meId).maybeSingle();
  isAdminUser = !!data;
  toggleUi();
  return isAdminUser;
}
function toggleUi() { $$('[data-admin]').forEach(e => { e.hidden = !isAdminUser; }); }
export function resetAdmin() { isAdminUser = null; meId = null; toggleUi(); }

async function profilesById(ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await sb.from('profiles').select(COLS).in('id', ids);
  return Object.fromEntries((data || []).map(p => [p.id, p]));
}

function who(p, onClick) {
  const a = el('button', 'req-who linkish'); a.type = 'button';
  if (!p) { a.textContent = t('admin.deleted'); a.disabled = true; return a; }
  a.append(avatarEl(p.avatar, p.gender, p.first_name, 32), el('b', null, p.first_name));
  if (p.badge) a.append(el('span', 'tag badge-' + p.badge, t('badge.' + p.badge)));
  a.addEventListener('click', () => onClick(p));
  return a;
}

/* ================= SIGNALEMENTS ================= */
async function renderReports(zone, my) {
  const filter = $('#adm-rep-filter').value;
  let q = sb.from('reports').select('*').order('created_at', { ascending: false }).limit(200);
  if (filter !== 'all') q = q.eq('status', filter);
  const { data: reps, error } = await q;
  if (my !== seq) return;
  if (error) { zone.replaceChildren(el('p', 'msg error', t('err.generic'))); return; }
  const people = await profilesById(reps.flatMap(r => [r.reporter_id, r.reported_id]));
  if (my !== seq) return;
  // Nombre de signalements par membre visé (sur la liste chargée)
  const perMember = {};
  for (const r of reps) if (r.reported_id) perMember[r.reported_id] = (perMember[r.reported_id] || 0) + 1;

  zone.replaceChildren();
  if (!reps.length) { zone.append(el('p', 'muted center', t('admin.no_reports'))); return; }
  for (const r of reps) {
    const item = el('div', 'req-item adm-item' + (r.status === 'open' ? ' open' : ' faded'));
    if (r.reason === 'inappropriate' && r.status === 'open') item.classList.add('urgent');
    const head = el('div', 'req-head');
    head.append(who(people[r.reported_id], openMember), el('span', 'tag ' + (r.status === 'open' ? 'tag-pending' : 'tag-pause'), t('admin.rs_' + r.status)));
    const meta = el('p', 'adm-meta');
    meta.append(el('b', null, t('reason.' + r.reason)), el('span', 'muted small', fmtDate(r.created_at)));
    if (perMember[r.reported_id] > 1) meta.append(el('span', 'tag badge-warning', t('admin.n_reports', { n: perMember[r.reported_id] })));
    const by = el('p', 'muted small');
    by.append(document.createTextNode(t('admin.reported_by') + ' '), who(people[r.reporter_id], openMember));
    item.append(head, meta);
    if (r.details) { const q2 = el('blockquote', 'req-msg', r.details); q2.dir = 'auto'; item.append(q2); }
    item.append(by);

    const note = el('textarea'); note.rows = 2; note.dir = 'auto'; note.placeholder = t('admin.note_ph'); note.value = r.admin_note || '';
    item.append(note);
    const actions = el('div', 'p-actions');
    const save = async (status, badge) => {
      if (badge === 'banned' && !confirm(t('admin.ban_confirm', { name: people[r.reported_id]?.first_name || '' }))) return;
      if (badge) {
        const res = await sb.rpc('set_badge', { p_member: r.reported_id, p_badge: badge });
        if (res.error) { console.warn(res.error); return alert(t('err.generic')); }
      }
      const { error: e2 } = await sb.from('reports').update({
        status, admin_note: note.value.trim() || null, reviewed_by: meId, reviewed_at: new Date().toISOString()
      }).eq('id', r.id);
      if (e2) { console.warn(e2); return alert(t('err.generic')); }
      showAdmin();
    };
    const bWarn = btn('btn-line btn-sm', 'admin.act_warn'); bWarn.addEventListener('click', () => save('actioned', 'warning'));
    const bBan = btn('btn-danger btn-sm', 'admin.act_ban'); bBan.addEventListener('click', () => save('actioned', 'banned'));
    const bDis = btn('btn-line btn-sm', 'admin.act_dismiss'); bDis.addEventListener('click', () => save('dismissed'));
    const bNote = btn('btn-line btn-sm', 'admin.act_note'); bNote.addEventListener('click', () => save(r.status === 'open' ? 'reviewed' : r.status));
    if (r.reported_id) actions.append(bWarn, bBan);
    actions.append(bDis, bNote);
    item.append(actions);
    if (r.reviewed_at) item.append(el('small', 'muted', t('admin.reviewed_on', { date: fmtDate(r.reviewed_at) })));
    zone.append(item);
  }
}

/* ================= MEMBRES ================= */
async function renderMembers(zone, my) {
  const name = $('#adm-q').value.trim();
  const badge = $('#adm-badge').value;
  let q = sb.from('profiles').select(COLS, { count: 'exact' }).order('created_at', { ascending: false }).limit(50);
  if (name) q = q.ilike('first_name', '%' + name.replace(/[%_\\]/g, m => '\\' + m) + '%');
  if (badge === 'none') q = q.is('badge', null);
  else if (badge) q = q.eq('badge', badge);
  const { data, error, count } = await q;
  if (my !== seq) return;
  zone.replaceChildren();
  if (error) { zone.append(el('p', 'msg error', t('err.generic'))); return; }
  zone.append(el('p', 'muted center', t('search.count', { n: fmtNum(count) })));
  const list = el('div', 'results');
  for (const p of data) {
    const row = el('button', 'm-row adm-row'); row.type = 'button';
    row.dataset.gender = p.gender;
    const info = el('div', 'm-info');
    const top = el('div', 'm-top'); top.append(el('b', null, p.first_name));
    if (p.badge) top.append(el('span', 'tag badge-' + p.badge, t('badge.' + p.badge)));
    if (p.is_paused) top.append(el('span', 'tag tag-pause', t('profile.paused_tag')));
    if (D.MINOR_AGES.includes(p.age_range)) top.append(el('span', 'tag tag-pending', t('admin.minor')));
    info.append(top, el('small', 'muted', place(p)), el('small', 'm-meta', t('admin.joined', { date: fmtDate(p.created_at) })));
    row.append(avatarEl(p.avatar, p.gender, p.first_name, 44), info);
    row.addEventListener('click', () => openMember(p));
    list.append(row);
  }
  zone.append(list);
}

async function openMember(p) {
  const dlg = $('#adm-dialog');
  const body = $('#adm-dialog-body');
  body.replaceChildren(el('p', 'muted', t('common.loading')));
  if (!dlg.open) dlg.showModal();

  const [{ data: priv }, ratings, { count: nRep }] = await Promise.all([
    sb.from('profiles_private').select('whatsapp, guardian_name, guardian_whatsapp').eq('id', p.id).maybeSingle(),
    loadRatings([p.id]),
    sb.from('reports').select('id', { count: 'exact', head: true }).eq('reported_id', p.id)
  ]);
  body.replaceChildren();
  const card = el('div', 'profile'); card.dataset.gender = p.gender;
  card.append(profileCard(p));
  const r = ratings[p.id];
  card.querySelector('.p-tags')?.append(starsEl(r?.avg_rating || 0, Number(r?.total || 0)));

  // Coordonnées privées (admin uniquement)
  const minor = D.MINOR_AGES.includes(p.age_range);
  const box = el('div', 'p-private');
  box.append(el('span', 'lock', '🔒'));
  const inner = el('div');
  const number = minor ? priv?.guardian_whatsapp : priv?.whatsapp;
  inner.append(el('b', null, number || '—'),
    el('small', 'muted', minor ? t('admin.guardian', { name: priv?.guardian_name || '—' }) : t('admin.private_wa')));
  box.append(inner);
  if (number) {
    const wa = el('a', 'btn btn-wa btn-sm', t('admin.contact_wa'));
    wa.href = 'https://wa.me/' + number.replace(/\D/g, '') + '?text=' + encodeURIComponent(t('admin.wa_text', { name: minor ? (priv?.guardian_name || '') : p.first_name }));
    wa.target = '_blank'; wa.rel = 'noopener';
    box.append(wa);
  }
  card.append(box);
  card.append(el('p', 'muted small', t('admin.member_info', { date: fmtDate(p.created_at), n: fmtNum(nRep) })));

  // Badge
  const bz = el('div', 'adm-badges');
  bz.append(el('span', 'ctl-label', t('admin.badge')));
  const seg = el('div', 'seg');
  for (const b of [null, 'reliable', 'warning', 'banned']) {
    const x = el('button', p.badge === b ? 'on' : '', b ? t('badge.' + b) : t('admin.no_badge')); x.type = 'button';
    x.addEventListener('click', async () => {
      if (p.badge === b) return;
      if (b === 'banned' && !confirm(t('admin.ban_confirm', { name: p.first_name }))) return;
      const { error } = await sb.rpc('set_badge', { p_member: p.id, p_badge: b });
      if (error) { console.warn(error); return alert(t('err.generic')); }
      p.badge = b;
      openMember(p);
      showAdmin();
    });
    seg.append(x);
  }
  bz.append(seg);
  card.append(bz);
  body.append(card);
}

/* ================= AVIS ================= */
async function renderReviews(zone, my) {
  const { data: revs, error } = await sb.from('reviews').select('*').order('created_at', { ascending: false }).limit(200);
  if (my !== seq) return;
  if (error) { zone.replaceChildren(el('p', 'msg error', t('err.generic'))); return; }
  const people = await profilesById(revs.flatMap(r => [r.author_id, r.target_id]));
  if (my !== seq) return;
  zone.replaceChildren();
  if (!revs.length) { zone.append(el('p', 'muted center', t('admin.no_reviews'))); return; }
  for (const r of revs) {
    const item = el('div', 'req-item adm-item');
    const head = el('div', 'req-head');
    const pair = el('div', 'adm-pair');
    pair.append(who(people[r.author_id], openMember), el('span', 'muted', lang() === 'ar' ? '←' : '→'), who(people[r.target_id], openMember));
    head.append(pair, el('span', 'stars-ico', '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)));
    item.append(head, el('small', 'muted', fmtDate(r.created_at) + (r.hidden_by_target ? ' · ' + t('admin.hidden_by_target') : '')));
    if (r.comment) { const q = el('p', 'rev-text', r.comment); q.dir = 'auto'; item.append(q); }
    const del = btn('btn-line btn-sm', 'admin.delete_review');
    del.addEventListener('click', async () => {
      if (!confirm(t('admin.delete_review_confirm'))) return;
      const { error: e2 } = await sb.from('reviews').delete().eq('id', r.id);
      if (e2) { console.warn(e2); return alert(t('err.generic')); }
      showAdmin();
    });
    const a = el('div', 'p-actions'); a.append(del); item.append(a);
    zone.append(item);
  }
}

/* ================= STATISTIQUES ================= */
function tile(label, value, note) {
  const d = el('div', 'stat-tile');
  d.append(el('strong', null, fmtNum(value)), el('span', null, label));
  if (note) d.append(el('small', 'muted', note));
  return d;
}

// Barres horizontales : une seule teinte (magnitude), valeur écrite à côté de chaque barre.
function bars(title, entries, labelOf) {
  const sec = el('section', 'stat-block');
  sec.append(el('h3', null, title));
  if (!entries.length) { sec.append(el('p', 'muted', '—')); return sec; }
  const max = Math.max(...entries.map(e => e[1]));
  const total = entries.reduce((s, e) => s + e[1], 0);
  const list = el('div', 'hbars');
  for (const [k, n] of entries) {
    const row = el('div', 'hbar');
    row.title = `${labelOf(k)} : ${fmtNum(n)} (${Math.round((n / total) * 100)} %)`;
    const track = el('div', 'hbar-track');
    const fill = el('div', 'hbar-fill');
    fill.style.width = Math.max(2, (n / max) * 100) + '%';
    track.append(fill);
    row.append(el('span', 'hbar-label', labelOf(k)), track, el('span', 'hbar-val', fmtNum(n)));
    list.append(row);
  }
  sec.append(list);
  return sec;
}

// Colonnes dans le temps (inscriptions)
function columns(title, entries, labelOf) {
  const sec = el('section', 'stat-block');
  sec.append(el('h3', null, title));
  if (!entries.length) { sec.append(el('p', 'muted', '—')); return sec; }
  const max = Math.max(...entries.map(e => e[1]), 1);
  const wrap = el('div', 'vbars');
  for (const [k, n] of entries) {
    const col = el('div', 'vbar');
    col.title = `${labelOf(k)} : ${fmtNum(n)}`;
    const area = el('div', 'vbar-area');
    const fill = el('div', 'vbar-fill'); fill.style.height = Math.max(2, (n / max) * 100) + '%';
    area.append(el('span', 'vbar-val', fmtNum(n)), fill);
    col.append(area, el('span', 'vbar-label', labelOf(k)));
    wrap.append(col);
  }
  sec.append(wrap);
  return sec;
}

const sorted = (obj, order) => {
  const e = Object.entries(obj || {});
  return order ? order.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]) : e.sort((a, b) => b[1] - a[1]);
};

async function renderStats(zone, my) {
  const { data: s, error } = await sb.rpc('admin_stats');
  if (my !== seq) return;
  zone.replaceChildren();
  if (error) { console.warn(error); zone.append(el('p', 'msg error', t('err.generic'))); return; }
  const tiles = el('div', 'stat-tiles');
  tiles.append(
    tile(t('admin.s_total'), s.total),
    tile(t('admin.s_searching'), s.searching),
    tile(t('admin.s_paused'), s.paused),
    tile(t('admin.s_minors'), s.minors),
    tile(t('admin.s_banned'), s.banned),
    tile(t('admin.s_req_accepted'), s.req_accepted, t('admin.s_req_pending', { n: fmtNum(s.req_pending) })),
    tile(t('admin.s_rep_open'), s.rep_open, t('admin.s_rep_total', { n: fmtNum(s.rep_total) }))
  );
  zone.append(tiles);

  const shortDate = k => new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'short' }).format(new Date(k + 'T00:00:00'));
  const shortMonth = k => new Intl.DateTimeFormat(lang(), { month: 'short', year: '2-digit' }).format(new Date(k + '-01T00:00:00'));
  const grid = el('div', 'stat-grid');
  grid.append(
    columns(t('admin.s_weekly'), s.weekly || [], shortDate),
    columns(t('admin.s_monthly'), s.monthly || [], shortMonth),
    bars(t('edit.country'), sorted(s.by_country).slice(0, 15), countryName),
    bars(t('admin.s_city'), (s.by_city || []).map(([c, k, n]) => [c + ' · ' + k, n]), x => x),
    bars(t('edit.gender'), sorted(s.by_gender, D.GENDERS), k => t('gender.' + k)),
    bars(t('edit.age_range'), sorted(s.by_age, D.AGE_RANGES), k => t('age.' + k)),
    bars(t('edit.level'), sorted(s.by_level, D.LEVELS), k => t('level.' + k)),
    bars(t('edit.riwaya'), sorted(s.by_riwaya, D.RIWAYAT), k => t('riwaya.' + k)),
    bars(t('admin.s_hizb'), sorted(s.by_hizb, ['0', '1-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60']), k => t('admin.hizb_range', { r: k }))
  );
  zone.append(grid);

  // Application installée
  const { data: ap } = await sb.rpc('admin_app_stats');
  if (my !== seq) return;
  if (ap) {
    zone.append(el('h3', 'stat-sec', t('admin.a_title')));
    const at = el('div', 'stat-tiles');
    at.append(
      tile(t('admin.a_installs'), ap.installs, t('admin.sh_week', { n: fmtNum(ap.week) })),
      tile(t('admin.a_active'), ap.active30),
      tile(t('admin.a_inactive'), ap.inactive30, t('admin.a_inactive_note')),
      tile(t('admin.a_members'), ap.members)
    );
    zone.append(at);
    const ag = el('div', 'stat-grid');
    ag.append(
      columns(t('admin.a_weekly'), ap.weekly || [], shortDate),
      columns(t('admin.a_monthly'), ap.monthly || [], shortMonth),
      bars(t('admin.a_platform'), sorted(ap.by_platform, ['android', 'ios', 'desktop', 'other']), k => t('admin.p_' + k))
    );
    zone.append(ag);
  }

  // Programmes de révision (totaux seulement)
  const { data: rv } = await sb.rpc('admin_revision_stats');
  if (my !== seq) return;
  if (rv) {
    zone.append(el('h3', 'stat-sec', t('admin.r_title')));
    const rt = el('div', 'stat-tiles');
    rt.append(
      tile(t('admin.r_plans'), rv.plans),
      tile(t('admin.r_done'), rv.done, rv.rate30 !== null ? t('admin.r_rate', { p: fmtNum(rv.rate30) }) : null),
      tile(t('admin.r_missed'), rv.missed),
      tile(t('admin.r_active'), rv.active7, t('admin.r_active30', { n: fmtNum(rv.active30) }))
    );
    zone.append(rt);
    const dayLbl = k => new Intl.DateTimeFormat(lang(), { day: 'numeric' }).format(new Date(k + 'T00:00:00'));
    const rg = el('div', 'stat-grid');
    rg.append(
      columns(t('admin.r_daily'), (rv.daily || []).map(([d, , k]) => [d, k]), dayLbl),
      columns(t('admin.r_weekly'), (rv.weekly || []).map(([w, n]) => [w, n]), shortDate),
      columns(t('admin.r_monthly'), (rv.monthly || []).map(([m, , k]) => [m, k]), shortMonth),
      bars(t('admin.r_unit'), sorted(rv.by_unit, ['hizb', 'nisf', 'rub', 'thumn', 'surah', 'page']), k => t('plan.u_' + k)),
      bars(t('admin.r_assid'), sorted(rv.by_assiduity, ['top', 'good', 'low', 'new']), k => t('assid.' + k + '_m'))
    );
    zone.append(rg);
  }

  // Départs (comptes supprimés, anonymes)
  const { data: d, error: e2 } = await sb.rpc('admin_departure_stats');
  if (my !== seq || e2 || !d) return;
  zone.append(el('h3', 'stat-sec', t('admin.d_title')));
  const dt = el('div', 'stat-tiles');
  dt.append(
    tile(t('admin.d_total'), d.total, t('admin.sh_week', { n: fmtNum(d.week) })),
    tile(t('admin.d_avg'), d.avg_days),
    tile(t('admin.d_partner'), d.had_partner)
  );
  zone.append(dt);
  const REASONS_ORDER = ['found_partner', 'no_time', 'no_match', 'not_useful', 'privacy', 'other', 'none'];
  const dg = el('div', 'stat-grid');
  dg.append(
    columns(t('admin.d_weekly'), d.weekly || [], shortDate),
    columns(t('admin.d_monthly'), d.monthly || [], shortMonth),
    bars(t('admin.d_reason'), sorted(d.by_reason, REASONS_ORDER), k => k === 'none' ? t('admin.d_none') : t('leave.' + k)),
    bars(t('edit.country'), sorted(d.by_country).slice(0, 15), countryName),
    bars(t('edit.gender'), sorted(d.by_gender, D.GENDERS), k => t('gender.' + k)),
    bars(t('edit.age_range'), sorted(d.by_age, D.AGE_RANGES), k => t('age.' + k))
  );
  zone.append(dg);
}

/* ================= PARTAGES ET PARRAINAGE ================= */
async function renderShares(zone, my) {
  const { data: s, error } = await sb.rpc('admin_share_stats');
  if (my !== seq) return;
  zone.replaceChildren();
  if (error) { console.warn(error); zone.append(el('p', 'msg error', t('err.generic'))); return; }
  const rate = s.visits ? Math.round((s.signups / s.visits) * 100) : 0;
  const tiles = el('div', 'stat-tiles');
  tiles.append(
    tile(t('admin.sh_shares'), s.shares, t('admin.sh_week', { n: fmtNum(s.shares_week) })),
    tile(t('admin.sh_sharers'), s.sharers),
    tile(t('admin.sh_visits'), s.visits),
    tile(t('admin.sh_signups'), s.signups, t('admin.sh_rate', { p: rate }) + ' · ' + t('admin.sh_week', { n: fmtNum(s.signups_week) }))
  );
  zone.append(tiles, el('p', 'muted small', t('admin.sh_hint')));

  // Classement des ambassadeurs
  const top = el('section', 'stat-block');
  top.append(el('h3', null, t('admin.sh_top')));
  if (!s.top?.length) top.append(el('p', 'muted', '—'));
  else {
    const head = el('div', 'rank-row rank-head');
    head.append(el('span', null, '#'), el('span', null, ''), el('span', null, t('admin.sh_c_shares')), el('span', null, t('admin.sh_c_visits')), el('span', null, t('admin.sh_c_signups')));
    top.append(head);
    s.top.forEach((p, i) => {
      const row = el('div', 'rank-row');
      const cell = el('div', 'rank-who');
      cell.append(who(p, async x => { const m = (await profilesById([x.id]))[x.id]; if (m) openMember(m); }));
      const pl = [p.city, p.country ? countryName(p.country) : ''].filter(Boolean).join(lang() === 'ar' ? '، ' : ', ');
      if (pl) cell.append(el('small', 'muted', pl));
      row.append(el('b', 'rank-n', String(i + 1)), cell, el('span', null, fmtNum(p.shares)), el('span', null, fmtNum(p.visits)), el('b', 'rank-sign', fmtNum(p.signups)));
      top.append(row);
    });
  }
  zone.append(top);

  const shortDate = k => new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'short' }).format(new Date(k + 'T00:00:00'));
  const shortMonth = k => new Intl.DateTimeFormat(lang(), { month: 'short', year: '2-digit' }).format(new Date(k + '-01T00:00:00'));
  const grid = el('div', 'stat-grid');
  grid.append(
    columns(t('admin.sh_weekly'), s.weekly || [], shortDate),
    columns(t('admin.sh_monthly'), s.monthly || [], shortMonth),
    bars(t('edit.country'), sorted(s.by_country).slice(0, 15), countryName),
    bars(t('admin.s_city'), (s.by_city || []).map(([c, k, n]) => [c + ' · ' + k, n]), x => x),
    bars(t('admin.sh_lang'), sorted(s.by_lang), k => { const n = languageName(k); return n.charAt(0).toLocaleUpperCase(lang()) + n.slice(1); })
  );
  zone.append(grid);
}

/* ================= AFFICHAGE ================= */
export async function showAdmin(session) {
  const zone = $('#adm-content');
  if (session && !(await checkAdmin(session))) { zone.replaceChildren(el('p', 'msg error', t('admin.forbidden'))); return; }
  $$('#seg-admin button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('[data-adm-tools]').forEach(e => { e.hidden = e.dataset.admTools !== tab; });
  const my = ++seq;
  zone.replaceChildren(el('p', 'muted center', t('common.loading')));
  if (tab === 'reports') renderReports(zone, my);
  if (tab === 'members') renderMembers(zone, my);
  if (tab === 'reviews') renderReviews(zone, my);
  if (tab === 'stats') renderStats(zone, my);
  if (tab === 'shares') renderShares(zone, my);
  refreshAdminCount(true);
}

let lastCount = 0;
export async function refreshAdminCount(force) {
  if (!isAdminUser) return;
  if (!force && Date.now() - lastCount < 30000) return;
  lastCount = Date.now();
  const { count } = await sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open');
  for (const b of $$('.adm-count')) { b.textContent = count > 9 ? '9+' : String(count || 0); b.hidden = !count; }
}

export function bindAdmin() {
  $$('#seg-admin button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; showAdmin(); }));
  $('#adm-rep-filter').addEventListener('change', () => showAdmin());
  $('#adm-member-form').addEventListener('submit', e => { e.preventDefault(); showAdmin(); });
  $('#adm-badge').addEventListener('change', () => showAdmin());
  $('#adm-dialog-close').addEventListener('click', () => $('#adm-dialog').close());
  $('#adm-dialog').addEventListener('click', e => { if (e.target.id === 'adm-dialog') e.target.close(); });
}
