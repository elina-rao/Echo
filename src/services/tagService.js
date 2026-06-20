import { logger } from '../utils/logger.js';

function getTagsKey(guildId) {
  return `guild:${guildId}:tags`;
}

export async function getTags(client, guildId) {
  try {
    const key = getTagsKey(guildId);
    const data = await client.db.get(key, {});
    return data || {};
  } catch (error) {
    logger.error(`Error fetching tags for guild ${guildId}:`, error);
    return {};
  }
}

export async function getTag(client, guildId, tagName) {
  const tags = await getTags(client, guildId);
  return tags[tagName.toLowerCase()] || null;
}

export async function setTag(client, guildId, tagName, content, userId) {
  try {
    const key = getTagsKey(guildId);
    const tags = await getTags(client, guildId);
    const name = tagName.toLowerCase();

    tags[name] = {
      name: tagName,
      content,
      createdBy: userId,
      createdAt: tags[name]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.db.set(key, tags);
    return true;
  } catch (error) {
    logger.error(`Error setting tag ${tagName} for guild ${guildId}:`, error);
    return false;
  }
}

export async function deleteTag(client, guildId, tagName) {
  try {
    const key = getTagsKey(guildId);
    const tags = await getTags(client, guildId);
    delete tags[tagName.toLowerCase()];
    await client.db.set(key, tags);
    return true;
  } catch (error) {
    logger.error(`Error deleting tag ${tagName} for guild ${guildId}:`, error);
    return false;
  }
}

export async function getTagNames(client, guildId) {
  const tags = await getTags(client, guildId);
  return Object.keys(tags).sort();
}

export async function getTagList(client, guildId) {
  const tags = await getTags(client, guildId);
  return Object.values(tags).sort((a, b) => a.name.localeCompare(b.name));
}
