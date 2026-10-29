-- =====================================================================
-- Sahib Qurani V4 : programme de révision quotidien + évaluation d'assiduité
-- À coller tel quel dans Supabase → SQL Editor → Run.
--
-- Unités (codes) et numérotation globale :
--   surah 1–114 · hizb 1–60 · nisf 1–120 · rub 1–240 · thumn 1–480 · page 1–604
--   ex. thumn 3 du hizb 12 = (12-1)*8 + 3 = 91 ; affichage « … du hizb … » côté site.
-- Statuts : planned / done / missed (missed posé automatiquement après le jour).
-- =====================================================================

-- 1. Table des programmes (un seul par membre et par jour)
create table if not exists public.revision_plans (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  plan_date  date not null,
  unit       text not null check (unit in ('surah','hizb','nisf','rub','thumn','page')),
  start_no   smallint not null,
  end_no     smallint not null,
  status     text not null default 'planned' check (status in ('planned','done','missed')),
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date),
  check (start_no >= 1 and start_no <= end_no and end_no <= case unit
           when 'surah' then 114 when 'hizb' then 60 when 'nisf' then 120
           when 'rub' then 240 when 'thumn' then 480 else 604 end)
);
create index if not exists revision_plans_date_idx on public.revision_plans (plan_date);
alter table public.revision_plans enable row level security;

-- Lecture : moi, ou mon partenaire actif. Écriture uniquement par les fonctions ci-dessous.
revoke all on public.revision_plans from anon, authenticated;
grant select on public.revision_plans to authenticated;

create or replace function private.is_active_partner(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.requests r
                 where r.status = 'accepted'
                   and ((r.sender_id = auth.uid() and r.receiver_id = p_other)
                     or (r.receiver_id = auth.uid() and r.sender_id = p_other)));
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_active_partner(uuid) to authenticated;

drop policy if exists revision_plans_select on public.revision_plans;
create policy revision_plans_select on public.revision_plans for select to authenticated
  using (user_id = (select auth.uid()) or private.is_active_partner(user_id));

