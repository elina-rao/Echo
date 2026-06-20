import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getTag, setTag, deleteTag, getTagNames, getTagList } from '../../services/tagService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Show or manage saved tags / FAQ entries')
    .addSubcommand(sub =>
      sub
        .setName('show')
        .setDescription('Show a tag')
        .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new tag')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true))
        .addStringOption(o => o.setName('content').setDescription('Tag content').setRequired(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Edit an existing tag')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('content').setDescription('New tag content').setRequired(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete a tag')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List all tags on this server'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'show') {
      const name = interaction.options.getString('name');
      const tag = await getTag(interaction.client, guildId, name);
      if (!tag) {
        return InteractionHelper.safeEditReply(interaction, { content: `❌ Tag **${name}** not found.`, flags: 64 });
      }
      const embed = new EmbedBuilder()
        .setColor(0x6B3FA0)
        .setDescription(tag.content)
        .setFooter({ text: `Tag: ${tag.name}` })
        .setTimestamp();
      return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    if (sub === 'create') {
      const name = interaction.options.getString('name');
      const content = interaction.options.getString('content');
      const existing = await getTag(interaction.client, guildId, name);
      if (existing) {
        return InteractionHelper.safeEditReply(interaction, { content: `❌ Tag **${name}** already exists. Use \`/tag edit\` to update it.`, flags: 64 });
      }
      const ok = await setTag(interaction.client, guildId, name, content, interaction.user.id);
      if (ok) {
        return InteractionHelper.safeEditReply(interaction, { content: `✅ Tag **${name}** created.`, flags: 64 });
      }
      return InteractionHelper.safeEditReply(interaction, { content: '❌ Failed to create tag.', flags: 64 });
    }

    if (sub === 'edit') {
      const name = interaction.options.getString('name');
      const content = interaction.options.getString('content');
      const existing = await getTag(interaction.client, guildId, name);
      if (!existing) {
        return InteractionHelper.safeEditReply(interaction, { content: `❌ Tag **${name}** not found.`, flags: 64 });
      }
      const ok = await setTag(interaction.client, guildId, name, content, interaction.user.id);
      if (ok) {
        return InteractionHelper.safeEditReply(interaction, { content: `✅ Tag **${name}** updated.`, flags: 64 });
      }
      return InteractionHelper.safeEditReply(interaction, { content: '❌ Failed to update tag.', flags: 64 });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name');
      const existing = await getTag(interaction.client, guildId, name);
      if (!existing) {
        return InteractionHelper.safeEditReply(interaction, { content: `❌ Tag **${name}** not found.`, flags: 64 });
      }
      const ok = await deleteTag(interaction.client, guildId, name);
      if (ok) {
        return InteractionHelper.safeEditReply(interaction, { content: `✅ Tag **${name}** deleted.`, flags: 64 });
      }
      return InteractionHelper.safeEditReply(interaction, { content: '❌ Failed to delete tag.', flags: 64 });
    }

    if (sub === 'list') {
      const tags = await getTagNames(interaction.client, guildId);
      if (tags.length === 0) {
        return InteractionHelper.safeEditReply(interaction, { content: 'No tags on this server. Create one with `/tag create`.', flags: 64 });
      }
      const embed = new EmbedBuilder()
        .setColor(0x6B3FA0)
        .setTitle('📋 Server Tags')
        .setDescription(tags.map(t => `• **${t}**`).join('\n'));
      return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const tags = await getTagNames(interaction.client, interaction.guildId);
    const filtered = tags.filter(t => t.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
    await interaction.respond(filtered.map(t => ({ name: t, value: t })));
  },
};
