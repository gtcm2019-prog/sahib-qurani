// Inscription plein écran, une question par écran (style application).
// Étapes : accueil → connexion → prénom/genre → âge → pays/ville → langues/récitation
//          (installation de l'appli juste après la connexion) → niveau/hizb → disponibilités/contact → WhatsApp → accueil.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $, errKey, EMAIL_RE, pwOk } from './ui.js';
import * as D from './data.js';
import { el, countryName, languageName, fmtPct } from './card.js';
import { loadMine, resetProfileCache, normPhone } from './profile.js';
import { canInstall, installNow, isStandalone, isIPhone, hasPrompt } from './pwa.js';

const BASE = location.origin + location.pathname;
const STEPS = ['welcome', 'auth', 'install', 'name', 'age', 'place', 'lang', 'level', 'avail', 'wa'];
const PROFILE_STEPS = ['name', 'age', 'place', 'lang', 'level', 'avail', 'wa'];
const TOTAL = STEPS.length - 1;          // l'écran d'accueil n'est pas compté

let goTo = () => {};
let onLang = () => {};
let session = null;
let draft = {};
let owner = null;        // à qui appartient le brouillon en mémoire
let authMode = 'new';
let seq = 0;

/* ---------- Brouillon (sur l'appareil, sans le numéro) ---------- */
const dkey = () => 'sq_onb_' + (session?.user?.id || 'anon');
function loadDraft() {
  if (owner === dkey()) return;     // déjà en mémoire (changement de langue, retour…)
  owner = dkey();
  try { draft = JSON.parse(localStorage.getItem(dkey()) || '{}') || {}; } catch (e) { draft = {}; }
}
function saveDraft() {
  const { whatsapp, guardian_whatsapp, ...rest } = draft;
  try { localStorage.setItem(dkey(), JSON.stringify(rest)); } catch (e) { /* ignore */ }
}
function set(k, v) { draft[k] = v; saveDraft(); }

// Pays deviné depuis la langue du navigateur (fr-MA → MA). Jamais de GPS.
function guessCountry() {
  for (const p of navigator.languages || [navigator.language || '']) {
    const r = String(p).split('-')[1];
    if (r && D.COUNTRIES.includes(r.toUpperCase())) return r.toUpperCase();
  }
  return '';
}
function defaults() {
  if (!draft.languages) draft.languages = [lang()];
  if (draft.country === undefined) draft.country = guessCountry();
  if (draft.hizb_memorized === undefined) draft.hizb_memorized = 0;
  if (!draft.availability) draft.availability = [];
}

/* ---------- Validation ---------- */
const isMinor = () => D.MINOR_AGES.includes(draft.age_range);
function check(step) {
  const d = draft;
  switch (step) {
    case 'name': return !String(d.first_name || '').trim() ? 'onb.err_name' : !d.gender ? 'onb.err_gender' : null;
    case 'age': return d.age_range ? null : 'onb.err_choose';
    case 'place': return d.country ? null : 'onb.err_country';
    case 'lang': return !d.languages?.length ? 'onb.err_lang' : !d.riwaya ? 'onb.err_riwaya' : null;
    case 'level': return d.level ? null : 'onb.err_choose';
    case 'avail': return !d.availability?.length ? 'onb.err_avail' : !d.contact_mode ? 'onb.err_contact' : null;
    case 'wa': {
      if (isMinor()) {
        const w = normPhone(d.guardian_whatsapp);
        return !String(d.guardian_name || '').trim() || !w ? (w === false ? 'err.phone' : 'err.guardian') : null;
      }
      const w = normPhone(d.whatsapp);
      return w ? null : (w === false ? 'err.phone' : 'err.whatsapp');
    }
  }
  return null;
}
const firstMissing = () => PROFILE_STEPS.find(s => check(s)) || 'wa';

// L'installation est proposée une fois par appareil, juste après la connexion
const offerInstall = () => { try { return canInstall() && !localStorage.getItem('sq_inst_seen'); } catch (e) { return false; } };
const installSeen = () => { try { localStorage.setItem('sq_inst_seen', '1'); } catch (e) { /* ignore */ } };
let installed = false;   // installation acceptée pendant cet écran

