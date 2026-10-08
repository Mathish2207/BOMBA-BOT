const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { supabase } = require('../lib/supabase');

const data = new SlashCommandBuilder()
  .setName('annonce-mass')
  .setDescription('Annonces automatiques des Mass créés sur le site Bomba.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('config')
      .setDescription('Choisit le salon des annonces et le rôle à mentionner.')
      .addChannelOption((opt) =>
        opt
          .setName('salon')
          .setDescription('Salon où poster les annonces')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addRoleOption((opt) => opt.setName('role').setDescription('Rôle à mentionner (facultatif)')),
  )
  .addSubcommand((sub) => sub.setName('statut').setDescription('Affiche la configuration actuelle.'))
  .addSubcommand((sub) => sub.setName('desactiver').setDescription('Arrête les annonces des Mass.'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'config') {
    const channel = interaction.options.getChannel('salon', true);
    const role = interaction.options.getRole('role');

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
      await interaction.reply({
        content: `Je n'ai pas les permissions pour écrire dans ${channel} (Voir le salon, Envoyer des messages, Intégrer des liens).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { error } = await supabase.from('mass_announce_settings').upsert({
      guild_id: guildId,
      channel_id: channel.id,
      role_id: role?.id ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    const mentionWarning =
      role && !role.mentionable && !perms.has('MentionEveryone')
        ? `\n⚠️ Le rôle ${role} n'est pas mentionnable : active « Autoriser tout le monde à mentionner ce rôle » ou donne-moi la permission « Mentionner @everyone, @here et tous les rôles ».`
        : '';
    await interaction.reply({
      content: `Les nouveaux Mass seront annoncés dans ${channel}${role ? ` avec une mention ${role}` : ''}.${mentionWarning}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === 'statut') {
    const { data: settings, error } = await supabase
      .from('mass_announce_settings')
      .select('channel_id, role_id')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) throw error;
    await interaction.reply({
      content: settings
        ? `Annonces dans <#${settings.channel_id}>${settings.role_id ? `, mention <@&${settings.role_id}>` : ', sans mention'}.`
        : 'Annonces désactivées. Utilise `/annonce-mass config` pour les activer.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === 'desactiver') {
    const { error } = await supabase.from('mass_announce_settings').delete().eq('guild_id', guildId);
    if (error) throw error;
    await interaction.reply({ content: 'Annonces des Mass désactivées.', flags: MessageFlags.Ephemeral });
  }
}

module.exports = { data, execute };
