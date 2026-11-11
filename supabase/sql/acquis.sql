-- =====================================================================
-- Sahib Qurani V6 : « Mes acquis » — ce que le membre savait déjà avant le suivi.
--   Il coche ses hizb (ou juz = 2 hizb) et ses sourates ; le suivi quotidien s'y ajoute.
--   Le Coran mémorisé (pages, hizb, juz, sourates, %) = acquis ∪ apprentissages accomplis.
--   profiles.hizb_memorized suit ce total (exact dès que le membre a des acquis).
-- Chaque profil de la famille a ses propres acquis (profil actif = private.me()).
-- À exécuter APRÈS rythme.sql. À coller tel quel dans Supabase → SQL Editor → Run.
-- =====================================================================

-- 1. Table des acquis
create table if not exists public.quran_acquis (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  hizbs      smallint[] not null default '{}',
  surahs     smallint[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(hizbs) <= 60 and cardinality(surahs) <= 114)
);
alter table public.quran_acquis enable row level security;
revoke all on public.quran_acquis from anon, authenticated;
grant select on public.quran_acquis to authenticated;
drop policy if exists quran_acquis_select on public.quran_acquis;
create policy quran_acquis_select on public.quran_acquis for select to authenticated
  using (private.owns(user_id) or private.is_active_partner(user_id));

-- 2. Pages de chaque sourate (mushaf 604 pages) : [1] = première page, [2] = dernière page
--    (calculé avec quran-meta 7.0.0, Hafs et Warsh, comme private.hizb_pages)
create or replace function private.surah_pages(p_riwaya text) returns smallint[]
language sql immutable set search_path = '' as $$
  select case when p_riwaya = 'warsh'
    then array['{1,2,50,77,106,128,151,177,187,208,221,235,249,255,262,267,282,293,305,312,322,332,342,350,359,367,377,385,396,404,411,415,418,428,434,440,446,453,458,467,477,483,489,496,499,502,507,511,515,518,520,523,526,528,531,534,537,542,545,549,551,553,554,556,558,560,562,564,566,568,570,572,574,575,577,578,580,582,583,585,586,587,587,589,590,591,591,592,593,594,595,595,596,596,597,597,598,598,599,599,600,600,601,601,601,602,602,602,603,603,603,604,604,604}'::smallint[], '{1,49,76,106,127,150,176,186,207,221,235,248,255,261,267,281,293,304,312,321,331,341,349,359,366,376,385,396,404,410,414,417,427,434,440,445,452,458,467,476,482,489,495,498,502,506,510,515,517,520,523,525,528,531,534,537,541,545,548,551,552,554,555,557,559,561,564,566,568,570,571,573,575,577,578,580,581,583,584,586,586,587,589,590,590,591,592,593,594,595,595,596,596,597,597,598,598,599,599,600,600,600,601,601,601,602,602,602,603,603,603,604,604,604}'::smallint[]]
    else array['{1,2,50,77,106,128,151,177,187,208,221,235,249,255,262,267,282,293,305,312,322,332,342,350,359,367,377,385,396,404,411,415,418,428,434,440,446,453,458,467,477,483,489,496,499,502,507,511,515,518,520,523,526,528,531,534,537,542,545,549,551,553,554,556,558,560,562,564,566,568,570,572,574,575,577,578,580,582,583,585,586,587,587,589,590,591,591,592,593,594,595,595,596,596,597,597,598,598,599,599,600,600,601,601,601,602,602,602,603,603,603,604,604,604}'::smallint[], '{1,49,76,106,127,150,176,186,207,221,235,248,255,261,267,281,293,304,312,321,331,341,349,359,366,376,385,396,404,410,414,417,427,434,440,445,452,458,467,476,482,489,495,498,502,506,510,515,517,520,523,525,528,531,534,537,541,545,548,551,552,554,555,557,559,561,564,566,568,570,571,573,575,577,578,580,581,583,584,585,586,587,589,589,590,591,592,592,594,594,595,596,596,596,597,597,598,599,599,600,600,600,601,601,601,602,602,602,603,603,603,604,604,604}'::smallint[]] end;
$$;

