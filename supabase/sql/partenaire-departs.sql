-- =====================================================================
-- Sahib Qurani : horloges, un seul partenaire actif, fin de partenariat,
-- signalements conservés, départs anonymes (statistiques).
-- À coller tel quel dans Supabase → SQL Editor → Run.
-- =====================================================================

-- 1. Fuseau horaire du membre (réglage du téléphone, jamais de GPS)
alter table public.profiles add column if not exists timezone text
  check (timezone is null or (char_length(timezone) <= 64 and timezone ~ '^[A-Za-z0-9_+/-]+$'));
grant select (timezone), insert (timezone), update (timezone) on public.profiles to authenticated;

-- 2. Nouveau statut « ended » (partenariat terminé)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.requests'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%cancelled%'
  loop
    execute format('alter table public.requests drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.requests add constraint requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'ended'));

-- 3. Un seul partenaire actif à la fois (pour les deux membres)
create or replace function private.one_partner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.status = 'accepted' and old.status is distinct from 'accepted') then
    if exists (select 1 from public.requests r
               where r.status = 'accepted' and r.id <> new.id
                 and (r.sender_id in (new.sender_id, new.receiver_id)
                      or r.receiver_id in (new.sender_id, new.receiver_id))) then
      raise exception 'one_partner' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requests_one_partner on public.requests;
create trigger requests_one_partner before insert or update of status on public.requests
  for each row execute function private.one_partner();

-- 4. Terminer un partenariat (l'un ou l'autre des deux membres)
create or replace function public.end_partnership(p_request uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.requests set status = 'ended'
   where id = p_request and status = 'accepted'
     and (sender_id = auth.uid() or receiver_id = auth.uid());
  return found;
end $$;
revoke execute on function public.end_partnership(uuid) from public, anon;
grant execute on function public.end_partnership(uuid) to authenticated;

-- 5. Un avis reste possible après la fin du partenariat
create or replace function private.ever_partner(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.requests r
                 where r.status in ('accepted', 'ended')
                   and ((r.sender_id = auth.uid() and r.receiver_id = p_other)
                     or (r.receiver_id = auth.uid() and r.sender_id = p_other)));
$$;
grant usage on schema private to authenticated;
grant execute on function private.ever_partner(uuid) to authenticated;
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated
  with check (author_id = (select auth.uid()) and private.ever_partner(target_id));

-- 6. Suppression de compte : données effacées en cascade,
--    SAUF les signalements, gardés avec « compte supprimé »
do $$
declare c record;
begin
  for c in
    select con.conname, con.conrelid::regclass as tbl, con.confrelid::regclass as ref, con.confdeltype,
           (select attname from pg_attribute where attrelid = con.conrelid and attnum = con.conkey[1]) as col,
           (select attname from pg_attribute where attrelid = con.confrelid and attnum = con.confkey[1]) as refcol
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where con.contype = 'f' and n.nspname = 'public' and array_length(con.conkey, 1) = 1
      and con.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  loop
    if c.tbl = 'public.reports'::regclass then
      if c.confdeltype <> 'n' then
        execute format('alter table public.reports alter column %I drop not null', c.col);
        execute format('alter table public.reports drop constraint %I', c.conname);
        execute format('alter table public.reports add constraint %I foreign key (%I) references %s(%I) on delete set null',
                       c.conname, c.col, c.ref, c.refcol);
      end if;
    elsif c.confdeltype not in ('c', 'n') then
      execute format('alter table %s drop constraint %I', c.tbl, c.conname);
      execute format('alter table %s add constraint %I foreign key (%I) references %s(%I) on delete cascade',
                     c.tbl, c.conname, c.col, c.ref, c.refcol);
    end if;
  end loop;
end $$;

-- 7. Départs anonymes (aucun nom, aucun contact, aucune ville)
create table if not exists public.departures (
  id          bigint generated always as identity primary key,
  left_at     timestamptz not null default now(),
  country     text,
  gender      text,
  age_range   text,
  level       text,
  days_member integer,
  had_partner boolean,
  reason      text
);
create table if not exists public.leave_reasons (
  user_id    uuid primary key,
  reason     text not null check (reason in ('found_partner','no_time','no_match','not_useful','privacy','other')),
  created_at timestamptz not null default now()
);
alter table public.departures    enable row level security;
alter table public.leave_reasons enable row level security;
revoke all on public.departures, public.leave_reasons from anon, authenticated;

create or replace function public.set_leave_reason(p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_reason is null
     or p_reason not in ('found_partner','no_time','no_match','not_useful','privacy','other') then return; end if;
  insert into public.leave_reasons (user_id, reason) values (auth.uid(), p_reason)
  on conflict (user_id) do update set reason = excluded.reason, created_at = now();
end $$;

create or replace function private.record_departure() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.departures (country, gender, age_range, level, days_member, had_partner, reason)
  values (old.country, old.gender, old.age_range, old.level,
          greatest(0, extract(day from now() - old.created_at))::int,
          exists (select 1 from public.requests r where r.status in ('accepted', 'ended')
                  and (r.sender_id = old.id or r.receiver_id = old.id)),
          (select reason from public.leave_reasons where user_id = old.id));
  delete from public.leave_reasons where user_id = old.id;
  return old;
end $$;
drop trigger if exists profiles_record_departure on public.profiles;
create trigger profiles_record_departure before delete on public.profiles
  for each row execute function private.record_departure();

-- Suppression de mon compte (tout part en cascade, sauf signalements et départ anonyme)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth'; end if;
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
end $$;

-- 8. Statistiques des départs : ADMIN UNIQUEMENT
create or replace function public.admin_departure_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'total',       (select count(*) from public.departures),
    'week',        (select count(*) from public.departures where left_at > now() - interval '7 days'),
    'avg_days',    (select coalesce(round(avg(days_member)), 0) from public.departures),
    'had_partner', (select count(*) from public.departures where had_partner),
    'weekly', coalesce((select jsonb_agg(jsonb_build_array(w, n) order by w) from (
        select to_char(date_trunc('week', left_at), 'YYYY-MM-DD') w, count(*) n
        from public.departures where left_at > now() - interval '12 weeks' group by 1) x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_array(m, n) order by m) from (
        select to_char(date_trunc('month', left_at), 'YYYY-MM') m, count(*) n
        from public.departures where left_at > now() - interval '12 months' group by 1) x), '[]'::jsonb),
    'by_reason',  coalesce((select jsonb_object_agg(coalesce(reason, 'none'), n) from (
        select reason, count(*) n from public.departures group by 1) x), '{}'::jsonb),
    'by_country', coalesce((select jsonb_object_agg(country, n) from (
        select country, count(*) n from public.departures where country is not null group by 1) x), '{}'::jsonb),
    'by_gender',  coalesce((select jsonb_object_agg(gender, n) from (
        select gender, count(*) n from public.departures where gender is not null group by 1) x), '{}'::jsonb),
    'by_age',     coalesce((select jsonb_object_agg(age_range, n) from (
        select age_range, count(*) n from public.departures where age_range is not null group by 1) x), '{}'::jsonb)
  );
end $$;

revoke execute on function public.set_leave_reason(text), public.delete_my_account(),
  public.admin_departure_stats() from public, anon;
grant execute on function public.set_leave_reason(text), public.delete_my_account(),
  public.admin_departure_stats() to authenticated;
