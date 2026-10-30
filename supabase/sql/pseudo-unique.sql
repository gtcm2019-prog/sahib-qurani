-- =====================================================================
-- Sahib Qurani : pseudo unique (sans tenir compte des majuscules)
-- À coller tel quel dans Supabase → SQL Editor → Run.
-- « Adam », « adam » et « ADAM » = le même pseudo.
-- Si des doublons existent déjà, la règle n'est PAS posée : le résultat
-- affiche la liste des doublons (rien n'est modifié chez les membres).
-- =====================================================================

-- 1. Pseudo libre ? + propositions simples à retenir
--    Renvoie {"free": true} ou {"free": false, "suggestions": ["Adam2026", "Adam_Casa", "Adam_47"]}
create or replace function public.pseudo_status(p_name text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  n     text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 50);
  base  text;
  town  text;
  cand  text;
  res   text[] := '{}';
  tries int := 0;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if n = '' then return jsonb_build_object('free', false, 'suggestions', '[]'::jsonb); end if;

  if not exists (select 1 from public.profiles p
                 where lower(btrim(p.first_name)) = lower(n) and p.id <> me) then
    return jsonb_build_object('free', true);
  end if;

  base := left(replace(n, ' ', '_'), 40);
  -- ville choisie par le membre (si déjà renseignée) : premier mot, 4 lettres max
  select left(split_part(btrim(p.city), ' ', 1), 4) into town from public.profiles p where p.id = me;

  -- a) l'année   b) la ville   c) un nombre à deux chiffres
  foreach cand in array array[
    base || extract(year from now())::int::text,
    case when coalesce(town, '') <> '' then base || '_' || initcap(town) end
  ] loop
    if cand is not null and not exists (select 1 from public.profiles p
        where lower(btrim(p.first_name)) = lower(cand) and p.id <> me) then
      res := res || cand;
    end if;
  end loop;

  while coalesce(array_length(res, 1), 0) < 3 and tries < 40 loop
    tries := tries + 1;
    cand := base || '_' || (10 + floor(random() * 90))::int::text;
    if not (cand = any(res)) and not exists (select 1 from public.profiles p
        where lower(btrim(p.first_name)) = lower(cand) and p.id <> me) then
      res := res || cand;
    end if;
  end loop;

  return jsonb_build_object('free', false, 'suggestions', to_jsonb(res));
end $$;

revoke all on function public.pseudo_status(text) from public, anon;
grant execute on function public.pseudo_status(text) to authenticated;

-- 2. Règle d'unicité (posée seulement s'il n'y a aucun doublon)
do $$
begin
  if not exists (select 1 from public.profiles
                 group by lower(btrim(first_name)) having count(*) > 1) then
    create unique index if not exists profiles_pseudo_unique
      on public.profiles (lower(btrim(first_name)));
  end if;
end $$;

-- 3. Résultat
--    « Règle posée : oui » et aucune ligne de doublon = tout est bon.
select 'Règle posée : ' || case when exists (select 1 from pg_indexes
         where schemaname = 'public' and indexname = 'profiles_pseudo_unique')
       then 'oui' else 'NON (doublons ci-dessous)' end as etat,
       null::text as pseudo, null::bigint as nombre
union all
select null, min(first_name), count(*)
from public.profiles
group by lower(btrim(first_name)) having count(*) > 1;
