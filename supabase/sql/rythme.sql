-- =====================================================================
-- Sahib Qurani V6 : « Mon rythme » — chaque membre fixe son engagement,
-- l'assiduité est calculée par rapport à cet engagement.
--   Apprentissage : quantité + unité (page ou thumn) + période (jour, 2 jours, semaine)
--   Révision      : unité (sourate, hizb ou juz) + quantité chaque jour
-- Note sur 30 jours : apprentissage = quantité apprise ÷ quantité promise (max 100 %) ;
-- révision = jours où la quantité est atteinte ÷ jours écoulés ; note = moyenne des deux.
-- Sans rythme : ancien calcul (programmes accomplis ÷ programmes fixés).
-- Chaque profil de la famille a son propre rythme (profil actif = private.me()).
-- À exécuter APRÈS profils-famille.sql. À coller tel quel dans Supabase → SQL Editor → Run.
-- =====================================================================

-- 1. Table des rythmes (historique : chaque changement crée une ligne datée)
create table if not exists public.rhythms (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  valid_from   date not null,
  hifz_unit    text check (hifz_unit in ('page','thumn')),
  hifz_qty     smallint check (hifz_qty between 1 and 60),
  hifz_period  text check (hifz_period in ('day','2days','week')),
  muraja_unit  text check (muraja_unit in ('surah','hizb','juz')),
  muraja_qty   smallint check (muraja_qty between 1 and 30),
  created_at   timestamptz not null default now(),
  primary key (user_id, valid_from),
  check ((hifz_unit is null) = (hifz_qty is null) and (hifz_unit is null) = (hifz_period is null)),
  check ((muraja_unit is null) = (muraja_qty is null)),
  check (hifz_unit is not null or muraja_unit is not null)
);
alter table public.rhythms enable row level security;
revoke all on public.rhythms from anon, authenticated;
grant select on public.rhythms to authenticated;
drop policy if exists rhythms_select on public.rhythms;
create policy rhythms_select on public.rhythms for select to authenticated
  using (private.owns(user_id) or private.is_active_partner(user_id));

-- 2. Outils
-- Rythme en vigueur un jour donné
create or replace function private.rhythm_on(p_user uuid, p_day date) returns public.rhythms
language sql stable security definer set search_path = '' as $$
  select * from public.rhythms where user_id = p_user and valid_from <= p_day
   order by valid_from desc limit 1;
$$;

-- Conversion d'une quantité d'une unité vers une autre (null = pas convertible)
create or replace function private.unit_qty(p_from text, p_n numeric, p_to text) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_from = p_to then p_n
    when p_from = 'page'  and p_to = 'thumn' then p_n * 480 / 604
    when p_from = 'thumn' and p_to = 'page'  then p_n * 604 / 480
    when p_from = 'hizb'  and p_to = 'juz'   then p_n / 2
    when p_from = 'juz'   and p_to = 'hizb'  then p_n * 2
  end;
$$;