/* ---------- Petits éléments ---------- */
function msg(key, type = 'error') {
  const box = $('#onb-msg');
  box.textContent = key ? t(key) : '';
  box.className = 'msg ' + type;
  box.hidden = !key;
}
function head(titleKey, subKey) {
  const h = el('div', 'onb-q');
  h.append(el('h1', null, t(titleKey)));
  if (subKey) h.append(el('p', 'muted', t(subKey)));
  return h;
}
function label(key) { return el('p', 'onb-label', t(key)); }

// Grandes cartes de choix (une seule valeur)
function options(name, items, value, onPick, cls = '') {
  const box = el('div', 'onb-opts ' + cls);
  box.setAttribute('role', 'radiogroup');
  for (const [v, text, extra] of items) {
    const lab = el('label', 'onb-opt');
    if (extra?.cls) lab.classList.add(extra.cls);
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = name; inp.value = v; inp.checked = v === value;
    inp.addEventListener('change', () => { onPick(v); msg(null); });
    const body = el('span', 'onb-opt-body');
    if (extra?.ico) body.append(el('span', 'onb-ico', extra.ico));
    const txt = el('span', 'onb-opt-txt');
    txt.append(el('b', null, text));
    if (extra?.sub) txt.append(el('small', null, extra.sub));
    body.append(txt, el('span', 'onb-tick', '✓'));
    lab.append(inp, body);
    box.append(lab);
  }
  return box;
}
// Pastilles (plusieurs valeurs)
function chips(name, items, values, onChange, wrap) {
  const box = el('div', 'chips onb-chips' + (wrap ? ' chips-wrap' : ''));
  for (const [v, text] of items) {
    const lab = el('label', 'chip');
    const inp = document.createElement('input');
    inp.type = 'checkbox'; inp.name = name; inp.value = v; inp.checked = values.includes(v);
    inp.addEventListener('change', () => {
      onChange([...box.querySelectorAll('input:checked')].map(i => i.value));
      msg(null);
    });
    lab.append(inp, el('span', null, text));
    box.append(lab);
  }
  return box;
}
function input(type, value, onInput, attrs = {}) {
  const i = document.createElement('input');
  i.type = type; i.value = value || '';
  for (const k in attrs) i.setAttribute(k, attrs[k]);
  i.addEventListener('input', () => { onInput(i.value); msg(null); });
  return i;
}
function field(key, control, hintKey) {
  const lab = el('label', 'onb-field');
  lab.append(el('span', null, t(key)), control);
  if (hintKey) lab.append(el('small', 'hint', t(hintKey)));
  return lab;
}
function langSeg() {
  const seg = el('div', 'lang-seg onb-lang');
  for (const [c, n] of [['ar', 'العربية'], ['fr', 'Français'], ['en', 'English'], ['es', 'Español']]) {
    const b = el('button');
    b.type = 'button'; b.title = n; b.setAttribute('aria-label', n);
    b.setAttribute('aria-pressed', String(c === lang()));
    const img = document.createElement('img');
    img.src = `icons/flags/${c}.svg`; img.alt = ''; img.width = 26; img.height = 18;
    b.append(img);
    b.addEventListener('click', () => { if (c !== lang()) onLang(c); });
    seg.append(b);
  }
  return seg;
}

/* ---------- Cercle de progression en direct ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
const CIRC = 2 * Math.PI * 50;
function liveRing() {
  const wrap = el('div', 'ring onb-ring');
  wrap.setAttribute('role', 'img');
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><linearGradient id="onb-rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E3C774"/><stop offset="1" stop-color="#C49A28"/></linearGradient></defs>';
  const track = document.createElementNS(SVGNS, 'circle');
  const bar = document.createElementNS(SVGNS, 'circle');
  for (const c of [track, bar]) { c.setAttribute('cx', 60); c.setAttribute('cy', 60); c.setAttribute('r', 50); }
  track.setAttribute('class', 'ring-track');
  bar.setAttribute('class', 'ring-bar');
  bar.setAttribute('stroke', 'url(#onb-rg)');
  bar.style.strokeDasharray = CIRC;
  bar.style.strokeDashoffset = CIRC;
  svg.append(track, bar);
  const txt = el('div', 'ring-text');
  const strong = el('strong'), small = el('small');
  txt.append(strong, small);
  wrap.append(svg, txt);
  wrap.update = n => {
    const pct = Math.round((n / D.HIZB_TOTAL) * 100);
    bar.style.strokeDashoffset = CIRC * (1 - pct / 100);
    strong.textContent = fmtPct(pct);
    small.textContent = t('profile.hizb_of', { n, total: D.HIZB_TOTAL });
    wrap.setAttribute('aria-label', t('profile.progress_aria', { p: pct }));
  };
  return wrap;
}

/* ---------- Écrans ---------- */
const collator = () => new Intl.Collator(lang());

