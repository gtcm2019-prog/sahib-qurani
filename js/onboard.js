// V3 – Inscription simple, style application Play Store.
// 1) « Veuillez vous connecter » : Google uniquement (une seule fois).
// 2) Android : grand bouton « Installer l'application », puis ouvrir l'icône.
// 3) Dans l'application : 7 pages simples (pseudo, âge, lieu, langues, niveau, disponibilités, WhatsApp).
// iPhone et ordinateur : pas d'installation demandée pour l'instant, les 7 pages se font dans le navigateur.
import { sb } from './sb.js';
import { t, lang } from './i18n.js';
import { $, errKey } from './ui.js';
import * as D from './data.js';
import { el, countryName, languageName, fmtPct } from './card.js';
import { loadMine, resetProfileCache, normPhone } from './profile.js';
import { installNow, isStandalone, isAndroid, hasPrompt } from './pwa.js';
import { checkPseudo, isPseudoTaken, suggestBox } from './pseudo.js';

const BASE = location.origin + location.pathname;
const STEPS = ['pick', 'auth', 'install', 'name', 'gender', 'age', 'place', 'lang', 'level', 'avail', 'mode', 'wa'];
const PROFILE_STEPS = ['name', 'gender', 'age', 'place', 'lang', 'level', 'avail', 'mode', 'wa'];
const TOTAL = PROFILE_STEPS.length;      // la numérotation ne concerne que les pages du profil

let goTo = () => {};
let onLang = () => {};
let session = null;
let draft = {};
let owner = null;        // à qui appartient le brouillon en mémoire
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
    case 'name': return String(d.first_name || '').trim() ? null : 'onb.err_name';
    case 'gender': return d.gender ? null : 'onb.err_gender';
    case 'age': return d.age_range ? null : 'onb.err_choose';
    case 'place': return d.country ? null : 'onb.err_country';
    case 'lang': return !d.languages?.length ? 'onb.err_lang' : !d.riwaya ? 'onb.err_riwaya' : null;
    case 'level': return d.level ? null : 'onb.err_choose';
    case 'avail': return d.availability?.length ? null : 'onb.err_avail';
    case 'mode': return d.contact_mode ? null : 'onb.err_contact';
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

