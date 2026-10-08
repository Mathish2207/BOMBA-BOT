const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { supabase } = require('./supabase');

// Annonce sur Discord des Mass créés sur le site Bomba.
// Le bot interroge régulièrement Supabase : tout Mass dont
// discord_announced_at est vide est annoncé une seule fois, même après un
// redémarrage du bot (la colonne sert de verrou).

const SITE_URL = (process.env.SITE_URL || 'https://bomba-tmk.netlify.app').replace(/\/$/, '');
const POLL_INTERVAL_MS = 20_000;
// Laisse au site le temps de copier les emplacements de la compo.
const MIN_AGE_MS = 10_000;
const ACCENT_COLOR = 0xf28c28;

let warnedMissingSettings = false;
let running = false;

async function getSettings(guildId) {
  const { data, error } = await supabase
    .from('mass_announce_settings')
    .select('channel_id, role_id')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function formatUtcTime(date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

async function buildMessage(activity, roleId) {
  const [{ data: link }, { count: places }] = await Promise.all([
    supabase
      .from('activity_compositions')
      .select('compositions(name)')
      .eq('activity_id', activity.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('activity_composition_slots')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activity.id),
  ]);

  const url = `${SITE_URL}/mass?open=${activity.id}`;
  const embed = new EmbedBuilder().setColor(ACCENT_COLOR).setTitle(activity.title).setURL(url).setFooter({ text: 'Bomba' });

  if (activity.description) embed.setDescription(activity.description.slice(0, 4000));

  if (activity.scheduled_at) {
    const date = new Date(activity.scheduled_at);
    const unix = Math.floor(date.getTime() / 1000);
    // <t:…:F> s'affiche dans le fuseau et la langue de chaque membre.
    embed.addFields({ name: 'Quand', value: `<t:${unix}:F> · ${formatUtcTime(date)}\n<t:${unix}:R>` });
  }

  const compoName = link?.compositions?.name;
  if (compoName) {
    embed.addFields({ name: 'Compo', value: `${compoName}${places ? ` · ${places} place${places > 1 ? 's' : ''}` : ''}` });
  }

  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("S'inscrire").setURL(url);

  return {
    content: `${roleId ? `<@&${roleId}> ` : ''}Nouveau Mass : **${activity.title}**`,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
    allowedMentions: { roles: roleId ? [roleId] : [] },
  };
}

async function announcePending(client) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const settings = await getSettings(guildId);
  if (!settings) {
    if (!warnedMissingSettings) {
      console.warn("Annonces des Mass : aucun salon configuré (commande /annonce-mass config).");
      warnedMissingSettings = true;
    }
    return;
  }
  warnedMissingSettings = false;

  const { data: pending, error } = await supabase
    .from('activities')
    .select('id, title, description, scheduled_at, created_at')
    .is('discord_announced_at', null)
    .lt('created_at', new Date(Date.now() - MIN_AGE_MS).toISOString())
    .order('created_at')
    .limit(10);
  if (error) throw error;
  if (!pending || pending.length === 0) return;

  const channel = await client.channels.fetch(settings.channel_id);
  if (!channel || !channel.isTextBased()) {
    console.error(`Annonces des Mass : le salon ${settings.channel_id} est introuvable ou n'est pas textuel.`);
    return;
  }

  for (const activity of pending) {
    // Verrou : seul le premier qui passe la date d'annonce envoie le message.
    const { data: claimed, error: claimError } = await supabase
      .from('activities')
      .update({ discord_announced_at: new Date().toISOString() })
      .eq('id', activity.id)
      .is('discord_announced_at', null)
      .select('id');
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) continue;

    try {
      const message = await channel.send(await buildMessage(activity, settings.role_id));
      await supabase.from('activities').update({ discord_message_id: message.id }).eq('id', activity.id);
      console.log(`Mass annoncé sur Discord : ${activity.title}`);
    } catch (sendError) {
      console.error(`Échec de l'annonce du Mass ${activity.id}, nouvel essai au prochain passage :`, sendError);
      await supabase.from('activities').update({ discord_announced_at: null }).eq('id', activity.id);
    }
  }
}

function startMassAnnouncer(client) {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await announcePending(client);
    } catch (error) {
      console.error('Erreur lors des annonces des Mass :', error);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startMassAnnouncer };