const SCREENS = {
  welcome(body) {
    const w = el('div', 'onb-welcome');
    w.append(el('div', 'bismillah', 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'));
    const logo = el('div', 'onb-logo');
    const img = document.createElement('img');
    img.src = 'icons/icon-192.png'; img.alt = ''; img.width = 96; img.height = 96;
    logo.append(img);
    w.append(logo, el('h1', null, t('home.title')));
    const ar = el('p', 'onb-name-ar', 'الصاحب القرآني'); ar.lang = 'ar'; ar.dir = 'rtl';
    if (lang() !== 'ar') w.append(ar);
    const fig = el('figure', 'hadith-top onb-hadith');
    const hp = el('p', 'hadith-ar', '«خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ»'); hp.lang = 'ar'; hp.dir = 'rtl';
    fig.append(hp);
    if (t('hadith.text')) fig.append(el('p', 'hadith-tr', t('hadith.text')));
    fig.append(el('figcaption', null, t('hadith.src')));
    w.append(fig, el('p', 'lead', t('home.subtitle')), el('p', 'note-soft onb-intro', t('onb.intro')), langSeg());
    body.append(w);
  },

  auth(body) {
    body.append(head(authMode === 'new' ? 'onb.auth_title' : 'onb.login_title',
      isStandalone() && authMode === 'login' ? 'onb.relogin' : 'onb.auth_sub'));
    const g = el('button', 'btn btn-google');
    g.type = 'button';
    g.append(el('span', 'g', 'G'), el('span', null, t('auth.google')));
    g.addEventListener('click', async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: BASE } });
      if (error) msg(errKey(error));
    });
    const or = el('div', 'or'); or.append(el('span', null, t('auth.or')));
    const seg = el('div', 'seg seg-full');
    for (const m of ['new', 'login']) {
      const b = el('button', m === authMode ? 'on' : '', t(m === 'new' ? 'onb.mode_new' : 'onb.mode_login'));
      b.type = 'button';
      b.addEventListener('click', () => { if (authMode !== m) { authMode = m; render(); } });
      seg.append(b);
    }
    const f = document.createElement('form');
    f.id = 'onb-auth'; f.className = 'onb-auth'; f.noValidate = true;
    const email = input('email', draft._email, v => { draft._email = v; }, { dir: 'ltr', autocomplete: 'email', name: 'email' });
    const pw = input('password', '', () => {}, { dir: 'ltr', name: 'password', autocomplete: authMode === 'new' ? 'new-password' : 'current-password' });
    const pwBox = el('span', 'pw');
    const eye = el('button', 'pw-toggle', '👁'); eye.type = 'button'; eye.setAttribute('aria-label', '👁');
    eye.addEventListener('click', () => { pw.type = pw.type === 'password' ? 'text' : 'password'; });
    pwBox.append(pw, eye);
    f.append(field('auth.email', email), field('auth.password', pwBox, authMode === 'new' ? 'auth.pw_rule' : null));
    const links = el('p', 'links');
    if (authMode === 'login') {
      const a = el('a', null, t('auth.forgot_link')); a.href = '#/forgot';
      links.append(a);
    }
    const resend = el('button', 'link', t('auth.resend')); resend.type = 'button'; resend.hidden = true;
    resend.addEventListener('click', async () => {
      const { error } = await sb.auth.resend({ type: 'signup', email: email.value.trim(), options: { emailRedirectTo: BASE } });
      msg(error ? errKey(error) : 'auth.resent', error ? 'error' : 'ok');
    });
    links.append(resend);
    f.append(links);
    f.addEventListener('submit', e => { e.preventDefault(); next(); });
    body.append(g, or, seg, f);
  },

  name(body) {
    body.append(head('onb.name_title', 'onb.name_sub'));
    body.append(field('onb.pseudo', input('text', draft.first_name, v => set('first_name', v),
      { maxlength: 50, autocomplete: 'nickname', dir: 'auto', name: 'first_name' })));
    body.append(label('edit.gender'));
    body.append(options('gender', [
      ['m', t('gender.m'), { ico: '♂', cls: 'g-m' }],
      ['f', t('gender.f'), { ico: '♀', cls: 'g-f' }]
    ], draft.gender, v => set('gender', v), 'onb-opts-2'));
    body.append(el('p', 'note-soft', t('onb.gender_note')));
  },

  age(body) {
    body.append(head('onb.age_title', 'onb.age_sub'));
    body.append(options('age', D.AGE_RANGES.map(a => [a, t('age.' + a)]), draft.age_range,
      v => set('age_range', v), 'onb-opts-grid'));
  },

  place(body) {
    body.append(head('onb.place_title', 'onb.place_sub'));
    const sel = document.createElement('select');
    sel.name = 'country';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = t('edit.choose');
    sel.append(o0);
    D.COUNTRIES.map(c => [c, countryName(c)]).sort((a, b) => collator().compare(a[1], b[1]))
      .forEach(([c, n]) => { const o = document.createElement('option'); o.value = c; o.textContent = n; sel.append(o); });
    sel.value = draft.country || '';
    sel.addEventListener('change', () => { set('country', sel.value); msg(null); });
    body.append(field('edit.country', sel));
    body.append(field('edit.city', input('text', draft.city, v => set('city', v),
      { maxlength: 80, autocomplete: 'address-level2', dir: 'auto', name: 'city' })));
  },

  lang(body) {
    body.append(head('onb.lang_title', 'onb.multi'));
    const langs = D.LANGUAGES.filter(l => l !== 'other').map(l => [l, languageName(l)])
      .sort((a, b) => collator().compare(a[1], b[1]));
    langs.push(['other', languageName('other')]);
    // Langues déjà choisies en premier
    langs.sort((a, b) => draft.languages.includes(b[0]) - draft.languages.includes(a[0]));
    body.append(chips('languages', langs, draft.languages, v => set('languages', v), true));
    body.append(label('onb.riwaya_q'));
    body.append(options('riwaya', D.RIWAYAT.map(r => [r, t('riwaya.' + r)]), draft.riwaya,
      v => set('riwaya', v), 'onb-opts-2'));
  },

  level(body) {
    body.append(head('onb.level_title'));
    const ring = liveRing();
    const range = document.createElement('input');
    range.type = 'range'; range.min = 0; range.max = D.HIZB_TOTAL; range.step = 1;
    range.name = 'hizb_memorized'; range.value = draft.hizb_memorized;
    const out = el('output', null, String(draft.hizb_memorized));
    const setHizb = n => {
      range.value = n; out.textContent = String(n); ring.update(n); set('hizb_memorized', n);
    };
    body.append(options('level', D.LEVELS.map(l => [l, t('level.' + l)]), draft.level, v => {
      set('level', v);
      if (v === 'hafiz') setHizb(D.HIZB_TOTAL);
      else if (draft.hizb_memorized === D.HIZB_TOTAL) setHizb(59);
    }, 'onb-opts-grid'));
    body.append(label('onb.hizb_q'));
    range.addEventListener('input', () => setHizb(Number(range.value)));
    const row = el('div', 'hizb');
    row.append(range, out);
    const wrap = el('div', 'onb-hizb');
    wrap.append(ring, row);
    body.append(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => ring.update(draft.hizb_memorized)));
  },

  avail(body) {
    body.append(head('onb.avail_title', 'onb.multi'));
    body.append(chips('availability', D.AVAILABILITY.map(a => [a, t('avail.' + a)]), draft.availability,
      v => set('availability', v)));
    body.append(label('onb.contact_q'));
    const ico = { online: '💻', in_person: '🕌', both: '🔁' };
    body.append(options('contact', D.CONTACT_MODES.map(c => [c, t('contact.' + c), { ico: ico[c] }]),
      draft.contact_mode, v => set('contact_mode', v)));
  },

  wa(body) {
    const minor = isMinor();
    body.append(head(minor ? 'onb.guardian_title' : 'onb.wa_title', minor ? 'edit.guardian_note' : null));
    const tel = k => input('tel', draft[k], v => { draft[k] = v; },
      { dir: 'ltr', inputmode: 'tel', placeholder: '+212 6 12 34 56 78', autocomplete: 'tel', name: k });
    if (minor) {
      body.append(field('edit.guardian_name', input('text', draft.guardian_name, v => set('guardian_name', v), { maxlength: 80, dir: 'auto' })));
      body.append(field('edit.guardian_whatsapp', tel('guardian_whatsapp')));
    } else {
      body.append(field('edit.whatsapp', tel('whatsapp')));
    }
    const lock = el('div', 'p-private onb-lock');
    lock.append(el('span', 'lock', '🔒'), el('small', null, t('edit.whatsapp_hint')));
    body.append(lock);
  },

  install(body) {
    installSeen();
    const w = el('div', 'onb-welcome onb-install');
    const logo = el('div', 'onb-logo');
    const img = document.createElement('img');
    img.src = 'icons/icon-192.png'; img.alt = ''; img.width = 96; img.height = 96;
    logo.append(img);
    w.append(el('p', 'onb-done', t('onb.connected')), logo, el('h1', null, t('onb.install_title')), el('p', 'lead', t('onb.install_sub')));
    const note = el('p', 'note-soft onb-intro');
    if (installed) {
      note.textContent = t('onb.inst_done');
      w.append(note);
    } else {
      const b = el('button', 'btn btn-gold btn-block', t('pwa.install'));
      b.type = 'button';
      b.addEventListener('click', async () => {
        if (await installNow()) { installed = true; render(); return; }
        // Android sans bouton du navigateur : installation par le menu
        if (!isIPhone && !hasPrompt()) msg('onb.inst_menu', 'ok');
      });
      // iPhone : se reconnecter une fois dans l'application
      note.textContent = t(isIPhone ? 'onb.inst_ios' : 'onb.inst_android');
      w.append(b, note);
    }
    body.append(w);
  }
};

