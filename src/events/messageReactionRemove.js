const { supabase } = require('../lib/supabase');

module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user) {
    if (user.bot) return;

    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch (error) {
      console.error('Impossible de récupérer la réaction/le message partiel :', error);
      return;
    }

    const message = reaction.message;
    if (!message.guildId) return;

    const emojiKey = reaction.emoji.id ?? reaction.emoji.name;

    const { data: roleMessage, error: rmError } = await supabase
      .from('role_messages')
      .select('id')
      .eq('guild_id', message.guildId)
      .eq('message_id', message.id)
      .maybeSingle();

    if (rmError) {
      console.error('Erreur Supabase (messageReactionRemove) :', rmError);
      return;
    }
    if (!roleMessage) return;

    const { data: mapping, error: mappingError } = await supabase
      .from('role_message_mappings')
      .select('role_id')
      .eq('role_message_id', roleMessage.id)
      .eq('emoji', emojiKey)
      .maybeSingle();

    if (mappingError) {
      console.error('Erreur Supabase (messageReactionRemove) :', mappingError);
      return;
    }
    if (!mapping) return;

    try {
      const member = await message.guild.members.fetch(user.id);
      await member.roles.remove(mapping.role_id);
    } catch (error) {
      console.error(`Impossible de retirer le rôle ${mapping.role_id} à ${user.id} :`, error);
    }
  },
};
