import { logger } from '../utils/logger.js';
import { getFromDb, setInDb } from '../utils/database/wrapper.js';
import { getGuildConfigKey } from '../utils/database/keys.js';

export async function setReminder(client, guildId, userId, channelId, remindAt, message) {
  try {
    const key = `guild:${guildId}:reminders:${userId}`;
    const reminders = await getFromDb(key, []);

    const reminder = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      userId,
      channelId,
      guildId,
      remindAt,
      message,
      createdAt: Date.now(),
    };

    reminders.push(reminder);
    await setInDb(key, reminders);
    return reminder;
  } catch (error) {
    logger.error('Error setting reminder:', error);
    throw error;
  }
}

export async function cancelReminder(client, guildId, userId, reminderId) {
  try {
    const key = `guild:${guildId}:reminders:${userId}`;
    const reminders = await getFromDb(key, []);
    const filtered = reminders.filter(r => r.id !== reminderId);
    await setInDb(key, filtered);
    return filtered.length !== reminders.length;
  } catch (error) {
    logger.error('Error cancelling reminder:', error);
    return false;
  }
}

export async function checkReminders(client) {
  const now = Date.now();

  try {
    if (!client.db || typeof client.db.list !== 'function') return;

    let keys = await client.db.list('guild:');
    if (!Array.isArray(keys)) {
      if (typeof keys === 'object' && keys !== null) {
        keys = Object.keys(keys).filter(k => k.includes(':reminders:'));
      } else {
        return;
      }
    }

    const reminderKeys = keys.filter(k => k.includes(':reminders:'));

    for (const key of reminderKeys) {
      try {
        const parts = key.split(':');
        const guildId = parts[1];
        const userId = parts[3];

        const reminders = await getFromDb(key, []);
        if (!Array.isArray(reminders) || reminders.length === 0) continue;

        const due = reminders.filter(r => r.remindAt <= now);
        if (due.length === 0) continue;

        const remaining = reminders.filter(r => r.remindAt > now);

        for (const reminder of due) {
          try {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
              let channel = null;
              if (reminder.channelId && reminder.channelId !== 'dm') {
                channel = guild.channels.cache.get(reminder.channelId);
              }

              if (channel && channel.isTextBased()) {
                await channel.send({
                  content: `<@${reminder.userId}>, ⏰ **Reminder:** ${reminder.message}`,
                  allowedMentions: { users: [reminder.userId] },
                });
              } else {
                const user = await client.users.fetch(reminder.userId).catch(() => null);
                if (user) {
                  await user.send({
                    content: `⏰ **Reminder:** ${reminder.message}\n*From: ${guild?.name || 'Unknown server'}*`,
                  }).catch(() => {});
                }
              }
            } else {
              const user = await client.users.fetch(reminder.userId).catch(() => null);
              if (user) {
                await user.send(`⏰ **Reminder:** ${reminder.message}`).catch(() => {});
              }
            }
          } catch (err) {
            logger.error(`Error delivering reminder ${reminder.id}:`, err);
          }
        }

        await setInDb(key, remaining);
      } catch (err) {
        logger.error(`Error processing reminders for key ${key}:`, err);
      }
    }
  } catch (error) {
    logger.error('Error in checkReminders:', error);
  }
}
