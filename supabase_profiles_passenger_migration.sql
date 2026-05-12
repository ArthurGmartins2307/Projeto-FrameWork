-- HelpOn / FlightOn
-- Migration segura para trocar o perfil corporativo antigo por perfil de passageiro.
-- Execute no Supabase SQL Editor com uma conta com permissao de owner.
-- Nao altera auth.users e nao faz DROP TABLE em public.profiles.

begin;

-- 1) Backup simples da estrutura/dados atuais antes de remover colunas antigas.
create table if not exists public.profiles_legacy_backup as
select *
from public.profiles;

comment on table public.profiles_legacy_backup is
  'Backup criado antes da migracao do perfil corporativo para perfil de passageiro.';

-- 2) Garantias basicas da tabela principal.
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists legal_first_name text,
  add column if not exists last_name text,
  add column if not exists birth_date date,
  add column if not exists document_number text,
  add column if not exists document_country text,
  add column if not exists nationality text,
  add column if not exists gender text,
  add column if not exists phone_number text,
  add column if not exists country text,
  add column if not exists state text,
  add column if not exists city text,
  add column if not exists role text not null default 'user',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists phone_ext text;

-- 3) Backfill conservador para registros ja existentes.
-- O nome antigo full_name e reaproveitado quando existir. Demais campos recebem valores
-- neutros para permitir NOT NULL sem perder id/role nem quebrar FKs.
update public.profiles
set
  legal_first_name = coalesce(nullif(legal_first_name, ''), nullif(split_part(coalesce(full_name, ''), ' ', 1), ''), 'Nao informado'),
  last_name = coalesce(
    nullif(last_name, ''),
    nullif(trim(regexp_replace(coalesce(full_name, ''), '^\S+\s*', '')), ''),
    'Nao informado'
  ),
  birth_date = coalesce(birth_date, date '1900-01-01'),
  document_number = coalesce(nullif(document_number, ''), 'Nao informado'),
  document_country = coalesce(nullif(document_country, ''), 'Outro'),
  nationality = coalesce(nullif(nationality, ''), 'Outra'),
  phone_number = coalesce(nullif(phone_number, ''), nullif(phone_ext, ''), 'Nao informado'),
  country = coalesce(nullif(country, ''), 'Outro'),
  state = coalesce(nullif(state, ''), 'Nao informado'),
  city = coalesce(nullif(city, ''), 'Nao informado'),
  role = coalesce(nullif(role, ''), 'user'),
  full_name = coalesce(
    nullif(full_name, ''),
    trim(coalesce(legal_first_name, '') || ' ' || coalesce(last_name, ''))
  ),
  updated_at = now();

-- 4) Constraints dos novos campos.
alter table public.profiles
  alter column legal_first_name set not null,
  alter column last_name set not null,
  alter column birth_date set not null,
  alter column document_number set not null,
  alter column document_country set not null,
  alter column nationality set not null,
  alter column phone_number set not null,
  alter column country set not null,
  alter column state set not null,
  alter column city set not null,
  alter column role set not null,
  alter column role set default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_birth_date_not_future'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_birth_date_not_future check (birth_date <= current_date);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_allowed'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_allowed check (role in ('user', 'agent', 'admin'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_id_auth_users_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_auth_users_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- 5) Remove as colunas antigas, depois do backup.
alter table public.profiles
  drop column if exists employee_id,
  drop column if exists department,
  drop column if exists job_title,
  drop column if exists branch,
  drop column if exists block_floor,
  drop column if exists technical_level,
  drop column if exists privacy_terms_accepted,
  drop column if exists phone_ext;

-- 6) updated_at automatico.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- 7) Funcao auxiliar para RLS sem recursao direta em policies.
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'user'
  );
$$;

revoke all on function public.current_profile_role() from public;
grant execute on function public.current_profile_role() to authenticated;

-- 8) Protecao extra: usuario comum nao pode alterar role pelo client.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.role is null or public.current_profile_role() <> 'admin' then
      new.role := 'user';
    end if;
    return new;
  end if;

  if old.role is distinct from new.role and public.current_profile_role() <> 'admin' then
    raise exception 'Somente administradores podem alterar role.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_role on public.profiles;
create trigger trg_profiles_protect_role
before insert or update on public.profiles
for each row
execute function public.protect_profile_role();

-- 9) Trigger de criacao de perfil apos cadastro no Supabase Auth.
-- Se existir uma funcao antiga usando employee_id, department, phone_ext
-- ou technical_level, ela pode quebrar o signup com
-- "database error saving new user". Esta funcao usa apenas os campos novos.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  safe_birth_date date;
  safe_first_name text;
  safe_last_name text;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  safe_first_name := coalesce(nullif(trim(meta ->> 'legal_first_name'), ''), 'Nao informado');
  safe_last_name := coalesce(nullif(trim(meta ->> 'last_name'), ''), 'Nao informado');

  if coalesce(meta ->> 'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    safe_birth_date := (meta ->> 'birth_date')::date;
  else
    safe_birth_date := date '1900-01-01';
  end if;

  insert into public.profiles (
    id,
    legal_first_name,
    last_name,
    full_name,
    birth_date,
    document_number,
    document_country,
    nationality,
    gender,
    phone_number,
    country,
    state,
    city,
    role
  )
  values (
    new.id,
    safe_first_name,
    safe_last_name,
    coalesce(nullif(trim(meta ->> 'full_name'), ''), trim(safe_first_name || ' ' || safe_last_name)),
    safe_birth_date,
    coalesce(nullif(trim(meta ->> 'document_number'), ''), 'Nao informado'),
    coalesce(nullif(trim(meta ->> 'document_country'), ''), 'Outro'),
    coalesce(nullif(trim(meta ->> 'nationality'), ''), 'Outra'),
    nullif(trim(meta ->> 'gender'), ''),
    coalesce(nullif(trim(meta ->> 'phone_number'), ''), 'Nao informado'),
    coalesce(nullif(trim(meta ->> 'country'), ''), 'Outro'),
    coalesce(nullif(trim(meta ->> 'state'), ''), 'Nao informado'),
    coalesce(nullif(trim(meta ->> 'city'), ''), 'Nao informado'),
    'user'
  )
  on conflict (id) do update
  set
    legal_first_name = excluded.legal_first_name,
    last_name = excluded.last_name,
    full_name = excluded.full_name,
    birth_date = excluded.birth_date,
    document_number = excluded.document_number,
    document_country = excluded.document_country,
    nationality = excluded.nationality,
    gender = excluded.gender,
    phone_number = excluded.phone_number,
    country = excluded.country,
    state = excluded.state,
    city = excluded.city,
    role = coalesce(public.profiles.role, 'user');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- 10) RLS da tabela profiles.
alter table public.profiles enable row level security;

-- Remove policies antigas da propria tabela profiles para evitar permissoes amplas herdadas.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', policy_record.policyname);
  end loop;
end $$;

create policy "profiles_select_own_agent_admin"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_profile_role() in ('agent', 'admin')
);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

grant select, insert, update on public.profiles to authenticated;

commit;

-- Pos-migracao recomendado:
-- 1. Revisar policies de tickets, ticket_history, ticket_comments e notifications.
-- 2. Confirmar que FKs como tickets.assigned_to, ticket_history.actor_id,
--    ticket_comments.author_id e notifications.user_id continuam apontando para profiles(id).
-- 3. Criar uma nova conta pelo app e validar o preenchimento do perfil de passageiro.
