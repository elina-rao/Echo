import { Events, PermissionsBitField } from 'discord.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.MessageReactionRemove,
  once: false,

  async execute(reaction, user) {
    try {
      if (user.bot) return;

      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch {
          return;
        }
      }

      const { message, emoji } = reaction;
      const guild = message.guild;
      if (!guild) return;

      const config = await getGuildConfig(message.client, guild.id);
      const bindings = config.emojiReactions;
      if (!bindings || bindings.length === 0) return;

      const emojiName = emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name;

      const binding = bindings.find(
        b => b.channelId === message.channelId && b.messageId === message.id && b.emoji === emojiName
      );
      if (!binding) return;

      let member;
      try {
        member = await guild.members.fetch(user.id);
      } catch {
        return;
      }

      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

      if (!member.roles.cache.has(binding.roleId)) return;

      await member.roles.remove(binding.roleId, 'Reaction role removed — ✅ on rules message');

      logEvent(guild, {
        type: EVENT_TYPES.REACTION_ROLE_REMOVE,
        user: member.user,
        target: member.user,
        reason: `Removed role via ✅ reaction removal on rules`,
      });
    } catch (error) {
      logger.error('Error in messageReactionRemove:', error);
    }
  },
};
