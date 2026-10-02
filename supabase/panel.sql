-- Warstwa bazy dla panelu admina. Uruchom w Supabase: SQL Editor -> New query -> wklej -> Run.
-- Najpierw musi być wykonany schema.sql. Skrypt jest bezpieczny do wielokrotnego uruchamiania.

-- 1) Nowe kolumny w changes: stan obsługi zmiany i notatka admina
alter table public.changes add column if not exists workflow text not null default 'new';
alter table public.changes add column if not exists admin_note text;
alter table public.changes add column if not exists handled_at timestamptz;
do $$ begin
  alter table public.changes add constraint changes_workflow_check check (workflow in ('new','in_progress','done','dismissed'));
exception when duplicate_object then null; end $$;

-- 2) Ustawienia (konfiguracja edytowana z panelu), linki dla pracowników, lista adminów
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.access_links (
  id            uuid primary key default gen_random_uuid(),
  role_name     text not null,
  label         text,
  token_hash    text not null unique,
  expires_at    timestamptz,
  revoked       boolean not null default false,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.settings     enable row level security;
alter table public.access_links enable row level security;
alter table public.admins       enable row level security;

-- 3) Kto jest adminem: wpisany na listę ORAZ zalogowany z drugim składnikiem (2FA, poziom aal2)
create or replace function public.is_registered_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function public.is_registered_admin() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_registered_admin() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- 4) Uprawnienia i reguły dostępu (RLS): tabele widzi i zmienia tylko admin po 2FA
grant usage on schema public to authenticated, service_role;
grant select, update on public.changes to authenticated;
grant select on public.runs to authenticated;
grant select, insert, update, delete on public.settings, public.access_links to authenticated;
grant all on public.settings, public.access_links, public.admins to service_role;

drop policy if exists admin_changes_select on public.changes;
drop policy if exists admin_changes_update on public.changes;
drop policy if exists admin_runs_select    on public.runs;
drop policy if exists admin_settings_all   on public.settings;
drop policy if exists admin_links_all      on public.access_links;

create policy admin_changes_select on public.changes     for select to authenticated using (public.is_admin());
create policy admin_changes_update on public.changes     for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_runs_select    on public.runs        for select to authenticated using (public.is_admin());
create policy admin_settings_all   on public.settings    for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_links_all      on public.access_links for all   to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5) Widok dla pracownika wchodzącego z linku. Bez logowania, ale tylko przez tę funkcję:
--    zwraca wyłącznie zadania przypisane do roli z linku, a sam token jest w bazie przechowywany jako skrót SHA-256.
create or replace function public.get_role_view(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link    public.access_links%rowtype;
  v_hash    text;
  v_changes jsonb;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return null;
  end if;

  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');

  select * into v_link from public.access_links
   where token_hash = v_hash and not revoked and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  update public.access_links set last_used_at = now() where id = v_link.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', c.key, 'title', c.title, 'priority', c.priority, 'summary', c.summary,
           'what_changes', c.what_changes, 'effective_date', c.effective_date, 'status', c.status,
           'documents', c.documents, 'legal_basis', c.legal_basis, 'url', c.url,
           'source_name', c.source_name, 'run_date', c.run_date, 'workflow', c.workflow,
           'tasks', (select coalesce(jsonb_agg(t), '[]'::jsonb) from jsonb_array_elements(c.tasks) t where t ->> 'role' = v_link.role_name)
         ) order by case c.priority when 'hi' then 0 when 'mid' then 1 else 2 end, c.effective_date nulls last, c.run_date desc),
         '[]'::jsonb)
    into v_changes
    from public.changes c
   where c.workflow <> 'dismissed'
     and exists (select 1 from jsonb_array_elements(c.tasks) t where t ->> 'role' = v_link.role_name)
     and ((c.effective_date is null and c.run_date >= current_date - 90) or c.effective_date >= current_date - 30);

  return jsonb_build_object('role', v_link.role_name, 'label', v_link.label, 'generated_at', now(), 'changes', v_changes);
end;
$$;

revoke all on function public.get_role_view(text) from public;
grant execute on function public.get_role_view(text) to anon, authenticated;

-- 6) Po wykonaniu tego skryptu dodaj swoje konto na listę adminów (wstaw własny e-mail):
--    insert into public.admins (user_id) select id from auth.users where email = 'TWOJ-EMAIL@example.pl';
notify pgrst, 'reload schema';
