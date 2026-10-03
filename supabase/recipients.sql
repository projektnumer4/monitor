-- Odbiorcy wiadomości e-mail (dobrowolny zapis nauczycieli). Uruchom w Supabase: SQL Editor -> New query -> wklej -> Run.
-- Najpierw muszą być wykonane schema.sql i panel.sql. Skrypt jest bezpieczny do wielokrotnego uruchomienia.

create table if not exists public.recipients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null,
  roles           text[] not null default '{}',
  status          text not null default 'active' check (status in ('active','unsubscribed')),
  consent_at      date not null default current_date,
  consent_note    text,
  -- Losowy token z linku „Wypisz mnie” w stopce wiadomości. Pozwala wyłącznie się wypisać.
  unsub_token     text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

create unique index if not exists recipients_email_key on public.recipients (lower(email));

alter table public.recipients enable row level security;

grant select, insert, update, delete on public.recipients to authenticated;
grant all on public.recipients to service_role;

drop policy if exists admin_recipients_all on public.recipients;
create policy admin_recipients_all on public.recipients for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Wypisanie bez logowania: tylko przez tę funkcję i tylko z tokenem ze stopki wiadomości.
-- Zwraca true, gdy token jest prawidłowy (także gdy osoba była już wypisana), w przeciwnym razie false.
create or replace function public.unsubscribe_recipient(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then
    return false;
  end if;

  update public.recipients
     set status = 'unsubscribed', unsubscribed_at = now()
   where unsub_token = p_token and status = 'active'
  returning id into v_id;

  if v_id is not null then
    return true;
  end if;
  return exists (select 1 from public.recipients where unsub_token = p_token);
end;
$$;

revoke all on function public.unsubscribe_recipient(text) from public;
grant execute on function public.unsubscribe_recipient(text) to anon, authenticated;

notify pgrst, 'reload schema';
