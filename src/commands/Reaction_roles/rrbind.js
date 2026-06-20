import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../services/guildConfig.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rrbind')
    .setDescription('Bind an emoji reaction to a role on an existing message')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Bind an emoji + role to a message')
        .addStringOption(o => o.setName('channel-id').setDescription('Channel ID where the message is').setRequired(true))
        .addStringOption(o => o.setName('message-id').setDescription('Message ID to bind to').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('Emoji to react with (e.g. ✅)').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove an emoji reaction binding')
        .addStringOption(o => o.setName('channel-id').setDescription('Channel ID where the message is').setRequired(true))
        .addStringOption(o => o.setName('message-id').setDescription('Message ID of the binding').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('Emoji to unbind').setRequired(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List all emoji reaction bindings on this server'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'set') {
      await handleSet(interaction, guild);
    } else if (sub === 'remove') {
      await handleRemove(interaction, guild);
    } else if (sub === 'list') {
      await handleList(interaction, guild);
    }
  },
};

async function handleSet(interaction, guild) {
  await interaction.deferReply({ flags: 64 });

  const channelId = interaction.options.getString('channel-id');
  const messageId = interaction.options.getString('message-id');
  const emoji = interaction.options.getString('emoji');
  const role = interaction.options.getRole('role');

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    return interaction.editReply('❌ Channel not found. Double-check the channel ID.');
  }

  let message;
  try {
    message = await channel.messages.fetch(messageId);
  } catch {
    return interaction.editReply('❌ Message not found in that channel. Check the message ID.');
  }

  if (role.position >= guild.members.me.roles.highest.position) {
    return interaction.editReply('❌ That role is higher than my highest role. Move my role higher in Server Settings > Roles.');
  }

  const config = await getGuildConfig(interaction.client, guild.id);
  const bindings = config.emojiReactions || [];

  const existingIndex = bindings.findIndex(
    b => b.channelId === channelId && b.messageId === messageId && b.emoji === emoji
  );

  if (existingIndex !== -1) {
    bindings[existingIndex].roleId = role.id;
  } else {
    bindings.push({ channelId, messageId, emoji, roleId: role.id });
  }

  config.emojiReactions = bindings;
  await setGuildConfig(interaction.client, guild.id, config);

  try {
    await message.react(emoji);
  } catch {
    // Emoji might already be there or invalid — non-fatal
  }

  const embed = new EmbedBuilder()
    .setColor(0x6B3FA0)
    .setTitle('✅ Reaction Binding Set')
    .setDescription(`**Emoji:** ${emoji}\n**Role:** ${role}\n**Channel:** <#${channelId}>\n[Jump to message](https://discord.com/channels/${guild.id}/${channelId}/${messageId})`);

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction, guild) {
  await interaction.deferReply({ flags: 64 });

  const channelId = interaction.options.getString('channel-id');
  const messageId = interaction.options.getString('message-id');
  const emoji = interaction.options.getString('emoji');

  const config = await getGuildConfig(interaction.client, guild.id);
  const bindings = config.emojiReactions || [];

  const index = bindings.findIndex(
    b => b.channelId === channelId && b.messageId === messageId && b.emoji === emoji
  );

  if (index === -1) {
    return interaction.editReply('❌ No binding found for that message + emoji.');
  }

  bindings.splice(index, 1);
  config.emojiReactions = bindings.length > 0 ? bindings : [];
  await setGuildConfig(interaction.client, guild.id, config);

  await interaction.editReply('✅ Binding removed.');
}

async function handleList(interaction, guild) {
  await interaction.deferReply({ flags: 64 });

  const config = await getGuildConfig(interaction.client, guild.id);
  const bindings = config.emojiReactions || [];

  if (bindings.length === 0) {
    return interaction.editReply('No emoji reaction bindings set up on this server.');
  }

  const lines = bindings.map((b, i) => {
    const roleMention = guild.roles.cache.get(b.roleId)?.name || b.roleId;
    return `${i + 1}. ${b.emoji} → **${roleMention}** in <#${b.channelId}> ([jump](https://discord.com/channels/${guild.id}/${b.channelId}/${b.messageId}))`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x6B3FA0)
    .setTitle('Emoji Reaction Bindings')
    .setDescription(lines.join('\n'));

  await interaction.editReply({ embeds: [embed] });
}
