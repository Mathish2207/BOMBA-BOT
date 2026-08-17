const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const { supabase } = require('../lib/supabase');

const CUSTOM_EMOJI_REGEX = /^<a?:\w+:(\d+)>$/;
const RAW_ID_REGEX = /^\d{15,25}$/;

function parseEmojiInput(input) {
  const trimmed = input.trim();
  const customMatch = trimmed.match(CUSTOM_EMOJI_REGEX);
  if (customMatch) {
    return { type: 'custom', id: customMatch[1] };
  }
  if (RAW_ID_REGEX.test(trimmed)) {
    return { type: 'custom', id: trimmed };
  }
  return { type: 'unicode', value: trimmed };
}

function emojiKeyFromInput(input) {
  const parsed = parseEmojiInput(input);
  return parsed.type === 'unicode' ? parsed.value : parsed.id;
}

function formatEmojiForDisplay(emoji) {
  return RAW_ID_REGEX.test(emoji) ? `<:emoji:${emoji}>` : emoji;
}

async function resolveReactable(guild, input) {
  const parsed = parseEmojiInput(input);
  if (parsed.type === 'unicode') {
    return { key: parsed.value, reactable: parsed.value };
  }
  const emojis = await guild.emojis.fetch();
  const emoji = emojis.get(parsed.id);
  if (!emoji) {
    throw new Error("Cet emoji personnalisé est introuvable sur ce serveur.");
  }
  return { key: emoji.id, reactable: emoji };
}