/* ---------- Navigation ---------- */
function stepFromHash() {
  const s = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  return STEPS.includes(s) ? s : null;
}
const goStep = s => goTo('start?s=' + s);

function finish() {
  try { localStorage.removeItem(dkey()); } catch (e) { /* ignore */ }
  draft = {}; owner = null;
  goTo('home');
}

let step = 'welcome';

function render() {
  const root = $('#onb');
  const i = STEPS.indexOf(step);
  const body = $('#onb-body');
  body.replaceChildren();
  body.className = 'onb-body onb-s-' + step;
  msg(null);
  SCREENS[step](body);
  // En-tête : retour + progression
  const showBar = i > 0;
  $('#onb-top').hidden = !showBar;
  $('#onb-fill').style.width = (i / TOTAL * 100) + '%';
  $('#onb-count').textContent = `${i}/${TOTAL}`;
  // Intitulé visible : « Étape 3 sur 9 · Âge »
  if (i > 0) body.prepend(el('p', 'onb-eyebrow', t('onb.step', { n: i, t: TOTAL }) + ' · ' + t('onb.n_' + step)));
  $('#onb-prog').setAttribute('aria-valuenow', String(i));
  $('#onb-prog').setAttribute('aria-valuemax', String(TOTAL));
  // Retour impossible vers la connexion une fois connecté, et après l'enregistrement
  $('#onb-back').hidden = step === 'install' || (step === 'name' && (isStandalone() || !canInstall()));
  // Bouton principal
  const nb = $('#onb-next');
  nb.disabled = false;
  nb.textContent = t(step === 'welcome' ? 'home.cta_start'
    : step === 'auth' ? (authMode === 'new' ? 'auth.signup_btn' : 'auth.login_btn')
    : step === 'wa' ? 'onb.finish' : step === 'install' ? (installed ? 'onb.here' : 'onb.later') : 'onb.next');
  nb.classList.toggle('btn-line', step === 'install');
  nb.classList.toggle('btn-gold', step !== 'install');
  $('#onb-alt').hidden = step !== 'welcome';
  $('#onb-skip').hidden = step !== 'welcome' || !!session;
  root.dataset.step = step;
  root.scrollTo(0, 0);
  // Mettre le curseur dans le premier champ texte
  const first = body.querySelector('input[type=text], input[type=email], input[type=tel]');
  if (first && !first.value && matchMedia('(pointer: fine)').matches) first.focus();
}

