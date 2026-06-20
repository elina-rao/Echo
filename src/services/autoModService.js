import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './guildConfig.js';
import { getColor } from '../config/bot.js';
import { logger } from '../utils/logger.js';

const spamTracker = new Map();

setInterval(() => {
  const cutoff = Date.now() - 10000;
  for (const [key, entries] of spamTracker) {
    const filtered = entries.filter(t => t > cutoff);
    if (filtered.length === 0) {
      spamTracker.delete(key);
    } else {
      spamTracker.set(key, filtered);
    }
  }
}, 30000);

async function checkBlockedWords(content, config) {
  const words = config.autoModBlockedWords;
  if (!words || words.length === 0) return null;

  const lower = content.toLowerCase();
  for (const word of words) {
    if (word && lower.includes(word.toLowerCase())) {
      return `Blocked word: **${word}**`;
    }
  }
  return null;
}

async function checkLinks(content, config) {
  if (!config.autoModBlockedLinks) return null;

  const linkRegex = /https?:\/\/[^\s]+/gi;
  const matches = content.match(linkRegex);
  if (!matches) return null;

  return 'Links are not allowed in this channel.';
}

async function checkInvites(content, config) {
  if (!config.autoModBlockedInvites) return null;

  const inviteRegex = /(?:discord\.(?:gg|com\/invite|app\/invite)\/)[a-zA-Z0-9_-]+/gi;
  if (inviteRegex.test(content)) {
    return 'Discord invite links are not allowed.';
  }
  return null;
}

async function checkSpam(message, config) {
  const threshold = config.autoModSpamThreshold;
  if (!threshold || threshold < 1) return null;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const windowMs = 10000;

  if (!spamTracker.has(key)) {
    spamTracker.set(key, []);
  }

  const entries = spamTracker.get(key);
  const recent = entries.filter(t => t > now - windowMs);
  recent.push(now);
  spamTracker.set(key, recent);

  if (recent.length >= threshold) {
    return `Spam detected (${recent.length} messages in ${windowMs / 1000}s).`;
  }

  return null;
}

async function takeAction(message, reason, client) {
  try {
    await message.delete().catch(() => {});

    const config = await getGuildConfig(client, message.guild.id);
    const warnLimit = config.autoModWarnLimit || 3;
    const muteRoleId = config.autoModMuteRoleId;
    const logChannelId = config.autoModLogChannelId;

    const member = message.member;
    if (!member) return;

    const warnsKey = `automod:warns:${message.guild.id}:${message.author.id}`;
    let warnCount = await client.db.get(warnsKey, 0);
    warnCount += 1;
    await client.db.set(warnsKey, warnCount);

    if (warnCount >= warnLimit && muteRoleId) {
      const muteRole = message.guild.roles.cache.get(muteRoleId);
      if (muteRole && message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        if (muteRole.position < message.guild.members.me.roles.highest.position) {
          await member.roles.add(muteRole, `Auto-mod: exceeded ${warnLimit} warnings`);
          warnCount = 0;
          await client.db.set(warnsKey, 0);
        }
      }
    }

    const warning = `⚠️ Auto-mod warning (${warnCount}/${warnLimit}): ${reason}`;
    try {
      await member.send(warning);
    } catch {}

    if (logChannelId) {
      const logChannel = message.guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor(getColor('error'))
          .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
          .setDescription(`**Action:** Warning ${warnCount}/${warnLimit}\n**Reason:** ${reason}\n**Channel:** ${message.channel}\n**Content:** ${message.content || '*no text*'}`)
          .setTimestamp();
        const msg = muteRoleId && warnCount >= warnLimit
          ? `**Result:** Timed out (${warnLimit}/${warnLimit})`
          : `**Result:** Warning (${warnCount}/${warnLimit})`;
        embed.addFields({ name: '\u200b', value: msg });
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch (error) {
    logger.error('Error in auto-mod takeAction:', error);
  }
}

export async function checkMessage(message, client) {
  try {
    if (message.author.bot || !message.guild) return;

    const config = await getGuildConfig(client, message.guild.id);
    if (!config.autoModEnabled) return;

    const me = message.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;

    if (message.member?.permissions?.has(PermissionsBitField.Flags.ManageMessages)) return;
    if (message.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) return;

    const reason =
      (await checkBlockedWords(message.content, config)) ||
      (await checkSpam(message, config)) ||
      (await checkLinks(message.content, config)) ||
      (await checkInvites(message.content, config));

    if (reason) {
      await takeAction(message, reason, client);
    }
  } catch (error) {
    logger.error('Error in auto-mod checkMessage:', error);
  }
}