-- 3. Ce que le membre a mémorisé : acquis + apprentissages accomplis
create or replace function private.hifz_map(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rw text; hp smallint[]; sp smallint[]; ah int[] := '{}'; asr int[] := '{}';
  tpages int[]; tthumns int[]; pages int[]; thumns int[]; hizbs int[] := '{}'; surahs int[] := '{}'; h int; s int;
begin
  select riwaya into rw from public.profiles where id = p_user;
  hp := private.hizb_pages(rw);
  sp := private.surah_pages(rw);
  select coalesce(a.hizbs::int[], '{}'), coalesce(a.surahs::int[], '{}') into ah, asr
    from public.quran_acquis a where a.user_id = p_user;
  ah := coalesce(ah, '{}'); asr := coalesce(asr, '{}');
  -- appris avec le suivi
  select coalesce(array_agg(distinct n order by n), '{}') into tpages
    from public.revision_plans p, generate_series(p.start_no::int, p.end_no::int) n
   where p.user_id = p_user and p.kind = 'hifz' and p.unit = 'page' and p.status = 'done';
  select coalesce(array_agg(distinct n order by n), '{}') into tthumns
    from public.revision_plans p, generate_series(p.start_no::int, p.end_no::int) n
   where p.user_id = p_user and p.kind = 'hifz' and p.unit = 'thumn' and p.status = 'done';
  -- + acquis
  select coalesce(array_agg(distinct n order by n), '{}') into pages from (
    select unnest(tpages) n
    union select generate_series(hp[1][x]::int, hp[2][x]::int) from unnest(ah) x
    union select generate_series(sp[1][x]::int, sp[2][x]::int) from unnest(asr) x) z;
  select coalesce(array_agg(distinct n order by n), '{}') into thumns from (
    select unnest(tthumns) n
    union select generate_series((x - 1) * 8 + 1, x * 8) from unnest(ah) x) z;
  for h in 1..60 loop
    if (select count(*) from unnest(thumns) t where t between (h-1)*8+1 and h*8) = 8
       or (select count(*) from unnest(pages) x where x between hp[1][h] and hp[2][h]) = hp[2][h] - hp[1][h] + 1
    then hizbs := hizbs || h; end if;
  end loop;
  for s in 1..114 loop
    if s = any(asr)
       or (select count(*) from unnest(pages) x where x between sp[1][s] and sp[2][s]) = sp[2][s] - sp[1][s] + 1
    then surahs := surahs || s; end if;
  end loop;
  return jsonb_build_object('riwaya', coalesce(rw, 'hafs'), 'pages', to_jsonb(pages), 'thumns', to_jsonb(thumns),
    'hizbs', to_jsonb(hizbs), 'surahs', to_jsonb(surahs),
    'track_pages', to_jsonb(tpages), 'track_thumns', to_jsonb(tthumns),
    'acquis', jsonb_build_object('hizbs', to_jsonb(ah), 'surahs', to_jsonb(asr)));
end $$;

-- Hizb mémorisés du profil : exact si le membre a des acquis, sinon jamais baissé (comme avant)
create or replace function private.sync_hizb_memorized(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  n := jsonb_array_length(private.hifz_map(p_user)->'hizbs');
  if exists (select 1 from public.quran_acquis where user_id = p_user) then
    update public.profiles set hizb_memorized = n where id = p_user and hizb_memorized is distinct from n;
  else
    update public.profiles set hizb_memorized = n where id = p_user and coalesce(hizb_memorized, 0) < n;
  end if;
end $$;

-- 4. Enregistrer ses acquis (profil actif)
create or replace function public.set_acquis(p_hizbs int[], p_surahs int[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me();
begin
  if me is null then raise exception 'auth'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'no_profile'; end if;
  if exists (select 1 from unnest(coalesce(p_hizbs, '{}')) x where x not between 1 and 60)
     or exists (select 1 from unnest(coalesce(p_surahs, '{}')) x where x not between 1 and 114) then
    raise exception 'bad_range' using errcode = 'P0001';
  end if;
  insert into public.quran_acquis (user_id, hizbs, surahs, updated_at)
  values (me, (select coalesce(array_agg(distinct x order by x), '{}')::smallint[] from unnest(p_hizbs) x),
              (select coalesce(array_agg(distinct x order by x), '{}')::smallint[] from unnest(p_surahs) x), now())
  on conflict (user_id) do update set hizbs = excluded.hizbs, surahs = excluded.surahs, updated_at = now();
  perform private.sync_hizb_memorized(me);
  return private.hifz_map(me);
end $$;

-- 5. Droits
revoke execute on function public.set_acquis(int[], int[]) from public, anon;
grant execute on function public.set_acquis(int[], int[]) to authenticated;
revoke execute on function private.surah_pages(text), private.hifz_map(uuid), private.sync_hizb_memorized(uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
