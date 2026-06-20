import { logger } from '../utils/logger.js';
import { getFromDb, setInDb } from '../utils/database/wrapper.js';
import { getScheduledMessagesKey } from '../utils/database/keys.js';

export async function scheduleMessage(client, guildId, channelId, content, scheduledAt) {
  try {
    const key = getScheduledMessagesKey(guildId);
    const messages = await getFromDb(key, []);

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      channelId,
      guildId,
      content,
      scheduledAt,
      createdBy: null,
      createdAt: Date.now(),
    };

    messages.push(entry);
    await setInDb(key, messages);
    return entry;
  } catch (error) {
    logger.error('Error scheduling message:', error);
    throw error;
  }
}

export async function cancelScheduledMessage(client, guildId, messageId) {
  try {
    const key = getScheduledMessagesKey(guildId);
    const messages = await getFromDb(key, []);
    const filtered = messages.filter(m => m.id !== messageId);
    await setInDb(key, filtered);
    return filtered.length !== messages.length;
  } catch (error) {
    logger.error('Error cancelling scheduled message:', error);
    return false;
  }
}

export async function getScheduledMessages(client, guildId) {
  try {
    const key = getScheduledMessagesKey(guildId);
    const messages = await getFromDb(key, []);
    return Array.isArray(messages) ? messages : [];
  } catch (error) {
    logger.error('Error getting scheduled messages:', error);
    return [];
  }
}

export async function checkScheduledMessages(client) {
  const now = Date.now();

  try {
    if (!client.db || typeof client.db.list !== 'function') return;

    let keys = await client.db.list('guild:');
    if (!Array.isArray(keys)) {
      if (typeof keys === 'object' && keys !== null) {
        keys = Object.keys(keys).filter(k => k.endsWith(':scheduled'));
      } else {
        return;
      }
    }

    const scheduledKeys = keys.filter(k => k.endsWith(':scheduled'));

    for (const key of scheduledKeys) {
      try {
        const parts = key.split(':');
        const guildId = parts[1];

        const messages = await getFromDb(key, []);
        if (!Array.isArray(messages) || messages.length === 0) continue;

        const due = messages.filter(m => m.scheduledAt <= now);
        if (due.length === 0) continue;

        const remaining = messages.filter(m => m.scheduledAt > now);

        for (const entry of due) {
          try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;

            const channel = guild.channels.cache.get(entry.channelId);
            if (!channel || !channel.isTextBased()) continue;

            await channel.send(entry.content);
            logger.info(`Scheduled message sent in guild ${guildId}, channel ${entry.channelId}`);
          } catch (err) {
            logger.error(`Error sending scheduled message ${entry.id}:`, err);
          }
        }

        await setInDb(key, remaining);
      } catch (err) {
        logger.error(`Error processing scheduled messages for key ${key}:`, err);
      }
    }
  } catch (error) {
    logger.error('Error in checkScheduledMessages:', error);
  }
}
