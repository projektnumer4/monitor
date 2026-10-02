-- Szkice dokumentów: biblioteka dokumentów szkoły i propozycje zmian przygotowane przez AI.
-- Uruchom w Supabase (SQL Editor -> New query -> wklej -> Run) PRZED wgraniem nowego kodu silnika.
-- Wymaga wcześniej wykonanych schema.sql i panel.sql. Bezpieczny do wielokrotnego uruchamiania.

-- 1) Najważniejsze przepisy aktu (cytaty), z których korzysta generator szkiców
alter table public.changes add column if not exists act_excerpt text;

-- 2) Biblioteka dokumentów szkoły (tekst). Nie wgrywaj danych osobowych.
create table if not exists public.school_documents (
  name          text primary key,
  content       text not null,
  chars         integer not null default 0,
  content_hash  text,
  updated_at    timestamptz not null default now()
);

-- 3) Szkice: jedna propozycja zmian dla pary (zmiana prawa, dokument)
create table if not exists public.document_drafts (
  id             uuid primary key default gen_random_uuid(),
  change_key     text not null references public.changes (key) on delete cascade,
  document_name  text not null,
  status         text not null default 'requested'
                 check (status in ('requested','ready','no_changes','failed','accepted','rejected')),
  summary        text,
  edits          jsonb not null default '[]',
  doc_hash       text,
  model          text,
  error          text,
  requested_at   timestamptz not null default now(),
  generated_at   timestamptz,
  reviewed_at    timestamptz,
  unique (change_key, document_name)
);
create index if not exists document_drafts_status_idx on public.document_drafts (status);

alter table public.school_documents enable row level security;
alter table public.document_drafts  enable row level security;

grant select, insert, update, delete on public.school_documents, public.document_drafts to authenticated;
grant all on public.school_documents, public.document_drafts to service_role;

drop policy if exists admin_documents_all on public.school_documents;
drop policy if exists admin_drafts_all    on public.document_drafts;
create policy admin_documents_all on public.school_documents for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_drafts_all    on public.document_drafts  for all to authenticated using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
