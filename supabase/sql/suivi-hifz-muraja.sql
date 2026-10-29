-- =====================================================================
-- Sahib Qurani V4 (suite) : deux suivis séparés
--   hifz   = apprentissage (nouveau) : par page (1–604) ou par thumn (1–480)
--   muraja = révision : par sourate (1–114), hizb (1–60) ou juz (1–30), plusieurs à la suite
-- Un programme de chaque sorte par jour. Un hizb compte comme mémorisé seulement s'il est
-- appris en entier (ses 8 thumn, ou toutes ses pages) ; le profil est alors mis à jour.
-- À exécuter APRÈS revision-plans.sql. À coller tel quel dans Supabase → SQL Editor → Run.
-- =====================================================================

-- 1. Colonne « kind » et nouvelles règles
alter table public.revision_plans add column if not exists kind text;
update public.revision_plans set kind = case when unit in ('page','thumn') then 'hifz' else 'muraja' end
 where kind is null;
delete from public.revision_plans where unit in ('nisf','rub');   -- anciennes unités (essais du 29/10)
alter table public.revision_plans alter column kind set not null;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.revision_plans'::regclass and contype in ('c','u')
             and conname not like '%status%'
  loop
    execute format('alter table public.revision_plans drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.revision_plans
  add constraint revision_plans_kind_unit check (
    (kind = 'hifz'   and unit in ('page','thumn')) or
    (kind = 'muraja' and unit in ('surah','hizb','juz'))),
  add constraint revision_plans_range check (
    start_no >= 1 and start_no <= end_no and end_no <= case unit
      when 'page' then 604 when 'thumn' then 480 when 'surah' then 114
      when 'hizb' then 60 when 'juz' then 30 end),
  add constraint revision_plans_one_per_day unique (user_id, plan_date, kind);
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.revision_plans'::regclass
                 and pg_get_constraintdef(oid) like '%status%') then
    alter table public.revision_plans add constraint revision_plans_status_check
      check (status in ('planned','done','missed'));
  end if;
end $$;

-- 2. Pages de chaque hizb (mushaf 604 pages) : [1] = première page, [2] = dernière page entière
create or replace function private.hizb_pages(p_riwaya text) returns smallint[]
language sql immutable set search_path = '' as $$
  select case when p_riwaya = 'warsh'
    then array['{1,11,22,32,42,51,62,72,82,92,102,112,121,131,141,151,162,173,182,192,201,212,222,231,242,251,262,272,282,292,302,312,322,332,342,352,362,371,381,392,402,413,422,431,442,451,462,472,482,491,502,513,522,531,542,553,562,572,582,591}'::smallint[], '{11,22,32,42,51,62,72,81,92,102,112,121,131,141,150,162,172,181,192,201,211,221,231,241,251,261,272,281,292,302,312,321,331,341,351,361,371,381,391,401,413,421,431,442,451,462,471,482,491,502,513,521,531,541,552,561,571,581,591,604}'::smallint[]]
    else array['{1,11,22,32,42,51,62,72,82,92,102,112,121,132,142,151,162,173,182,192,201,212,222,231,242,252,262,272,282,292,302,312,322,332,342,352,362,371,382,392,402,413,422,431,442,451,462,472,482,491,502,513,522,531,542,553,562,572,582,591}'::smallint[], '{11,21,31,41,51,62,72,81,92,101,112,121,131,141,150,161,172,181,192,201,211,221,231,241,251,261,272,281,292,301,312,321,331,341,351,361,371,381,391,401,413,421,431,441,451,461,471,481,491,502,513,521,531,541,552,561,571,581,591,604}'::smallint[]] end;
$$;