-- 2. Jour local du membre (fuseau du téléphone, sinon UTC)
create or replace function private.member_today(p_user uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare tz text;
begin
  select timezone into tz from public.profiles where id = p_user;
  return (now() at time zone coalesce(tz, 'UTC'))::date;
exception when others then
  return (now() at time zone 'UTC')::date;
end $$;

-- 3. Évaluation d'assiduité (visible sur la fiche et dans la recherche)
--    30 derniers jours, à partir de 7 programmes : top ≥ 80 %, good 50–79 %, low < 50 %, sinon new
alter table public.profiles add column if not exists assiduity text not null default 'new'
  check (assiduity in ('new','top','good','low'));
alter table public.profiles add column if not exists assiduity_rate smallint
  check (assiduity_rate is null or assiduity_rate between 0 and 100);
alter table public.profiles add column if not exists revision_streak smallint not null default 0;
revoke insert (assiduity, assiduity_rate, revision_streak),
       update (assiduity, assiduity_rate, revision_streak) on public.profiles from anon, authenticated;
grant select (assiduity, assiduity_rate, revision_streak) on public.profiles to authenticated;

create or replace function private.refresh_assiduity(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today  date := private.member_today(p_user);
  n_all  int; n_done int; rate int; lvl text; streak int := 0; d date;
begin
  -- jours terminés (avant aujourd'hui) + aujourd'hui s'il est déjà accompli
  select count(*), count(*) filter (where status = 'done')
    into n_all, n_done
    from public.revision_plans
   where user_id = p_user and plan_date > today - 30
     and (plan_date < today or (plan_date = today and status = 'done'));
  rate := case when n_all > 0 then round(100.0 * n_done / n_all) end;
  lvl  := case when n_all < 7 then 'new' when rate >= 80 then 'top' when rate >= 50 then 'good' else 'low' end;

  -- jours d'affilée accomplis (aujourd'hui compte s'il est fait, sinon on part d'hier)
  d := case when exists (select 1 from public.revision_plans
                          where user_id = p_user and plan_date = today and status = 'done')
            then today else today - 1 end;
  while exists (select 1 from public.revision_plans where user_id = p_user and plan_date = d and status = 'done') loop
    streak := streak + 1; d := d - 1;
    exit when streak >= 3650;
  end loop;

  update public.profiles set assiduity = lvl, assiduity_rate = rate, revision_streak = streak
   where id = p_user
     and (assiduity, assiduity_rate, revision_streak) is distinct from (lvl, rate, streak);
end $$;

-- 4. Fixer (ou modifier) le programme d'aujourd'hui ou de demain
create or replace function public.set_revision_plan(p_date date, p_unit text, p_start int, p_end int)
returns public.revision_plans
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); today date; r public.revision_plans;
begin
  if me is null then raise exception 'auth'; end if;
  today := private.member_today(me);
  if p_date is null or p_date not in (today, today + 1) then raise exception 'bad_date' using errcode = 'P0001'; end if;
  if exists (select 1 from public.revision_plans
              where user_id = me and plan_date = p_date and status <> 'planned') then
    raise exception 'already_done' using errcode = 'P0001';
  end if;
  insert into public.revision_plans (user_id, plan_date, unit, start_no, end_no)
  values (me, p_date, p_unit, p_start, p_end)
  on conflict (user_id, plan_date) do update
     set unit = excluded.unit, start_no = excluded.start_no, end_no = excluded.end_no, updated_at = now()
  returning * into r;
  return r;
end $$;

-- 5. Marquer « Accompli » (ou annuler le jour même)
create or replace function public.mark_revision_done(p_date date, p_done boolean default true)
returns public.revision_plans
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.revision_plans;
begin
  if me is null then raise exception 'auth'; end if;
  if p_date is distinct from private.member_today(me) then raise exception 'bad_date' using errcode = 'P0001'; end if;
  update public.revision_plans
     set status  = case when p_done then 'done' else 'planned' end,
         done_at = case when p_done then now() end,
         updated_at = now()
   where user_id = me and plan_date = p_date
  returning * into r;
  if r.id is null then raise exception 'no_plan' using errcode = 'P0001'; end if;
  perform private.refresh_assiduity(me);
  return r;
end $$;

-- 6. Supprimer le programme de demain (ou d'aujourd'hui s'il n'est pas accompli)
create or replace function public.delete_revision_plan(p_date date) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); today date;
begin
  if me is null then raise exception 'auth'; end if;
  today := private.member_today(me);
  delete from public.revision_plans
   where user_id = me and plan_date = p_date and plan_date >= today and status = 'planned';
  return found;
end $$;

-- 7. Clôture quotidienne : jours passés non accomplis → missed, puis mise à jour des évaluations
create or replace function public.close_revision_days() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int; u uuid;
begin
  update public.revision_plans p set status = 'missed', updated_at = now()
   where p.status = 'planned' and p.plan_date < private.member_today(p.user_id);
  get diagnostics n = row_count;
  for u in select distinct user_id from public.revision_plans
            where plan_date > (now() at time zone 'UTC')::date - 32 loop
    perform private.refresh_assiduity(u);
  end loop;
  return n;
end $$;
revoke execute on function public.close_revision_days() from public, anon, authenticated;

-- Tâche planifiée toutes les heures (fuseaux différents). Si pg_cron n'est pas disponible,
-- un message s'affiche : activer « pg_cron » dans Database → Extensions puis relancer ce bloc.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'sq_close_revision_days';
  perform cron.schedule('sq_close_revision_days', '5 * * * *', 'select public.close_revision_days()');
exception when others then
  raise notice 'pg_cron indisponible : %', sqlerrm;
end $$;

