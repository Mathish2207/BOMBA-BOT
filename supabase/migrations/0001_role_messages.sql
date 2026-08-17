create extension if not exists pgcrypto;

create table role_messages (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  message_id text not null unique,
  title text not null,
  created_at timestamptz not null default now()
);

create table role_message_mappings (
  id uuid primary key default gen_random_uuid(),
  role_message_id uuid not null references role_messages(id) on delete cascade,
  emoji text not null,
  role_id text not null,
  created_at timestamptz not null default now(),
  unique (role_message_id, emoji)
);
