-- Annonces Discord des Mass créés sur le site Bomba (appliquée le 2026-10-08).

-- Suivi des annonces sur les Mass (table du site)
alter table activities add column if not exists discord_announced_at timestamptz;
alter table activities add column if not exists discord_message_id text;
-- Les Mass existants sont considérés comme déjà annoncés (pas de rafale au démarrage)
update activities set discord_announced_at = now() where discord_announced_at is null;

-- Réglages des annonces (salon + rôle), modifiés par la commande /annonce-mass
create table if not exists mass_announce_settings (
  guild_id text primary key,
  channel_id text not null,
  role_id text,
  updated_at timestamptz not null default now()
);
-- Aucune policy : accès réservé au bot (service role).
alter table mass_announce_settings enable row level security;
