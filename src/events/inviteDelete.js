import { Events } from 'discord.js';
import { cacheGuildInvites } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.InviteDelete,
  once: false,

  async execute(invite) {
    try {
      await cacheGuildInvites(invite.client, invite.guild);
    } catch (error) {
      logger.error('Error in inviteDelete event:', error);
    }
  },
};
