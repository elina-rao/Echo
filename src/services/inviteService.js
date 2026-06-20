import { logger } from '../utils/logger.js';

const inviteCache = new Map();

export function getInviteCache() {
  return inviteCache;
}

export async function cacheGuildInvites(client, guild) {
  try {
    const invites = await guild.invites.fetch();
    const guildMap = new Map();
    for (const invite of invites.values()) {
      guildMap.set(invite.code, invite.uses);
    }
    inviteCache.set(guild.id, guildMap);
    return guildMap;
  } catch (error) {
    logger.debug(`Could not cache invites for guild ${guild.id}: ${error.message}`);
    inviteCache.set(guild.id, new Map());
    return new Map();
  }
}

export async function cacheAllInvites(client) {
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(client, guild);
  }
  logger.info(`Cached invites for ${client.guilds.cache.size} guilds`);
}

export async function findUsedInvite(guild) {
  try {
    const cached = inviteCache.get(guild.id);
    if (!cached) return null;

    const currentInvites = await guild.invites.fetch();
    const currentMap = new Map();
    for (const inv of currentInvites.values()) {
      currentMap.set(inv.code, inv.uses);
    }
    inviteCache.set(guild.id, currentMap);

    for (const [code, cachedUses] of cached) {
      const currentUses = currentMap.get(code);
      if (currentUses !== undefined && currentUses > cachedUses) {
        const invite = currentInvites.get(code);
        return invite || null;
      }
    }

    return null;
  } catch (error) {
    logger.debug(`Could not find used invite for guild ${guild.id}: ${error.message}`);
    return null;
  }
}

export async function trackMemberJoin(client, guildId, userId, inviterId, inviteCode) {
  try {
    const key = `guild:${guildId}:invites:${inviterId}`;
    const data = await client.db.get(key, { invites: 0, members: [], codes: [] });

    data.invites = (data.invites || 0) + 1;
    if (!data.members) data.members = [];
    if (!data.codes) data.codes = [];

    data.members.push({ userId, joinedAt: new Date().toISOString() });
    if (inviteCode && !data.codes.includes(inviteCode)) {
      data.codes.push(inviteCode);
    }

    await client.db.set(key, data);
    return true;
  } catch (error) {
    logger.error(`Error tracking member join for guild ${guildId}:`, error);
    return false;
  }
}

export async function getMemberInvites(client, guildId, userId) {
  try {
    const key = `guild:${guildId}:invites:${userId}`;
    const data = await client.db.get(key, null);
    return data || { invites: 0, members: [], codes: [] };
  } catch (error) {
    logger.error(`Error getting invites for user ${userId}:`, error);
    return { invites: 0, members: [], codes: [] };
  }
}

export async function getInviteLeaderboard(client, guildId, limit = 10) {
  try {
    const prefix = `guild:${guildId}:invites:`;
    const keys = await client.db.list(prefix);
    const entries = [];

    for (const key of keys) {
      const userId = key.replace(prefix, '');
      const data = await client.db.get(key, { invites: 0 });
      entries.push({ userId, invites: data.invites || 0, members: data.members || [] });
    }

    entries.sort((a, b) => b.invites - a.invites);
    return entries.slice(0, limit);
  } catch (error) {
    logger.error(`Error getting invite leaderboard for guild ${guildId}:`, error);
    return [];
  }
}