-- 8. Mes statistiques (et celles de mon partenaire actif)
create or replace function public.revision_stats(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := coalesce(p_user, auth.uid()); today date;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if u <> auth.uid() and not private.is_active_partner(u) then raise exception 'forbidden'; end if;
  perform private.refresh_assiduity(u);
  today := private.member_today(u);
  return (select jsonb_build_object(
    'today',     today,
    'assiduity', pr.assiduity,
    'rate30',    pr.assiduity_rate,
    'streak',    pr.revision_streak,
    'done_total',(select count(*) from public.revision_plans where user_id = u and status = 'done'),
    'planned_total',(select count(*) from public.revision_plans where user_id = u),
    -- volume révisé en hizb (les sourates ne sont pas converties)
    'hizb_total',(select coalesce(round(sum((end_no - start_no + 1) * case unit
                     when 'hizb' then 1.0 when 'nisf' then 0.5 when 'rub' then 0.25
                     when 'thumn' then 0.125 when 'page' then 60.0 / 604 else 0 end), 1), 0)
                  from public.revision_plans where user_id = u and status = 'done'),
    'days', coalesce((select jsonb_agg(jsonb_build_object('d', plan_date, 's',
                       case when status = 'planned' and plan_date < today then 'missed' else status end)
                       order by plan_date)
                      from public.revision_plans where user_id = u and plan_date > today - 35), '[]'::jsonb))
    from public.profiles pr where pr.id = u);
end $$;

-- 9. Statistiques ADMIN (totaux seulement, jamais de noms)
create or replace function public.admin_revision_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.is_admin(), false) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'plans',     (select count(*) from public.revision_plans),
    'done',      (select count(*) from public.revision_plans where status = 'done'),
    'missed',    (select count(*) from public.revision_plans where status = 'missed'),
    'rate30',    (select round(100.0 * count(*) filter (where status = 'done') / nullif(count(*), 0))
                    from public.revision_plans
                   where status <> 'planned' and plan_date > current_date - 30),
    'active7',   (select count(distinct user_id) from public.revision_plans where plan_date > current_date - 7),
    'active30',  (select count(distinct user_id) from public.revision_plans where plan_date > current_date - 30),
    'daily', coalesce((select jsonb_agg(jsonb_build_array(d, n, k) order by d) from (
        select to_char(plan_date, 'YYYY-MM-DD') d, count(*) n, count(*) filter (where status = 'done') k
        from public.revision_plans where plan_date > current_date - 30 group by 1) x), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(jsonb_build_array(w, n, k) order by w) from (
        select to_char(date_trunc('week', plan_date), 'YYYY-MM-DD') w, count(*) n, count(*) filter (where status = 'done') k
        from public.revision_plans where plan_date > current_date - 84 group by 1) x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_array(m, n, k) order by m) from (
        select to_char(date_trunc('month', plan_date), 'YYYY-MM') m, count(*) n, count(*) filter (where status = 'done') k
        from public.revision_plans where plan_date > current_date - 365 group by 1) x), '[]'::jsonb),
    'by_unit', coalesce((select jsonb_object_agg(unit, n) from (
        select unit, count(*) n from public.revision_plans group by 1) x), '{}'::jsonb),
    'by_assiduity', coalesce((select jsonb_object_agg(assiduity, n) from (
        select assiduity, count(*) n from public.profiles group by 1) x), '{}'::jsonb)
  );
end $$;

revoke execute on function public.set_revision_plan(date, text, int, int), public.mark_revision_done(date, boolean),
  public.delete_revision_plan(date), public.revision_stats(uuid), public.admin_revision_stats() from public, anon;
grant execute on function public.set_revision_plan(date, text, int, int), public.mark_revision_done(date, boolean),
  public.delete_revision_plan(date), public.revision_stats(uuid), public.admin_revision_stats() to authenticated;
revoke execute on function private.member_today(uuid), private.refresh_assiduity(uuid) from public, anon, authenticated;