-- Quantité accomplie un jour donné, dans l'unité demandée.
-- Révision par sourate quand le rythme est en hizb/juz (ou l'inverse) : le jour compte comme atteint.
create or replace function private.done_qty(p_user uuid, p_day date, p_kind text, p_unit text) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when bool_or(private.unit_qty(unit, end_no - start_no + 1, p_unit) is null) then 9999
              else coalesce(sum(private.unit_qty(unit, end_no - start_no + 1, p_unit)), 0) end
    from public.revision_plans
   where user_id = p_user and plan_date = p_day and kind = p_kind and status = 'done';
$$;

create or replace function private.period_days(p text) returns int
language sql immutable set search_path = '' as $$
  select case p when 'day' then 1 when '2days' then 2 else 7 end;
$$;

-- 3. Évaluation selon le rythme (30 derniers jours, depuis le premier rythme)
create or replace function private.rhythm_eval(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := private.member_today(p_user);
  first_day date; s date; d date; r public.rhythms; q numeric;
  ach_h numeric := 0; tgt_h numeric := 0; nd int := 0; nok int := 0;
  rate_h int; rate_m int; rate int;
begin
  select min(valid_from) into first_day from public.rhythms where user_id = p_user;
  if first_day is null then return null; end if;
  s := greatest(today - 29, first_day);
  d := s;
  while d <= today loop
    r := private.rhythm_on(p_user, d);
    if r.hifz_unit is not null then
      ach_h := ach_h + private.done_qty(p_user, d, 'hifz', r.hifz_unit);
      if d < today then tgt_h := tgt_h + r.hifz_qty::numeric / private.period_days(r.hifz_period); end if;
    end if;
    if r.muraja_unit is not null then
      q := private.done_qty(p_user, d, 'muraja', r.muraja_unit);
      if d < today then
        nd := nd + 1; if q >= r.muraja_qty then nok := nok + 1; end if;
      elsif q >= r.muraja_qty then
        nd := nd + 1; nok := nok + 1;          -- aujourd'hui compte seulement s'il est atteint
      end if;
    end if;
    d := d + 1;
  end loop;
  rate_h := case when tgt_h > 0 then least(100, round(100 * ach_h / tgt_h)) end;
  rate_m := case when nd > 0 then round(100.0 * nok / nd) end;
  rate := case when rate_h is null then rate_m when rate_m is null then rate_h
               else round((rate_h + rate_m) / 2.0) end;
  return jsonb_build_object('rate', rate, 'rate_hifz', rate_h, 'rate_muraja', rate_m,
                            'days', today - first_day);
end $$;

-- 4. Évaluation du profil : rythme si le membre en a un, sinon ancien calcul
create or replace function private.refresh_assiduity(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := private.member_today(p_user);
  n_all int; n_done int; rate int; lvl text; streak int := 0; d date; ev jsonb;
  day_ok constant text := 'select exists (select 1 from public.revision_plans where user_id = $1 and plan_date = $2)
     and not exists (select 1 from public.revision_plans where user_id = $1 and plan_date = $2 and status <> ''done'')';
  ok boolean;
begin
  ev := private.rhythm_eval(p_user);
  if ev is not null then
    rate := (ev->>'rate')::int;
    lvl  := case when rate is null or (ev->>'days')::int < 7 then 'new'
                 when rate >= 80 then 'top' when rate >= 50 then 'good' else 'low' end;
  else
    select count(*), count(*) filter (where status = 'done') into n_all, n_done
      from public.revision_plans
     where user_id = p_user and plan_date > today - 30
       and (plan_date < today or (plan_date = today and status = 'done'));
    rate := case when n_all > 0 then round(100.0 * n_done / n_all) end;
    lvl  := case when n_all < 7 then 'new' when rate >= 80 then 'top' when rate >= 50 then 'good' else 'low' end;
  end if;
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

-- 5. Fixer son rythme (une fois par semaine ; correction libre le jour même)
create or replace function public.set_rhythm(p_hifz_unit text, p_hifz_qty int, p_hifz_period text,
                                             p_muraja_unit text, p_muraja_qty int)
returns public.rhythms
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me(); today date; last_from date; r public.rhythms;
begin
  if me is null then raise exception 'auth'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'no_profile'; end if;
  today := private.member_today(me);
  select max(valid_from) into last_from from public.rhythms where user_id = me;
  if last_from is not null and last_from <> today and last_from > today - 7 then
    raise exception 'too_soon:%', last_from + 7 using errcode = 'P0001';
  end if;
  insert into public.rhythms (user_id, valid_from, hifz_unit, hifz_qty, hifz_period, muraja_unit, muraja_qty)
  values (me, today, p_hifz_unit, case when p_hifz_unit is not null then p_hifz_qty end,
          case when p_hifz_unit is not null then p_hifz_period end,
          p_muraja_unit, case when p_muraja_unit is not null then p_muraja_qty end)
  on conflict (user_id, valid_from) do update
     set hifz_unit = excluded.hifz_unit, hifz_qty = excluded.hifz_qty, hifz_period = excluded.hifz_period,
         muraja_unit = excluded.muraja_unit, muraja_qty = excluded.muraja_qty, created_at = now()
  returning * into r;
  perform private.refresh_assiduity(me);
  return r;
end $$;

-- 6. Rythme + avancement (moi ou mon partenaire actif)
create or replace function public.rhythm_status(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me(); u uuid := coalesce(p_user, private.me()); today date; r public.rhythms; ps date; pl int;
  h_done numeric := 0; d date; first_from date;
begin
  if me is null then raise exception 'auth'; end if;
  if u <> me and not private.is_active_partner(u) and not private.owns(u) then raise exception 'forbidden'; end if;
  today := private.member_today(u);
  r := private.rhythm_on(u, today);
  if r.user_id is null then return jsonb_build_object('today', today, 'rhythm', null); end if;
  select max(valid_from) into first_from from public.rhythms where user_id = u;
  if r.hifz_unit is not null then
    pl := private.period_days(r.hifz_period);
    ps := r.valid_from + ((today - r.valid_from) / pl) * pl;   -- début de la période en cours
    d := ps;
    while d <= today loop h_done := h_done + private.done_qty(u, d, 'hifz', r.hifz_unit); d := d + 1; end loop;
  end if;
  return jsonb_build_object(
    'today', today,
    'rhythm', to_jsonb(r) - 'user_id' - 'created_at',
    'next_change', case when first_from + 7 > today then first_from + 7 end,
    'hifz', case when r.hifz_unit is not null then jsonb_build_object(
              'from', ps, 'to', ps + pl - 1, 'done', round(least(h_done, 9999), 1), 'target', r.hifz_qty) end,
    'muraja', case when r.muraja_unit is not null then jsonb_build_object(
              'done', round(least(private.done_qty(u, today, 'muraja', r.muraja_unit), 9999), 1),
              'target', r.muraja_qty) end,
    'eval', private.rhythm_eval(u));
end $$;

-- 7. Clôture quotidienne : inclure aussi les membres qui ont un rythme (même sans programme)
create or replace function public.close_revision_days() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int; u uuid;
begin
  update public.revision_plans p set status = 'missed', updated_at = now()
   where p.status = 'planned' and p.plan_date < private.member_today(p.user_id);
  get diagnostics n = row_count;
  for u in select user_id from public.revision_plans
            where plan_date > (now() at time zone 'UTC')::date - 32
           union
           select user_id from public.rhythms loop
    perform private.refresh_assiduity(u);
  end loop;
  return n;
end $$;

-- 8. Droits
revoke execute on function public.set_rhythm(text, int, text, text, int), public.rhythm_status(uuid),
  public.close_revision_days() from public, anon;
revoke execute on function public.close_revision_days() from authenticated;
grant execute on function public.set_rhythm(text, int, text, text, int), public.rhythm_status(uuid) to authenticated;
revoke execute on function private.rhythm_on(uuid, date), private.unit_qty(text, numeric, text),
  private.done_qty(uuid, date, text, text), private.period_days(text), private.rhythm_eval(uuid),
  private.refresh_assiduity(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
