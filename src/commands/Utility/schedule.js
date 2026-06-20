import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { scheduleMessage, cancelScheduledMessage, getScheduledMessages } from '../../services/scheduledMessageService.js';
import { parseDuration } from '../../services/giveawayService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule a message to be sent in a channel')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Schedule a new message')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to send the message in')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('When to send it (e.g. 10m, 1h, 7d)')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('message')
            .setDescription('The message content')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Cancel a scheduled message')
        .addStringOption(option =>
          option.setName('id')
            .setDescription('The ID of the scheduled message to cancel')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all scheduled messages in this server')),

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'create') {
        const channel = interaction.options.getChannel('channel', true);
        const durationStr = interaction.options.getString('duration', true);
        const content = interaction.options.getString('message', true);

        if (!channel.isTextBased()) {
          await InteractionHelper.safeReply(interaction, {
            content: 'Please select a text channel.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const ms = parseDuration(durationStr);
        const scheduledAt = Date.now() + ms;

        const entry = await scheduleMessage(
          interaction.client,
          interaction.guildId,
          channel.id,
          content,
          scheduledAt,
        );

        const minutes = Math.floor(ms / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        let timeStr;
        if (days > 0) timeStr = `${days}d ${hours % 24}h`;
        else if (hours > 0) timeStr = `${hours}h ${minutes % 60}m`;
        else timeStr = `${minutes}m`;

        const embed = createEmbed({
          title: '📅 Message Scheduled',
          description: `Message will be sent in <#${channel.id}> in **${timeStr}**.\n\`\`\`${content}\`\`\`\n**ID:** \`${entry.id}\``,
          color: 0x6B3FA0,
        });

        await InteractionHelper.safeReply(interaction, { embeds: [embed] });
        logger.info(`Message scheduled in guild ${interaction.guildId}`, { channelId: channel.id, duration: durationStr });
      } else if (subcommand === 'cancel') {
        const id = interaction.options.getString('id', true);
        const cancelled = await cancelScheduledMessage(interaction.client, interaction.guildId, id);

        if (cancelled) {
          await InteractionHelper.safeReply(interaction, {
            content: `✅ Cancelled scheduled message \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await InteractionHelper.safeReply(interaction, {
            content: `Could not find scheduled message with ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      } else if (subcommand === 'list') {
        const messages = await getScheduledMessages(interaction.client, interaction.guildId);

        if (messages.length === 0) {
          await InteractionHelper.safeReply(interaction, {
            content: 'No scheduled messages in this server.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const list = messages
          .sort((a, b) => a.scheduledAt - b.scheduledAt)
          .map(m => {
            const time = `<t:${Math.floor(m.scheduledAt / 1000)}:R>`;
            const channel = m.channelId ? `<#${m.channelId}>` : 'deleted-channel';
            return `\`${m.id}\` → ${channel} ${time}\n> ${m.content.slice(0, 100)}`;
          })
          .join('\n\n');

        const embed = createEmbed({
          title: `📅 Scheduled Messages (${messages.length})`,
          description: list.slice(0, 4000),
          color: 0x6B3FA0,
        });

        await InteractionHelper.safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error('Schedule command failed:', error);
      await handleInteractionError(interaction, error, {
        commandName: 'schedule',
        source: 'schedule_command',
      });
    }
  },
};
