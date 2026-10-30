// Pseudo unique : vérification auprès de la base et propositions simples (Adam2026, Adam_Casa, Adam_47).
import { sb } from './sb.js';
import { t } from './i18n.js';
import { el } from './card.js';

// { free: true } | { free: false, suggestions: [...] } ; null si la vérification est impossible
// (hors ligne…) : la règle de la base bloquera de toute façon un doublon à l'enregistrement.
export async function checkPseudo(name) {
  try {
    const { data, error } = await sb.rpc('pseudo_status', { p_name: String(name || '').trim() });
    if (error || !data) return null;
    return data;
  } catch (e) { return null; }
}

// Doublon refusé par la base au moment d'enregistrer
export const isPseudoTaken = error => String(error?.message || '').includes('profiles_pseudo_unique');

// Pastilles cliquables « Propositions : … » ; onPick(pseudo) remplit le champ
export function suggestBox(list, onPick) {
  const box = el('div', 'pseudo-sug');
  if (!list?.length) return box;
  box.append(el('span', 'muted small', t('pseudo.suggest')));
  const row = el('div', 'chips');
  for (const s of list) {
    const b = el('button', 'chip-btn', s);
    b.type = 'button';
    b.addEventListener('click', () => onPick(s));
    row.append(b);
  }
  box.append(row);
  return box;
}
