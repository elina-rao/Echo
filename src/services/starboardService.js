import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig } from './guildConfig.js';
import { db, getFromDb, setInDb } from '../utils/database/wrapper.js';
import { getStarboardMessageKey } from '../utils/database/keys.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';

export async function handleStarReaction(reaction, user) {
  try {
    const { message } = reaction;
    const guild = message.guild;
    if (!guild) return;

    const client = message.client;
    const config = await getGuildConfig(client, guild.id);

    if (!config.starboardEnabled) return;

    const starEmoji = config.starboardEmoji || '⭐';
    const threshold = Math.max(1, config.starboardThreshold || 3);
    const channelId = config.starboardChannelId;
    if (!channelId) return;

    let targetEmoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name;

    if (targetEmoji !== starEmoji) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return;

    const fullMessage = reaction.message.partial ? await reaction.message.fetch() : reaction.message;

    const starCount = fullMessage.reactions.cache.get(reaction.emoji.identifier || reaction.emoji.name)?.count || 1;

    const starKey = getStarboardMessageKey(guild.id, message.id);
    const existing = await getFromDb(starKey, null);

    if (starCount < threshold) {
      if (existing && existing.starboardMessageId) {
        try {
          const oldMsg = await channel.messages.fetch(existing.starboardMessageId);
          await oldMsg.delete();
        } catch {}
        await setInDb(starKey, null);
      }
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setAuthor({ name: fullMessage.author.tag, iconURL: fullMessage.author.displayAvatarURL() })
      .setDescription(fullMessage.content ? fullMessage.content.slice(0, 2000) : '*No content*')
      .addFields({ name: 'Jump', value: `[Go to message](${fullMessage.url})`, inline: true })
      .setFooter({ text: `⭐ ${starCount} | #${fullMessage.channel.name}` })
      .setTimestamp(fullMessage.createdAt);

    if (fullMessage.attachments.size > 0) {
      const attach = fullMessage.attachments.first();
      if (attach.contentType?.startsWith('image/')) {
        embed.setImage(attach.url);
      }
    }

    if (existing && existing.starboardMessageId) {
      try {
        const oldMsg = await channel.messages.fetch(existing.starboardMessageId);
        await oldMsg.edit({ embeds: [embed] });
        return;
      } catch {}
    }

    const starMsg = await channel.send({ embeds: [embed] });
    await setInDb(starKey, { starboardMessageId: starMsg.id, channelId, count: starCount });
  } catch (error) {
    logger.error('Error in handleStarReaction:', error);
  }
}

export async function handleStarReactionRemove(reaction, user) {
  try {
    const { message } = reaction;
    const guild = message.guild;
    if (!guild) return;

    const client = message.client;
    const config = await getGuildConfig(client, guild.id);

    if (!config.starboardEnabled) return;

    const starEmoji = config.starboardEmoji || '⭐';
    const channelId = config.starboardChannelId;
    if (!channelId) return;

    let targetEmoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name;

    if (targetEmoji !== starEmoji) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return;

    const fullMessage = reaction.message.partial ? await reaction.message.fetch() : reaction.message;

    const starCount = fullMessage.reactions.cache.get(reaction.emoji.identifier || reaction.emoji.name)?.count || 0;

    const threshold = Math.max(1, config.starboardThreshold || 3);
    const starKey = getStarboardMessageKey(guild.id, message.id);
    const existing = await getFromDb(starKey, null);

    if (starCount < threshold) {
      if (existing && existing.starboardMessageId) {
        try {
          const oldMsg = await channel.messages.fetch(existing.starboardMessageId);
          await oldMsg.delete();
        } catch {}
      }
      await setInDb(starKey, null);
      return;
    }

    if (!existing || !existing.starboardMessageId) return;

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setAuthor({ name: fullMessage.author.tag, iconURL: fullMessage.author.displayAvatarURL() })
      .setDescription(fullMessage.content ? fullMessage.content.slice(0, 2000) : '*No content*')
      .addFields({ name: 'Jump', value: `[Go to message](${fullMessage.url})`, inline: true })
      .setFooter({ text: `⭐ ${starCount} | #${fullMessage.channel.name}` })
      .setTimestamp(fullMessage.createdAt);

    if (fullMessage.attachments.size > 0) {
      const attach = fullMessage.attachments.first();
      if (attach.contentType?.startsWith('image/')) {
        embed.setImage(attach.url);
      }
    }

    try {
      const starMsg = await channel.messages.fetch(existing.starboardMessageId);
      await starMsg.edit({ embeds: [embed] });
      await setInDb(starKey, { ...existing, count: starCount });
    } catch {}
  } catch (error) {
    logger.error('Error in handleStarReactionRemove:', error);
  }
}
