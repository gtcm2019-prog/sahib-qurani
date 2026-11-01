-- ============================================================================
-- Sahib Qurani – V6 : comptes adultes + profils de la famille (jusqu'à 20)
-- À exécuter UNE FOIS dans Supabase → SQL Editor (tout le fichier d'un coup).
--
-- Principe :
--  * Un compte (auth.users) = un adulte. Son profil principal garde l'id du compte.
--  * Il peut ajouter jusqu'à 19 autres profils (enfants, conjoint…) : profiles.owner_id = le compte.
--  * Le site indique le profil actif dans l'en-tête HTTP « x-sq-profile ».
--    private.me() = ce profil s'il appartient bien au compte, sinon l'id du compte (sans en-tête).
--  * Toutes les règles restent par PROFIL : même genre, mineurs entre eux, un seul partenaire, blocages.
--  * Compatible avec le site actuel (sans en-tête, private.me() = auth.uid(), comme avant).
-- ============================================================================
begin;

-- 1. Propriétaire de chaque profil -------------------------------------------------
alter table public.profiles add column if not exists owner_id uuid;
update public.profiles set owner_id = id where owner_id is null;
alter table public.profiles alter column owner_id set default auth.uid();
alter table public.profiles alter column owner_id set not null;
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles drop constraint if exists profiles_owner_id_fkey;
alter table public.profiles add constraint profiles_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;
alter table public.profiles alter column id set default gen_random_uuid();
create index if not exists profiles_owner_idx on public.profiles (owner_id);

-- 2. Profil actif et propriété ----------------------------------------------------
create or replace function private.me() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); h text; p uuid;
begin
  if u is null then return null; end if;
  begin
    h := nullif(current_setting('request.headers', true), '')::json ->> 'x-sq-profile';
  exception when others then h := null;
  end;
  if h is null or h = '' then return u; end if;
  begin p := h::uuid; exception when others then return null; end;
  if p = u or exists (select 1 from public.profiles where id = p and owner_id = u) then return p; end if;
  return null;   -- profil qui n'est pas à moi : aucun droit
end $$;

create or replace function private.owns(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and (p = (select auth.uid())
    or exists (select 1 from public.profiles where id = p and owner_id = (select auth.uid())));
$$;

create or replace function private.is_account(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users where id = p);
$$;

grant execute on function private.me(), private.owns(uuid), private.is_account(uuid) to authenticated;

-- 3. Fonctions d'aide : « moi » = le profil actif ---------------------------------
create or replace function private.blocked_with(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = (select private.me()) and b.blocked_id = p_other)
       or (b.blocker_id = p_other and b.blocked_id = (select private.me()))
  );
$$;

create or replace function private.ever_partner(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.requests r
                 where r.status in ('accepted', 'ended')
                   and ((r.sender_id = (select private.me()) and r.receiver_id = p_other)
                     or (r.receiver_id = (select private.me()) and r.sender_id = p_other)));
$$;

create or replace function private.i_am_minor() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.minor_age(p.age_range)
                   from public.profiles p where p.id = (select private.me())), false)
$$;

create or replace function private.is_active_partner(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.requests r
                 where r.status = 'accepted'
                   and ((r.sender_id = (select private.me()) and r.receiver_id = p_other)
                     or (r.receiver_id = (select private.me()) and r.sender_id = p_other)));
$$;

create or replace function private.my_gender() returns text
language sql stable security definer set search_path = '' as $$
  select p.gender from public.profiles p where p.id = (select private.me())
$$;

create or replace function private.partner_of(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    where r.status = 'accepted'
      and ((r.sender_id = (select private.me()) and r.receiver_id = p_other)
        or (r.sender_id = p_other and r.receiver_id = (select private.me())))
  );
$$;

-- 4. Garde-fous à la création d'un profil -----------------------------------------
create or replace function private.family_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or private.is_admin() then return new; end if;
  new.owner_id := u;
  if new.id = u then
    -- profil principal = le compte : adulte obligatoire
    if private.minor_age(new.age_range) then
      raise exception 'account_adult_only' using errcode = 'P0001';
    end if;
  else
    if not exists (select 1 from public.profiles where id = u) then
      raise exception 'account_first' using errcode = 'P0001';
    end if;
    if (select count(*) from public.profiles where owner_id = u) >= 20 then
      raise exception 'too_many_profiles' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_family_guard on public.profiles;
