# bomba-bot

Bot Discord privé pour le groupe Bomba : attribution automatique de rôles par réaction sur des messages configurés via des commandes slash.

Projet séparé du site web Bomba, mais partage la même base de données Supabase.

## Stack

- Node.js (LTS) + [discord.js](https://discord.js.org) v14
- Supabase (`@supabase/supabase-js`) pour la persistance
- Hébergement : [Discloud](https://discloud.com) (plan gratuit, type `bot`)
- Déploiement automatique via GitHub Actions à chaque push sur `main`

## Fonctionnement

- `/role-message create` poste un embed dans un salon (sans réaction au départ) et l'enregistre en base.
- `/role-message add-role` associe un emoji (unicode ou personnalisé) à un rôle sur un message existant, et ajoute la réaction du bot sur le message pour la rendre cliquable.
- `/role-message remove-role` retire une association emoji → rôle.
- `/role-message list` liste les messages suivis et leurs associations.
- `/role-message delete` supprime uniquement le suivi en base (ne supprime pas le message Discord).
- Réagir à un emoji configuré donne le rôle correspondant ; retirer la réaction retire le rôle. Un membre peut cumuler plusieurs rôles sur un même message (pas de logique exclusive).

Toutes les commandes sont réservées aux membres ayant la permission Discord **Gérer les rôles**, et toutes les réponses sont éphémères.

---

## 1. Prérequis manuels — configuration Discord

À faire **avant** le premier déploiement du bot :

1. Créer l'application sur le [Discord Developer Portal](https://discord.com/developers/applications), récupérer le **token du bot** (`DISCORD_TOKEN`, onglet Bot) et l'**Application ID** (`DISCORD_CLIENT_ID`).
2. Dans l'onglet **Bot**, activer l'intent privilégié **Server Members Intent**.
3. Inviter le bot sur le serveur avec les scopes `bot` + `applications.commands`, et au minimum les permissions : `Gérer les rôles`, `Voir les salons`, `Envoyer des messages`, `Ajouter des réactions`, `Lire l'historique des messages`.
4. Dans les paramètres du serveur, placer le rôle du bot **au-dessus** de tous les rôles qu'il devra attribuer.
5. Récupérer l'**ID du serveur** (`DISCORD_GUILD_ID`) pour un déploiement des commandes slash en mode guild (propagation quasi instantanée).

## 2. Variables d'environnement

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Token du bot |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | ID du serveur, pour déployer les commandes en guild-scoped |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase |

Copier `.env.example` vers `.env` pour le développement local (jamais commité, déjà dans `.gitignore`). Sur Discloud, ces valeurs sont injectées automatiquement à chaque déploiement via GitHub Actions.

## 3. Base de données Supabase

Le schéma se trouve dans [`supabase/migrations/0001_role_messages.sql`](supabase/migrations/0001_role_messages.sql). À exécuter une fois dans l'éditeur SQL du projet Supabase partagé avec le site Bomba :

```sql
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
```

Le bot se connecte avec la **service role key** (process backend de confiance, jamais exposée côté client).

## 4. Développement local

```bash
npm install
cp .env.example .env   # puis renseigner les valeurs
npm start
```

Au démarrage, le bot redéploie automatiquement ses commandes slash sur le serveur `DISCORD_GUILD_ID` avant de se connecter. Pour redéployer les commandes sans démarrer le bot :

```bash
npm run deploy-commands
```

## 5. Déploiement — Discloud + GitHub Actions

### 5.1 Configuration du compte Discloud (une seule fois)

1. **Créer le compte** : aller sur [discloud.com](https://discloud.com) et se connecter avec son compte Discord.
2. **Rejoindre le serveur Discord officiel de Discloud** et suivre la procédure de vérification pour débloquer le rôle "Verified" — nécessaire pour accéder au salon de commandes du premier déploiement.
3. **Récupérer le token API** (secret GitHub `DISCLOUD_TOKEN`) :
   - Aller sur [discloud.com/dashboard](https://discloud.com/dashboard)
   - Menu de gauche → **Ferramentas** (Outils) → **Chaves de API** (Clés API)
   - Cliquer sur **Mostrar** (Afficher) puis **Copiar** (Copier)
   - Garder ce token secret : quiconque le possède peut agir à la place du compte.
4. **Premier déploiement** (pour obtenir l'ID de l'app) — une seule fois, manuellement, une fois le code prêt :
   - Compresser le dossier du projet (avec `discloud.config`, `package.json`, `src/`) en `.zip`.
   - Dans le salon de commandes du serveur Discloud, taper `.upconfig` (puisque `discloud.config` est déjà présent) et joindre le `.zip`.
     (Alternative sans `discloud.config` préalable : `.up` et répondre aux questions posées — Application ID Discord du bot, fichier principal `src/index.js`, RAM `100`.)
   - Le bot Discloud répond avec l'**ID de l'application** qu'il vient de créer.
5. **Reporter cet ID** dans le champ `ID=` de [`discloud.config`](discloud.config), committer et pousser.
6. **Ajouter les secrets GitHub** : dans le repo, **Settings → Secrets and variables → Actions → New repository secret**, un secret par variable : `DISCLOUD_TOKEN`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
7. À partir de là, chaque `git push` sur `main` redéploie automatiquement le bot via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — plus besoin de repasser par `.up`/`.upconfig` manuellement.

### 5.2 Redéploiements suivants

Rien à faire : push sur `main` → GitHub Actions build et déploie sur Discloud avec `ID` déjà renseigné dans `discloud.config`. Toute la configuration (messages, emojis, rôles) vit en base Supabase, donc un redémarrage du bot ne perd aucune donnée.

## Structure du repo

```
bomba-bot/
  src/
    index.js
    commands/roleMessage.js
    events/ready.js
    events/messageReactionAdd.js
    events/messageReactionRemove.js
    lib/discordClient.js
    lib/supabase.js
    lib/deployCommands.js
  supabase/migrations/0001_role_messages.sql
  discloud.config
  package.json
  .env.example
  .gitignore
  .discloudignore
  .github/workflows/deploy.yml
```

## Hors scope (V1)

Volontairement non implémenté : gestion de `roleDelete`, `guildMemberRemove`, synchronisation si un message de rôle est supprimé manuellement sur Discord, limite du nombre de rôles par membre.