const data = new SlashCommandBuilder()
  .setName('role-message')
  .setDescription("Gère les messages d'attribution de rôle par réaction.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription("Crée un nouveau message d'attribution de rôle.")
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Salon où poster le message')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((opt) => opt.setName('titre').setDescription("Titre de l'embed").setRequired(true))
      .addStringOption((opt) =>
        opt.setName('description').setDescription("Description de l'embed").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName('couleur').setDescription('Couleur hexadécimale, ex: #5865F2').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('add-role')
      .setDescription('Associe un emoji à un rôle sur un message existant.')
      .addStringOption((opt) => opt.setName('message_id').setDescription('ID du message').setRequired(true))
      .addStringOption((opt) =>
        opt.setName('emoji').setDescription('Emoji unicode ou emoji personnalisé du serveur').setRequired(true),
      )
      .addRoleOption((opt) => opt.setName('role').setDescription('Rôle à attribuer').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove-role')
      .setDescription("Retire l'association emoji → rôle d'un message.")
      .addStringOption((opt) => opt.setName('message_id').setDescription('ID du message').setRequired(true))
      .addStringOption((opt) => opt.setName('emoji').setDescription('Emoji à retirer').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Liste les messages de rôle suivis.')
      .addStringOption((opt) =>
        opt.setName('message_id').setDescription('ID du message (optionnel)').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription("Supprime le suivi d'un message de rôle (ne supprime pas le message Discord).")
      .addStringOption((opt) => opt.setName('message_id').setDescription('ID du message').setRequired(true)),
  );

async function handleCreate(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const titre = interaction.options.getString('titre', true);
  const description = interaction.options.getString('description');
  const couleurInput = interaction.options.getString('couleur');

  let couleur = 0x5865f2;
  if (couleurInput) {
    const hexMatch = couleurInput.trim().match(/^#?([0-9A-Fa-f]{6})$/);
    if (!hexMatch) {
      await interaction.reply({
        content: 'La couleur doit être un code hexadécimal valide, ex: `#5865F2`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    couleur = parseInt(hexMatch[1], 16);
  }

  const embed = new EmbedBuilder().setTitle(titre).setColor(couleur);
  if (description) embed.setDescription(description);

  let sentMessage;
  try {
    sentMessage = await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Erreur lors de l'envoi du message de rôle :", error);
    await interaction.reply({
      content: "Impossible d'envoyer un message dans ce salon. Vérifiez les permissions du bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { error: dbError } = await supabase.from('role_messages').insert({
    guild_id: interaction.guildId,
    channel_id: channel.id,
    message_id: sentMessage.id,
    title: titre,
  });

  if (dbError) {
    console.error('Erreur Supabase lors de la création du role_message :', dbError);
    await sentMessage.delete().catch(() => {});
    await interaction.reply({
      content: "Erreur lors de l'enregistrement en base de données. Le message a été annulé.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Message créé dans ${channel} avec l'ID \`${sentMessage.id}\`. Utilisez cet ID avec \`/role-message add-role\` pour y associer des rôles.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAddRole(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  const emojiInput = interaction.options.getString('emoji', true);
  const role = interaction.options.getRole('role', true);

  const { data: roleMessage, error: fetchError } = await supabase
    .from('role_messages')
    .select('id, channel_id, message_id')
    .eq('guild_id', interaction.guildId)
    .eq('message_id', messageId)
    .maybeSingle();

  if (fetchError) {
    console.error('Erreur Supabase :', fetchError);
    await interaction.reply({ content: 'Erreur lors de la lecture de la base de données.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!roleMessage) {
    await interaction.reply({
      content: "Aucun message de rôle enregistré avec cet ID sur ce serveur. Utilisez `/role-message create` d'abord.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me;
  if (role.managed || role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: `Le rôle ${role} est positionné au-dessus (ou au même niveau) du rôle du bot dans la hiérarchie du serveur, ou est un rôle géré automatiquement — le bot ne pourra jamais l'attribuer. Déplacez le rôle du bot au-dessus dans les paramètres du serveur.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { data: existingMapping, error: existingError } = await supabase
    .from('role_message_mappings')
    .select('id, emoji')
    .eq('role_message_id', roleMessage.id);

  if (existingError) {
    console.error('Erreur Supabase :', existingError);
    await interaction.reply({ content: 'Erreur lors de la lecture de la base de données.', flags: MessageFlags.Ephemeral });
    return;
  }

  let emojiKey;
  let reactable;
  try {
    const resolved = await resolveReactable(interaction.guild, emojiInput);
    emojiKey = resolved.key;
    reactable = resolved.reactable;
  } catch (error) {
    await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (existingMapping.some((m) => m.emoji === emojiKey)) {
    await interaction.reply({ content: 'Cet emoji est déjà utilisé sur ce message.', flags: MessageFlags.Ephemeral });
    return;
  }

  let channel;
  let discordMessage;
  try {
    channel = await interaction.guild.channels.fetch(roleMessage.channel_id);
    discordMessage = await channel.messages.fetch(roleMessage.message_id);
  } catch (error) {
    await interaction.reply({
      content: 'Le message Discord associé est introuvable (a-t-il été supprimé manuellement ?).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await discordMessage.react(reactable);
  } catch (error) {
    console.error("Erreur lors de l'ajout de la réaction :", error);
    await interaction.reply({
      content: "Impossible d'ajouter la réaction sur le message. Vérifiez la permission `Ajouter des réactions`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { error: insertError } = await supabase.from('role_message_mappings').insert({
    role_message_id: roleMessage.id,
    emoji: emojiKey,
    role_id: role.id,
  });

  if (insertError) {
    console.error('Erreur Supabase lors de l\'insertion du mapping :', insertError);
    const reaction = discordMessage.reactions.cache.find((r) => (r.emoji.id ?? r.emoji.name) === emojiKey);
    await reaction?.users.remove(interaction.client.user.id).catch(() => {});
    await interaction.reply({ content: "Erreur lors de l'enregistrement en base de données.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: `Association ajoutée : ${emojiInput} → ${role}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemoveRole(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  const emojiInput = interaction.options.getString('emoji', true);

  const { data: roleMessage, error: fetchError } = await supabase
    .from('role_messages')
    .select('id, channel_id, message_id')
    .eq('guild_id', interaction.guildId)
    .eq('message_id', messageId)
    .maybeSingle();

  if (fetchError) {
    console.error('Erreur Supabase :', fetchError);
    await interaction.reply({ content: 'Erreur lors de la lecture de la base de données.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!roleMessage) {
    await interaction.reply({
      content: 'Aucun message de rôle enregistré avec cet ID sur ce serveur.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const emojiKey = emojiKeyFromInput(emojiInput);

  const { data: mapping, error: mappingError } = await supabase
    .from('role_message_mappings')
    .select('id')
    .eq('role_message_id', roleMessage.id)
    .eq('emoji', emojiKey)
    .maybeSingle();

  if (mappingError) {
    console.error('Erreur Supabase :', mappingError);
    await interaction.reply({ content: 'Erreur lors de la lecture de la base de données.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!mapping) {
    await interaction.reply({ content: "Cet emoji n'est pas associé à ce message.", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const channel = await interaction.guild.channels.fetch(roleMessage.channel_id);
    const discordMessage = await channel.messages.fetch(roleMessage.message_id);
    const reaction = discordMessage.reactions.cache.find((r) => (r.emoji.id ?? r.emoji.name) === emojiKey);
    if (reaction) {
      await reaction.users.remove(interaction.client.user.id);
    }
  } catch (error) {
    console.error('Impossible de retirer la réaction du bot sur Discord :', error);
  }

  const { error: deleteError } = await supabase.from('role_message_mappings').delete().eq('id', mapping.id);

  if (deleteError) {
    console.error('Erreur Supabase lors de la suppression du mapping :', deleteError);
    await interaction.reply({ content: "Erreur lors de la suppression en base de données.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: `Association retirée pour l'emoji ${emojiInput}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleList(interaction) {
  const messageId = interaction.options.getString('message_id');

  let query = supabase
    .from('role_messages')
    .select('id, message_id, channel_id, title, role_message_mappings(emoji, role_id)')
    .eq('guild_id', interaction.guildId);

  if (messageId) {
    query = query.eq('message_id', messageId.trim());
  }

  const { data: roleMessages, error } = await query.order('created_at', { ascending: true });

  if (error) {
    console.error('Erreur Supabase :', error);
    await interaction.reply({ content: 'Erreur lors de la lecture de la base de données.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!roleMessages || roleMessages.length === 0) {
    await interaction.reply({ content: 'Aucun message de rôle trouvé.', flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = roleMessages.map((rm) => {
    const header = `**${rm.title}** — \`${rm.message_id}\` (<#${rm.channel_id}>)`;
    if (!rm.role_message_mappings || rm.role_message_mappings.length === 0) {
      return `${header}\n  _Aucun rôle associé_`;
    }
    const mappingLines = rm.role_message_mappings
      .map((m) => `  ${formatEmojiForDisplay(m.emoji)} → <@&${m.role_id}>`)
      .join('\n');
    return `${header}\n${mappingLines}`;
  });

  const content = lines.join('\n\n').slice(0, 1900);
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleDelete(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();

  const { data: roleMessage, error: fetchError } = await supabase
    .from('role_messages')
    .select('id')
    .eq('guild_id', interaction.guildId)
    .eq('message_id', messageId)
    .maybeSingle();

  if (fetchError) {
    console.error('Erreur Supabase :', fetchError);
    await interaction.reply({ content: 'Erreur lors de la lecture de la base de données.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!roleMessage) {
    await interaction.reply({
      content: 'Aucun message de rôle enregistré avec cet ID sur ce serveur.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { error: deleteError } = await supabase.from('role_messages').delete().eq('id', roleMessage.id);

  if (deleteError) {
    console.error('Erreur Supabase lors de la suppression :', deleteError);
    await interaction.reply({ content: 'Erreur lors de la suppression en base de données.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Suivi supprimé de la base de données. Le message Discord original n'a pas été supprimé.",
    flags: MessageFlags.Ephemeral,
  });
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'create') return await handleCreate(interaction);
    if (sub === 'add-role') return await handleAddRole(interaction);
    if (sub === 'remove-role') return await handleRemoveRole(interaction);
    if (sub === 'list') return await handleList(interaction);
    if (sub === 'delete') return await handleDelete(interaction);
  } catch (error) {
    console.error(`Erreur lors de l'exécution de /role-message ${sub} :`, error);
    const payload = { content: 'Une erreur inattendue est survenue.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

module.exports = { data, execute };