create trigger profiles_family_guard before insert on public.profiles
  for each row execute function private.family_guard();

-- 5. Règles d'accès (RLS) -----------------------------------------------------------
alter policy profiles_select on public.profiles using (
  owner_id = (select auth.uid()) or private.is_admin() or private.partner_of(id)
  or (not is_paused and badge is distinct from 'banned' and not private.blocked_with(id)
      and private.minor_age(age_range) = private.i_am_minor() and gender = private.my_gender()));
alter policy profiles_insert on public.profiles with check (
  owner_id = (select auth.uid())
  and (id = (select auth.uid()) or not private.is_account(id)));
alter policy profiles_update on public.profiles
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

alter policy private_select on public.profiles_private
  using (private.owns(id) or private.is_admin() or private.partner_of(id));
alter policy private_insert on public.profiles_private with check (private.owns(id));
alter policy private_update on public.profiles_private
  using (private.owns(id)) with check (private.owns(id));

alter policy requests_select on public.requests
  using (private.owns(sender_id) or private.owns(receiver_id) or private.is_admin());
alter policy requests_answer on public.requests
  using (receiver_id = (select private.me()) and status = 'pending')
  with check (receiver_id = (select private.me()) and status in ('accepted', 'declined'));
alter policy requests_cancel on public.requests
  using (sender_id = (select private.me()) and status in ('pending', 'accepted'))
  with check (sender_id = (select private.me()) and status = 'cancelled');
alter policy requests_insert on public.requests with check (
  sender_id = (select private.me())
  and not private.blocked_with(receiver_id)
  and exists (select 1 from public.profiles p
              where p.id = requests.receiver_id and not p.is_paused
                and p.badge is distinct from 'banned'
                and private.minor_age(p.age_range) = private.i_am_minor()
                and p.gender = private.my_gender())
  and not exists (select 1 from public.profiles me
                  where me.id = (select private.me()) and me.badge = 'banned'));

alter policy reviews_select on public.reviews
  using (private.owns(author_id) or private.owns(target_id) or private.is_admin());
alter policy reviews_insert on public.reviews
  with check (author_id = (select private.me()) and private.ever_partner(target_id));
alter policy reviews_update on public.reviews
  using (author_id = (select private.me())) with check (author_id = (select private.me()));

alter policy reports_insert on public.reports with check (reporter_id = (select private.me()));
alter policy reports_select on public.reports using (private.owns(reporter_id) or private.is_admin());

alter policy blocks_select on public.blocks using (blocker_id = (select private.me()));
alter policy blocks_insert on public.blocks with check (blocker_id = (select private.me()));
alter policy blocks_delete on public.blocks using (blocker_id = (select private.me()));

alter policy revision_plans_select on public.revision_plans
  using (private.owns(user_id) or private.is_active_partner(user_id));

-- 6. Fonctions appelées par le site --------------------------------------------------
create or replace function public.delete_revision_plan(p_kind text, p_date date) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me();
begin
  if me is null then raise exception 'auth'; end if;
  delete from public.revision_plans
   where user_id = me and kind = p_kind and plan_date = p_date
     and plan_date >= private.member_today(me) and status = 'planned';
  return found;
end $$;

