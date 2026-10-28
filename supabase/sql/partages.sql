-- =====================================================================
-- Sahib Qurani : traçabilité des partages + lien de parrainage
-- À coller tel quel dans Supabase → SQL Editor → Run.
-- Aucune table n'est lisible directement : tout passe par des fonctions
-- contrôlées. Les statistiques détaillées sont réservées à l'admin.
-- =====================================================================

-- 1. Code de parrainage personnel (6 caractères, ex. K7P2QX)
create table if not exists public.share_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_at timestamptz not null default now()
);

-- 2. Chaque appui sur « Partager »
create table if not exists public.share_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  lang       text not null check (lang in ('ar','fr','en','es')),
  created_at timestamptz not null default now()
);
create index if not exists share_events_user_idx on public.share_events (user_id);
create index if not exists share_events_date_idx on public.share_events (created_at);

-- 3. Visites arrivées par un lien de parrainage
create table if not exists public.ref_visits (
  id          bigint generated always as identity primary key,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists ref_visits_referrer_idx on public.ref_visits (referrer_id);

-- 4. Inscriptions obtenues grâce à un parrain (une seule par nouveau membre)
create table if not exists public.referrals (
  referred_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (referred_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.share_codes  enable row level security;
alter table public.share_events enable row level security;
alter table public.ref_visits   enable row level security;
alter table public.referrals    enable row level security;
revoke all on public.share_codes, public.share_events, public.ref_visits, public.referrals from anon, authenticated;

-- Mon code (créé au premier appel)
create or replace function public.get_my_share_code() returns text
language plpgsql security definer set search_path = '' as $$
declare v text; me uuid := auth.uid();
begin
  if me is null then raise exception 'auth'; end if;
  select code into v from public.share_codes where user_id = me;
  if v is not null then return v; end if;
  for i in 1..10 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
      into v from generate_series(1, 6);
    begin
      insert into public.share_codes (user_id, code) values (me, v);
      return v;
    exception when unique_violation then
      select code into v from public.share_codes where user_id = me;
      if v is not null then return v; end if;
    end;
  end loop;
  raise exception 'code';
end $$;

-- Enregistrer un partage (30 par jour et par membre au maximum)
create or replace function public.log_share(p_lang text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if p_lang is null or p_lang not in ('ar','fr','en','es') then p_lang := 'fr'; end if;
  if (select count(*) from public.share_events
      where user_id = me and created_at > now() - interval '1 day') >= 30 then return; end if;
  insert into public.share_events (user_id, lang) values (me, p_lang);
end $$;

-- Visite par un lien (visiteur anonyme accepté ; plafond anti-abus)
create or replace function public.track_ref_visit(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare r uuid;
begin
  select user_id into r from public.share_codes where code = upper(coalesce(p_code, ''));
  if r is null or r = auth.uid() then return; end if;
  if (select count(*) from public.ref_visits
      where referrer_id = r and created_at > now() - interval '1 hour') >= 200 then return; end if;
  insert into public.ref_visits (referrer_id) values (r);
end $$;

-- Rattacher un nouveau membre (compte de moins de 7 jours) à son parrain
create or replace function public.claim_referral(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r uuid; me uuid := auth.uid();
begin
  if me is null then return false; end if;
  select user_id into r from public.share_codes where code = upper(coalesce(p_code, ''));
  if r is null or r = me then return false; end if;
  if (select created_at from auth.users where id = me) < now() - interval '7 days' then return false; end if;
  insert into public.referrals (referred_id, referrer_id) values (me, r) on conflict do nothing;
  return found;
end $$;

-- Statistiques des partages : ADMIN UNIQUEMENT
create or replace function public.admin_share_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'shares',       (select count(*) from public.share_events),
    'shares_week',  (select count(*) from public.share_events where created_at > now() - interval '7 days'),
    'sharers',      (select count(distinct user_id) from public.share_events),
    'visits',       (select count(*) from public.ref_visits),
    'signups',      (select count(*) from public.referrals),
    'signups_week', (select count(*) from public.referrals where created_at > now() - interval '7 days'),
    'weekly', coalesce((select jsonb_agg(jsonb_build_array(w, n) order by w) from (
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') w, count(*) n
        from public.share_events where created_at > now() - interval '12 weeks' group by 1) x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_array(m, n) order by m) from (
        select to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) n
        from public.share_events where created_at > now() - interval '12 months' group by 1) x), '[]'::jsonb),
    'by_lang', coalesce((select jsonb_object_agg(lang, n) from (
        select lang, count(*) n from public.share_events group by 1) x), '{}'::jsonb),
    'by_country', coalesce((select jsonb_object_agg(country, n) from (
        select p.country, count(*) n from public.share_events s
        join public.profiles p on p.id = s.user_id where p.country is not null group by 1) x), '{}'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_array(city, country, n) order by n desc) from (
        select p.city, p.country, count(*) n from public.share_events s
        join public.profiles p on p.id = s.user_id
        where coalesce(p.city, '') <> '' group by 1, 2 order by 3 desc limit 15) x), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(to_jsonb(x) order by x.signups desc, x.shares desc, x.visits desc) from (
        select p.id, p.first_name, p.gender, p.avatar, p.badge, p.country, p.city,
          (select count(*) from public.share_events s where s.user_id = p.id) as shares,
          (select count(*) from public.ref_visits v where v.referrer_id = p.id) as visits,
          (select count(*) from public.referrals r where r.referrer_id = p.id) as signups
        from public.profiles p
        where exists (select 1 from public.share_events s where s.user_id = p.id)
           or exists (select 1 from public.referrals r where r.referrer_id = p.id)
        order by signups desc, shares desc limit 30) x), '[]'::jsonb)
  );
end $$;

revoke execute on function public.get_my_share_code(), public.log_share(text), public.track_ref_visit(text),
  public.claim_referral(text), public.admin_share_stats() from public, anon;
grant execute on function public.get_my_share_code(), public.log_share(text),
  public.claim_referral(text), public.admin_share_stats() to authenticated;
grant execute on function public.track_ref_visit(text) to anon, authenticated;