async function next() {
  if (step === 'welcome') { authMode = 'new'; return goStep('auth'); }
  if (step === 'auth') return doAuth();
  if (step === 'install') return goStep('name');
  const err = check(step);
  if (err) return msg(err);
  if (step === 'wa') return save();
  goStep(STEPS[STEPS.indexOf(step) + 1]);
}

async function doAuth() {
  const f = $('#onb-auth');
  const email = f.email.value.trim(), pw = f.password.value;
  if (!EMAIL_RE.test(email)) return msg('err.invalid_email');
  if (authMode === 'new' && !pwOk(pw)) return msg('err.pw_rule');
  const nb = $('#onb-next'); nb.disabled = true;
  const r = authMode === 'new'
    ? await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: BASE } })
    : await sb.auth.signInWithPassword({ email, password: pw });
  nb.disabled = false;
  if (r.error) {
    const k = errKey(r.error);
    msg(k);
    const rs = f.querySelector('.link'); if (rs) rs.hidden = k !== 'err.not_confirmed';
    return;
  }
  f.password.value = '';
  // Nouveau compte : confirmation par e-mail (la suite reprend au retour sur le site)
  if (authMode === 'new' && !r.data.session) msg('onb.check_email', 'ok');
}

async function save() {
  const d = draft, minor = isMinor();
  const pub = {
    first_name: d.first_name.trim(), gender: d.gender, age_range: d.age_range, country: d.country,
    city: String(d.city || '').trim() || null, languages: d.languages, level: d.level, riwaya: d.riwaya,
    hizb_memorized: Number(d.hizb_memorized) || 0, availability: d.availability,
    contact_mode: d.contact_mode, ui_language: lang()
  };
  const priv = minor
    ? { whatsapp: null, guardian_name: d.guardian_name.trim(), guardian_whatsapp: normPhone(d.guardian_whatsapp) }
    : { whatsapp: normPhone(d.whatsapp), guardian_name: null, guardian_whatsapp: null };
  const nb = $('#onb-next'); nb.disabled = true; nb.textContent = t('onb.saving');
  const uid = session.user.id;
  let r = await sb.from('profiles').insert({ id: uid, ...pub });
  if (!r.error) {
    const has = await sb.from('profiles_private').select('id').eq('id', uid).maybeSingle();
    r = has.data
      ? await sb.from('profiles_private').update(priv).eq('id', uid)
      : await sb.from('profiles_private').insert({ id: uid, ...priv });
  }
  if (r.error) { console.warn(r.error); nb.disabled = false; nb.textContent = t('onb.finish'); return msg('err.generic'); }
  resetProfileCache();
  finish();
}