create or replace function public.end_partnership(p_request uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me();
begin
  update public.requests set status = 'ended'
   where id = p_request and status = 'accepted'
     and (sender_id = me or receiver_id = me);
  return found;
end $$;

create or replace function public.get_my_blocks()
returns table(blocked_id uuid, first_name text, gender text, avatar text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.blocked_id, p.first_name, p.gender, p.avatar, b.created_at
  from public.blocks b left join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select private.me())
  order by b.created_at desc
$$;

create or replace function public.hide_my_review(p_review uuid, p_hidden boolean) returns void
language sql security definer set search_path = '' as $$
  update public.reviews set hidden_by_target = p_hidden
   where id = p_review and target_id = (select private.me());
$$;

create or replace function public.mark_revision_done(p_kind text, p_date date, p_done boolean default true)
returns public.revision_plans
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me(); r public.revision_plans;
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

create or replace function public.set_revision_plan(p_kind text, p_date date, p_unit text, p_start integer, p_end integer)
returns public.revision_plans
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me(); today date; r public.revision_plans;
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

create or replace function public.revision_stats(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.me(); u uuid := coalesce(p_user, private.me()); today date; m jsonb; res jsonb := '{}'; k text;
  streak int; d date;
begin
  if me is null then raise exception 'auth'; end if;
  if u <> me and not private.is_active_partner(u) and not private.owns(u) then raise exception 'forbidden'; end if;
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

-- Pseudo : p_new = true pour un NOUVEAU profil de la famille (aucun profil à exclure)
drop function if exists public.pseudo_status(text);
create or replace function public.pseudo_status(p_name text, p_new boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u     uuid := auth.uid();
  me    uuid := case when p_new then null else private.me() end;
  n     text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 50);
  base  text; town text; cand text; res text[] := '{}'; tries int := 0;
begin
  if u is null then raise exception 'not authenticated'; end if;
  if n = '' then return jsonb_build_object('free', false, 'suggestions', '[]'::jsonb); end if;
  if not exists (select 1 from public.profiles p
                 where lower(btrim(p.first_name)) = lower(n) and p.id is distinct from me) then
    return jsonb_build_object('free', true);
  end if;
  base := left(replace(n, ' ', '_'), 40);
  select left(split_part(btrim(p.city), ' ', 1), 4) into town from public.profiles p where p.id = coalesce(me, u);
  foreach cand in array array[
    base || extract(year from now())::int::text,
    case when coalesce(town, '') <> '' then base || '_' || initcap(town) end
  ] loop
    if cand is not null and not exists (select 1 from public.profiles p
        where lower(btrim(p.first_name)) = lower(cand) and p.id is distinct from me) then
      res := res || cand;
    end if;
  end loop;
  while coalesce(array_length(res, 1), 0) < 3 and tries < 40 loop
    tries := tries + 1;
    cand := base || '_' || (10 + floor(random() * 90))::int::text;
    if not (cand = any(res)) and not exists (select 1 from public.profiles p
        where lower(btrim(p.first_name)) = lower(cand) and p.id is distinct from me) then
      res := res || cand;
    end if;
  end loop;
  return jsonb_build_object('free', false, 'suggestions', to_jsonb(res));
end $$;
grant execute on function public.pseudo_status(text, boolean) to authenticated;

-- Suppression du compte : le compte ET tous ses profils
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'auth'; end if;
  delete from public.profiles where owner_id = u and id <> u;
  delete from public.profiles where id = u;
  delete from auth.users where id = u;
end $$;

-- Suppression d'UN profil de la famille (jamais le profil principal)
create or replace function public.delete_family_profile(p_profile uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'auth'; end if;
  delete from public.profiles where id = p_profile and owner_id = u and id <> u;
  return found;
end $$;
revoke all on function public.delete_family_profile(uuid) from public, anon;
grant execute on function public.delete_family_profile(uuid) to authenticated;

-- Profils du compte (sélecteur) : demandes en attente par profil
create or replace function public.my_profiles()
returns table(id uuid, first_name text, gender text, age_range text, avatar text, is_main boolean, pending bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.gender, p.age_range, p.avatar, p.id = (select auth.uid()),
         (select count(*) from public.requests r where r.receiver_id = p.id and r.status = 'pending')
  from public.profiles p
  where p.owner_id = (select auth.uid())
  order by (p.id = (select auth.uid())) desc, p.created_at
$$;
revoke all on function public.my_profiles() from public, anon;
grant execute on function public.my_profiles() to authenticated;

commit;

notify pgrst, 'reload schema';

select 'Profils famille : OK' as resultat,
       (select count(*) from public.profiles where owner_id is null) as sans_proprietaire,
       (select count(*) from public.profiles where id = owner_id and private.minor_age(age_range)) as comptes_mineurs_existants;