// Android : installation OBLIGATOIRE avant le profil (le profil se remplit dans l'application).
// Exception : navigateur qui ne permet pas d'installer (lien discret, après un essai).
// Langue choisie explicitement (page « Choisir la langue », une seule fois).
const langPicked = () => { try { return !!localStorage.getItem('sq_lang_pick'); } catch (e) { return true; } };
const skipped = () => { try { return !!localStorage.getItem('sq_inst_skip'); } catch (e) { return false; } };
const mustInstall = () => isAndroid && !isStandalone() && !skipped();
let installed = false;   // installation acceptée pendant cet écran
let tried = false;       // l'utilisateur a touché « Installer » sans succès

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
  auth(body) {
    const w = el('div', 'onb-welcome onb-login');
    const logo = el('div', 'onb-logo');
    const img = document.createElement('img');
    img.src = 'icons/icon-192.png'; img.alt = ''; img.width = 96; img.height = 96;
    logo.append(img);
    const g = el('button', 'btn btn-google onb-big');
    g.type = 'button';
    g.append(el('span', 'g', 'G'), el('span', null, t('auth.google')));
    g.addEventListener('click', async () => {
      g.disabled = true;
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: BASE } });
      if (error) { g.disabled = false; msg(errKey(error)); }
    });
    w.append(logo, el('h1', null, t('onb.please_login')), g, langSeg());
    body.append(w);
  },

  pick(body) {
    const w = el('div', 'onb-welcome onb-pick');
    const logo = el('div', 'onb-logo');
    const img = document.createElement('img');
    img.src = 'icons/icon-192.png'; img.alt = ''; img.width = 96; img.height = 96;
    logo.append(img);
    // Titre dans les 4 langues : la langue n'est pas encore choisie
    const h = el('h1', 'onb-pick-title');
    h.append(el('span', null, 'اختر لغتك'), el('span', null, 'Choisissez votre langue'),
      el('span', null, 'Choose your language'), el('span', null, 'Elige tu idioma'));
    h.setAttribute('dir', 'auto');
    const box = el('div', 'onb-pick-list');
    for (const [c, n] of [['ar', 'العربية'], ['fr', 'Français'], ['en', 'English'], ['es', 'Español']]) {
      const b = el('button', 'onb-pick-btn');
      b.type = 'button'; b.lang = c;
      if (c === 'ar') b.dir = 'rtl';
      const f = document.createElement('img');
      f.src = `icons/flags/${c}.svg`; f.alt = ''; f.width = 42; f.height = 28;
      b.append(f, el('b', null, n));
      b.addEventListener('click', async () => {
        try { localStorage.setItem('sq_lang_pick', '1'); } catch (e) { /* ignore */ }
        if (c !== lang()) await onLang(c);
        goStep('auth');
      });
      box.append(b);
    }
    w.append(logo, h, box);
    body.append(w);
  },

  name(body) {
    body.append(head('onb.name_title', 'onb.name_sub'));
    body.append(field('onb.pseudo', input('text', draft.first_name, v => set('first_name', v),
      { maxlength: 50, autocomplete: 'nickname', dir: 'auto', name: 'first_name' })));
    const sug = el('div', null); sug.id = 'onb-sug'; body.append(sug);
  },

  gender(body) {
    body.append(head('onb.gender_title'));
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
  },

  mode(body) {
    body.append(head('onb.contact_q'));
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
    const w = el('div', 'onb-welcome onb-install');
    const logo = el('div', 'onb-logo');
    const img = document.createElement('img');
    img.src = 'icons/icon-192.png'; img.alt = ''; img.width = 96; img.height = 96;
    logo.append(img);
    w.append(logo);
    if (installed) {
      w.append(el('h1', null, t('onb.inst_ok')), el('p', 'onb-big-note', t('onb.inst_open')));
    } else {
      const b = el('button', 'btn btn-gold onb-big', t('onb.inst_btn'));
      b.type = 'button';
      b.addEventListener('click', async () => {
        if (await installNow()) { installed = true; render(); return; }
        if (!hasPrompt()) msg('onb.inst_menu', 'ok');   // navigateur sans bouton : passer par le menu ⋮
        if (!tried) { tried = true; $('#onb-cant').hidden = false; }
      });
      w.append(b, el('p', 'onb-big-note', t('onb.inst_then')));
    }
    const cant = el('button', 'link onb-cant', t('onb.cant_install'));
    cant.type = 'button'; cant.id = 'onb-cant'; cant.hidden = !tried || installed;
    cant.addEventListener('click', () => {
      try { localStorage.setItem('sq_inst_skip', '1'); } catch (e) { /* ignore */ }
      goStep('name');
    });
    w.append(cant);
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
let pendingTaken = null;   // pseudo refusé à l'enregistrement : propositions à afficher

function render() {
  const root = $('#onb');
  const body = $('#onb-body');
  body.replaceChildren();
  body.className = 'onb-body onb-s-' + step;
  msg(null);
  SCREENS[step](body);
  if (step === 'name' && pendingTaken) { pseudoTaken(pendingTaken); pendingTaken = null; }
  // Barre et numéro seulement sur les pages du profil : « Étape 3 sur 7 · Lieu »
  const pi = PROFILE_STEPS.indexOf(step) + 1;
  $('#onb-top').hidden = !pi;
  $('#onb-fill').style.width = (pi / TOTAL * 100) + '%';
  $('#onb-count').textContent = `${pi}/${TOTAL}`;
  if (pi) body.prepend(el('p', 'onb-eyebrow', t('onb.step', { n: pi, t: TOTAL }) + ' · ' + t('onb.n_' + step)));
  $('#onb-prog').setAttribute('aria-valuenow', String(pi));
  $('#onb-prog').setAttribute('aria-valuemax', String(TOTAL));
  $('#onb-back').hidden = pi <= 1;
  const nb = $('#onb-next');
  nb.disabled = false;
  nb.hidden = !pi;                     // connexion et installation : un seul grand bouton dans la page
  nb.textContent = t(step === 'wa' ? 'onb.finish' : 'onb.next');
  $('#onb-alt').hidden = true;
  $('#onb-skip').hidden = true;
  root.dataset.step = step;
  root.scrollTo(0, 0);
  const first = body.querySelector('input[type=text], input[type=tel]');
  if (first && !first.value && matchMedia('(pointer: fine)').matches) first.focus();
}

async function next() {
  if (!PROFILE_STEPS.includes(step)) return;
  const err = check(step);
  if (err) return msg(err);
  if (step === 'name') {
    const nb = $('#onb-next'); nb.disabled = true;
    const r = await checkPseudo(draft.first_name);
    nb.disabled = false;
    if (r && !r.free) return pseudoTaken(r.suggestions);
  }
  if (step === 'wa') return save();
  goStep(STEPS[STEPS.indexOf(step) + 1]);
}

// Pseudo déjà pris : message + propositions cliquables
function pseudoTaken(list) {
  msg('pseudo.taken');
  const box = $('#onb-sug');
  if (!box) return;
  box.replaceChildren(suggestBox(list, v => {
    set('first_name', v);
    const i = $('#onb-body input[name=first_name]');
    if (i) i.value = v;
    box.replaceChildren(); msg(null);
  }));
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
  if (r.error) {
    console.warn(r.error); nb.disabled = false; nb.textContent = t('onb.finish');
    if (isPseudoTaken(r.error)) { const c = await checkPseudo(d.first_name); pendingTaken = c?.suggestions || []; return goStep('name'); }
    return msg('err.generic');
  }
  resetProfileCache();
  finish();
}

/* ---------- Entrée ---------- */
export async function showOnboard(s) {
  const my = ++seq;
  session = s;
  let want = stepFromHash();
  if (!s) {
    // non connecté : choix de la langue (une fois), puis « Veuillez vous connecter »
    want = langPicked() ? 'auth' : 'pick';
  } else {
    let me = null;
    try { me = await loadMine(s); } catch (e) { /* hors ligne : on continue */ }
    if (my !== seq) return;
    if (me?.pub) return finish();
    loadDraft(); defaults();
    if (want === 'auth' || want === 'pick') want = null;    // déjà connecté : on ne redemande jamais la connexion
    if (mustInstall()) want = 'install';
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
  // Entrée dans un champ = Suivant
  $('#onb-body').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); next(); }
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
