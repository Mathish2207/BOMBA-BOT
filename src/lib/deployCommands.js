require('dotenv').config();
const { REST, Routes } = require('discord.js');
const roleMessageCommand = require('../commands/roleMessage');

async function deployCommands() {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    throw new Error(
      'DISCORD_TOKEN, DISCORD_CLIENT_ID et DISCORD_GUILD_ID sont requis pour déployer les commandes slash.',
    );
  }

  const rest = new REST().setToken(DISCORD_TOKEN);
  const body = [roleMessageCommand.data.toJSON()];

  const result = await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body });

  console.log(`${result.length} commande(s) slash déployée(s) sur le serveur ${DISCORD_GUILD_ID}.`);
}

if (require.main === module) {
  deployCommands().catch((error) => {
    console.error('Échec du déploiement des commandes slash :', error);
    process.exit(1);
  });
}

module.exports = { deployCommands };