-- 3. Ce que le membre a appris (programmes d'apprentissage accomplis)
create or replace function private.hifz_map(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rw text; hp smallint[]; pages int[]; thumns int[]; hizbs int[] := '{}'; h int;
begin
  select riwaya into rw from public.profiles where id = p_user;
  hp := private.hizb_pages(rw);
  select coalesce(array_agg(distinct n order by n), '{}') into pages
    from public.revision_plans p, generate_series(p.start_no::int, p.end_no::int) n
   where p.user_id = p_user and p.kind = 'hifz' and p.unit = 'page' and p.status = 'done';
  select coalesce(array_agg(distinct n order by n), '{}') into thumns
    from public.revision_plans p, generate_series(p.start_no::int, p.end_no::int) n
   where p.user_id = p_user and p.kind = 'hifz' and p.unit = 'thumn' and p.status = 'done';
  for h in 1..60 loop
    if (select count(*) from unnest(thumns) t where t between (h-1)*8+1 and h*8) = 8
       or (select count(*) from unnest(pages) x where x between hp[1][h] and hp[2][h]) = hp[2][h] - hp[1][h] + 1
    then hizbs := hizbs || h; end if;
  end loop;
  return jsonb_build_object('riwaya', coalesce(rw, 'hafs'), 'pages', to_jsonb(pages),
                            'thumns', to_jsonb(thumns), 'hizbs', to_jsonb(hizbs));
end $$;

-- Hizb mémorisés du profil : relevé automatiquement, jamais baissé
create or replace function private.sync_hizb_memorized(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  n := jsonb_array_length(private.hifz_map(p_user)->'hizbs');
  update public.profiles set hizb_memorized = n where id = p_user and coalesce(hizb_memorized, 0) < n;
end $$;

-- 4. Évaluation : taux sur 30 jours (tous programmes), jours d'affilée = jours où tout est accompli
create or replace function private.refresh_assiduity(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := private.member_today(p_user);
  n_all int; n_done int; rate int; lvl text; streak int := 0; d date;
  day_ok constant text := 'select exists (select 1 from public.revision_plans where user_id = $1 and plan_date = $2)
     and not exists (select 1 from public.revision_plans where user_id = $1 and plan_date = $2 and status <> ''done'')';
  ok boolean;
begin
  select count(*), count(*) filter (where status = 'done') into n_all, n_done
    from public.revision_plans
   where user_id = p_user and plan_date > today - 30
     and (plan_date < today or (plan_date = today and status = 'done'));
  rate := case when n_all > 0 then round(100.0 * n_done / n_all) end;
  lvl  := case when n_all < 7 then 'new' when rate >= 80 then 'top' when rate >= 50 then 'good' else 'low' end;
  execute day_ok into ok using p_user, today;
  d := case when ok then today else today - 1 end;
  loop
    execute day_ok into ok using p_user, d;
    exit when not ok or streak >= 3650;
    streak := streak + 1; d := d - 1;
  end loop;
  update public.profiles set assiduity = lvl, assiduity_rate = rate, revision_streak = streak
   where id = p_user
     and (assiduity, assiduity_rate, revision_streak) is distinct from (lvl, rate, streak);
end $$;

-- 5. Fonctions du membre (nouvelle signature avec « kind »)
drop function if exists public.set_revision_plan(date, text, int, int);
drop function if exists public.mark_revision_done(date, boolean);
drop function if exists public.delete_revision_plan(date);

create or replace function public.set_revision_plan(p_kind text, p_date date, p_unit text, p_start int, p_end int)
returns public.revision_plans
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); today date; r public.revision_plans;
begin
  if me is null then raise exception 'auth'; end if;
  today := private.member_today(me);
  if p_date is null or p_date not in (today, today + 1) then raise exception 'bad_date' using errcode = 'P0001'; end if;
  if exists (select 1 from public.revision_plans
              where user_id = me and plan_date = p_date and kind = p_kind and status <> 'planned') then
    raise exception 'already_done' using errcode = 'P0001';
  end if;
  insert into public.revision_plans (user_id, plan_date, kind, unit, start_no, end_no)
  values (me, p_date, p_kind, p_unit, p_start, p_end)
  on conflict (user_id, plan_date, kind) do update
     set unit = excluded.unit, start_no = excluded.start_no, end_no = excluded.end_no, updated_at = now()
  returning * into r;
  return r;
end $$;

create or replace function public.mark_revision_done(p_kind text, p_date date, p_done boolean default true)
returns public.revision_plans
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.revision_plans;
begin
  if me is null then raise exception 'auth'; end if;
  if p_date is distinct from private.member_today(me) then raise exception 'bad_date' using errcode = 'P0001'; end if;
  update public.revision_plans
     set status = case when p_done then 'done' else 'planned' end,
         done_at = case when p_done then now() end, updated_at = now()
   where user_id = me and plan_date = p_date and kind = p_kind
  returning * into r;
  if r.id is null then raise exception 'no_plan' using errcode = 'P0001'; end if;
  perform private.refresh_assiduity(me);
  if p_kind = 'hifz' and p_done then perform private.sync_hizb_memorized(me); end if;
  return r;
end $$;

create or replace function public.delete_revision_plan(p_kind text, p_date date) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth'; end if;
  delete from public.revision_plans
   where user_id = me and kind = p_kind and plan_date = p_date
     and plan_date >= private.member_today(me) and status = 'planned';
  return found;
end $$;

-- 6. Statistiques (moi ou mon partenaire actif)
create or replace function public.revision_stats(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := coalesce(p_user, auth.uid()); today date; m jsonb; res jsonb := '{}'; k text;
  streak int; d date; ok boolean;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if u <> auth.uid() and not private.is_active_partner(u) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.profiles where id = u) then return null; end if;
  perform private.refresh_assiduity(u);
  today := private.member_today(u);
  m := private.hifz_map(u);
  foreach k in array array['hifz','muraja'] loop
    streak := 0;
    d := case when exists (select 1 from public.revision_plans where user_id = u and kind = k
                            and plan_date = today and status = 'done') then today else today - 1 end;
    while exists (select 1 from public.revision_plans where user_id = u and kind = k and plan_date = d and status = 'done') loop
      streak := streak + 1; d := d - 1; exit when streak >= 3650;
    end loop;
    res := res || jsonb_build_object(k, (select jsonb_build_object(
      'streak', streak,
      'rate30', (select round(100.0 * count(*) filter (where status = 'done') / nullif(count(*), 0))
                   from public.revision_plans where user_id = u and kind = k and plan_date > today - 30
                    and (plan_date < today or status = 'done')),
      'done_total', (select count(*) from public.revision_plans where user_id = u and kind = k and status = 'done'),
      'hizb_total', (select coalesce(sum((end_no - start_no + 1) * case unit when 'hizb' then 1 when 'juz' then 2 else 0 end), 0)
                       from public.revision_plans where user_id = u and kind = k and status = 'done'),
      'days', coalesce((select jsonb_agg(jsonb_build_object('d', plan_date, 's',
                 case when status = 'planned' and plan_date < today then 'missed' else status end) order by plan_date)
               from public.revision_plans where user_id = u and kind = k and plan_date > today - 35), '[]'::jsonb))));
  end loop;
  return (select jsonb_build_object(
    'today', today, 'assiduity', pr.assiduity, 'rate30', pr.assiduity_rate, 'streak', pr.revision_streak,
    'hizb_memorized', pr.hizb_memorized, 'map', m,
    'hifz', res->'hifz', 'muraja', res->'muraja')
    from public.profiles pr where pr.id = u);
end $$;

-- 7. Statistiques ADMIN (totaux seulement) : + répartition apprentissage / révision
create or replace function public.admin_revision_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.is_admin(), false) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'plans',     (select count(*) from public.revision_plans),
    'done',      (select count(*) from public.revision_plans where status = 'done'),
    'missed',    (select count(*) from public.revision_plans where status = 'missed'),
    'rate30',    (select round(100.0 * count(*) filter (where status = 'done') / nullif(count(*), 0))
                    from public.revision_plans where status <> 'planned' and plan_date > current_date - 30),
    'active7',   (select count(distinct user_id) from public.revision_plans where plan_date > current_date - 7),
    'active30',  (select count(distinct user_id) from public.revision_plans where plan_date > current_date - 30),
    'pages_learned', (select coalesce(sum(end_no - start_no + 1), 0) from public.revision_plans
                       where kind = 'hifz' and unit = 'page' and status = 'done'),
    'daily', coalesce((select jsonb_agg(jsonb_build_array(d, n, k) order by d) from (
        select to_char(plan_date, 'YYYY-MM-DD') d, count(*) n, count(*) filter (where status = 'done') k
        from public.revision_plans where plan_date > current_date - 30 group by 1) x), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(jsonb_build_array(w, n, k) order by w) from (
        select to_char(date_trunc('week', plan_date), 'YYYY-MM-DD') w, count(*) n, count(*) filter (where status = 'done') k
        from public.revision_plans where plan_date > current_date - 84 group by 1) x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_array(m, n, k) order by m) from (
        select to_char(date_trunc('month', plan_date), 'YYYY-MM') m, count(*) n, count(*) filter (where status = 'done') k
        from public.revision_plans where plan_date > current_date - 365 group by 1) x), '[]'::jsonb),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (
        select kind, count(*) n from public.revision_plans group by 1) x), '{}'::jsonb),
    'by_unit', coalesce((select jsonb_object_agg(unit, n) from (
        select unit, count(*) n from public.revision_plans group by 1) x), '{}'::jsonb),
    'by_assiduity', coalesce((select jsonb_object_agg(assiduity, n) from (
        select assiduity, count(*) n from public.profiles group by 1) x), '{}'::jsonb)
  );
end $$;

-- 8. Droits
revoke execute on function public.set_revision_plan(text, date, text, int, int), public.mark_revision_done(text, date, boolean),
  public.delete_revision_plan(text, date), public.revision_stats(uuid), public.admin_revision_stats() from public, anon;
grant execute on function public.set_revision_plan(text, date, text, int, int), public.mark_revision_done(text, date, boolean),
  public.delete_revision_plan(text, date), public.revision_stats(uuid), public.admin_revision_stats() to authenticated;
revoke execute on function private.hizb_pages(text), private.hifz_map(uuid), private.sync_hizb_memorized(uuid),
  private.refresh_assiduity(uuid) from public, anon, authenticated;
