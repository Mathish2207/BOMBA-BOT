require('dotenv').config();
const { MessageFlags } = require('discord.js');
const { client } = require('./lib/discordClient');
const { deployCommands } = require('./lib/deployCommands');
const roleMessageCommand = require('./commands/roleMessage');
const readyEvent = require('./events/ready');
const reactionAddEvent = require('./events/messageReactionAdd');
const reactionRemoveEvent = require('./events/messageReactionRemove');

const commands = new Map([[roleMessageCommand.data.name, roleMessageCommand]]);

client.once(readyEvent.name, readyEvent.execute);
client.on(reactionAddEvent.name, reactionAddEvent.execute);
client.on(reactionRemoveEvent.name, reactionRemoveEvent.execute);

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erreur non gérée pour la commande ${interaction.commandName} :`, error);
    const payload = { content: 'Une erreur inattendue est survenue.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

async function main() {
  const { DISCORD_TOKEN } = process.env;
  if (!DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN est requis dans les variables d\'environnement.');
  }

  try {
    await deployCommands();
  } catch (error) {
    console.error('Échec du déploiement des commandes slash au démarrage :', error);
  }

  await client.login(DISCORD_TOKEN);
}

main().catch((error) => {
  console.error('Erreur fatale au démarrage du bot :', error);
  process.exit(1);
});
