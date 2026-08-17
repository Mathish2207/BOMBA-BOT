alter table role_messages
  add column if not exists description text,
  add column if not exists color text,
  add column if not exists updated_at timestamptz not null default now();
