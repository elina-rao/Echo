import { Events, PermissionsBitField } from 'discord.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { handleStarReaction } from '../services/starboardService.js';

export default {
  name: Events.MessageReactionAdd,
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

      await handleStarReaction(reaction, user);

      const bindings = config.emojiReactions;
      if (!bindings || !bindings.length) {
        return;
      }

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

      const role = guild.roles.cache.get(binding.roleId);
      if (!role) return;

      if (role.position >= guild.members.me.roles.highest.position) return;

      if (member.roles.cache.has(role.id)) return;

      await member.roles.add(role, 'Reaction role — ✅ on rules message');

      logEvent(guild, {
        type: EVENT_TYPES.REACTION_ROLE_ADD,
        user: member.user,
        target: member.user,
        reason: `Added role ${role.name} via ✅ reaction on rules`,
      });
    } catch (error) {
      logger.error('Error in messageReactionAdd:', error);
    }
  },
};
