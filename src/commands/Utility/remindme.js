import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { parseDuration } from '../../services/giveawayService.js';
import { setReminder } from '../../services/reminderService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Set a reminder (bot will DM you when time is up)')
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('When to remind you (e.g. 30m, 1h, 2d)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('What to remind you about')
        .setRequired(true)),

  async execute(interaction) {
    try {
      const durationStr = interaction.options.getString('duration', true);
      const reminderMsg = interaction.options.getString('message', true);

      const ms = parseDuration(durationStr);
      const remindAt = Date.now() + ms;

      await setReminder(
        interaction.client,
        interaction.guildId,
        interaction.user.id,
        'dm',
        remindAt,
        reminderMsg,
      );

      const minutes = Math.floor(ms / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      let timeStr;
      if (days > 0) timeStr = `${days}d ${hours % 24}h`;
      else if (hours > 0) timeStr = `${hours}h ${minutes % 60}m`;
      else timeStr = `${minutes}m`;

      const embed = createEmbed({
        title: '⏰ Reminder Set',
        description: `I'll remind you in **${timeStr}** about:\n> ${reminderMsg}`,
        color: 0x6B3FA0,
      });

      await InteractionHelper.safeReply(interaction, { embeds: [embed] });
      logger.info(`Reminder set for user ${interaction.user.id}`, { guildId: interaction.guildId, duration: durationStr });
    } catch (error) {
      logger.error('Remindme command failed:', error);
      await handleInteractionError(interaction, error, {
        commandName: 'remindme',
        source: 'remindme_command',
      });
    }
  },
};