/* ---------- Entrée ---------- */
export async function showOnboard(s) {
  const my = ++seq;
  session = s;
  let want = stepFromHash();
  if (!s) {
    if (!['welcome', 'auth'].includes(want)) want = 'welcome';
    if (want === 'auth' && new URLSearchParams(location.hash.split('?')[1] || '').get('m') === 'login') authMode = 'login';
  } else {
    let me = null;
    try { me = await loadMine(s); } catch (e) { /* hors ligne : on continue */ }
    if (my !== seq) return;
    if (me?.pub) return finish();
    loadDraft(); defaults();
    if (want === 'welcome' || want === 'auth') want = null;   // déjà connecté
    if (want === 'install' && !isStandalone() && canInstall()) { /* on reste sur l'installation */ }
    else if (!want && offerInstall()) want = 'install';
    else {
      // On ne saute pas une étape non remplie
      const fm = PROFILE_STEPS.indexOf(firstMissing());
      const wi = PROFILE_STEPS.indexOf(want);
      want = wi === -1 ? PROFILE_STEPS[fm] : PROFILE_STEPS[Math.min(wi, fm)];
    }
  }
  if (!s) { loadDraft(); defaults(); }
  step = want;
  render();
}

export function bindOnboard(go, changeLang) {
  goTo = go; onLang = changeLang;
  $('#onb-next').addEventListener('click', next);
  $('#onb-back').addEventListener('click', () => {
    const i = STEPS.indexOf(step);
    if (i > 0) goStep(STEPS[i - 1]);
  });
  $('#onb-alt').addEventListener('click', () => { authMode = 'login'; goTo('start?s=auth&m=login'); });
  // Entrée dans un champ = Suivant
  $('#onb-body').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input') && step !== 'auth') { e.preventDefault(); next(); }
  });
}

// Première ouverture sans compte : on montre l'écran d'accueil plein écran (une fois).
export function firstVisit() {
  try {
    if (localStorage.getItem('sq_seen')) return false;
    localStorage.setItem('sq_seen', '1');
    return true;
  } catch (e) { return false; }
}
