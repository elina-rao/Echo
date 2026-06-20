import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getMemberInvites, getInviteLeaderboard } from '../../services/inviteService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('View your invites or the server invite leaderboard')
    .addSubcommand(sub =>
      sub
        .setName('me')
        .setDescription('Show how many people you have invited'),
    )
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('Show the top inviters on this server'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'me') {
      await handleMe(interaction, guild);
    } else if (sub === 'leaderboard') {
      await handleLeaderboard(interaction, guild);
    }
  },
};

async function handleMe(interaction, guild) {
  await interaction.deferReply({ flags: 64 });

  const data = await getMemberInvites(interaction.client, guild.id, interaction.user.id);
  const count = data.invites || 0;

  const embed = new EmbedBuilder()
    .setColor(0x6B3FA0)
    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(`You have invited **${count}** ${count === 1 ? 'person' : 'people'} to this server.`);

  await interaction.editReply({ embeds: [embed] });
}

async function handleLeaderboard(interaction, guild) {
  await interaction.deferReply({ flags: 64 });

  const entries = await getInviteLeaderboard(interaction.client, guild.id);

  if (entries.length === 0) {
    return interaction.editReply('No invites tracked yet on this server.');
  }

  const lines = await Promise.all(entries.map(async (e, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    let name = e.userId;
    try {
      const user = await interaction.client.users.fetch(e.userId);
      name = user.tag;
    } catch {}
    return `${medal} **${name}** — ${e.invites} ${e.invites === 1 ? 'invite' : 'invites'}`;
  }));

  const embed = new EmbedBuilder()
    .setColor(0x6B3FA0)
    .setTitle('📊 Invite Leaderboard')
    .setDescription(lines.join('\n'));

  await interaction.editReply({ embeds: [embed] });
}
