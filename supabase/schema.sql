-- Schemat bazy dla silnika skanowania (Supabase / PostgreSQL).
-- Uruchom w Supabase: SQL Editor -> wklej całość -> Run.
-- Region projektu wybierz w UE (np. Frankfurt).

create table if not exists runs (
  run_date     date primary key,
  status       text not null default 'ok',
  finished_at  timestamptz not null default now(),
  summary      jsonb
);

create table if not exists seen_items (
  key         text primary key,
  source_id   text not null,
  title       text,
  relevant    boolean not null default false,
  first_seen  timestamptz not null default now()
);

create table if not exists changes (
  key                         text primary key,
  source_id                   text not null,
  source_name                 text not null,
  title                       text not null,
  url                         text,
  published_at                date,
  effective_date              date,
  category                    text,
  priority                    text not null check (priority in ('hi','mid','lo')),
  priority_reasons            jsonb not null default '[]',
  summary                     text,
  what_changes                text,
  status                      text,
  affects_school              text,
  requires_statute_change     boolean not null default false,
  requires_council_resolution boolean not null default false,
  documents                   jsonb not null default '[]',
  tasks                       jsonb not null default '[]',
  legal_basis                 text,
  confidence                  text,
  review_note                 text,
  run_date                    date not null,
  created_at                  timestamptz not null default now()
);

create index if not exists changes_run_date_idx on changes (run_date);
create index if not exists changes_effective_idx on changes (effective_date);

-- Bezpieczeństwo: włączone RLS i brak jakichkolwiek polityk = dostęp publiczny (klucz anon) jest zablokowany.
-- Silnik używa klucza service_role, który omija RLS i jest przechowywany wyłącznie w sekretach GitHuba.
alter table runs        enable row level security;
alter table seen_items  enable row level security;
alter table changes     enable row level security;
