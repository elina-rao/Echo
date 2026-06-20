import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getJoinToCreateConfig, registerTemporaryChannel } from '../../utils/database.js';
import {
    lockChannel,
    unlockChannel,
    approveUser,
    denyUser,
    kickUser,
    claimOwnership,
    promoteUser,
} from '../../services/joinToCreateService.js';

export default {
    data: new SlashCommandBuilder()
        .setName("vc")
        .setDescription("Manage your temporary voice channel.")
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("lock")
                .setDescription("Lock your VC so no one new can join.")
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("unlock")
                .setDescription("Unlock your VC.")
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("allow")
                .setDescription("Allow a user to join your locked VC.")
                .addUserOption((option) =>
                    option.setName("user").setDescription("The user to allow.").setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("deny")
                .setDescription("Remove a user's access to your VC and disconnect them.")
                .addUserOption((option) =>
                    option.setName("user").setDescription("The user to deny.").setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("kick")
                .setDescription("Kick a user from your VC.")
                .addUserOption((option) =>
                    option.setName("user").setDescription("The user to kick.").setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("claim")
                .setDescription("Claim ownership of an abandoned temporary VC.")
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("promote")
                .setDescription("Transfer VC ownership to another member in the channel.")
                .addUserOption((option) =>
                    option.setName("user").setDescription("The new owner.").setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("limit")
                .setDescription("Set the user limit for your VC.")
                .addIntegerOption((option) =>
                    option.setName("limit")
                        .setDescription("Max users (0 = unlimited, max 99).")
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(99)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("rename")
                .setDescription("Rename your VC.")
                .addStringOption((option) =>
                    option.setName("name")
                        .setDescription("New channel name.")
                        .setRequired(true)
                        .setMaxLength(100)
                )
        ),
    category: "utility",

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();
        const member = interaction.member;
        const guild = interaction.guild;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({
                embeds: [warningEmbed('You must be in a temporary voice channel to use this command.')],
                flags: 64,
            });
        }

        const j2cConfig = await getJoinToCreateConfig(client, guild.id);
        const tempInfo = j2cConfig.temporaryChannels?.[voiceChannel.id];

        if (!tempInfo && subcommand !== 'claim') {
            return interaction.reply({
                embeds: [warningEmbed('You are not in a temporary voice channel.')],
                flags: 64,
            });
        }

        if (tempInfo && tempInfo.ownerId !== member.id && subcommand !== 'claim') {
            const hasManageChannels = member.permissions.has(PermissionFlagsBits.ManageChannels);
            if (!hasManageChannels) {
                return interaction.reply({
                    embeds: [warningEmbed('You do not own this voice channel.')],
                    flags: 64,
                });
            }
        }

        try {
            switch (subcommand) {
                case 'lock': {
                    await lockChannel(client, guild.id, voiceChannel.id, member.id);
                    await interaction.reply({
                        embeds: [successEmbed('🔒 VC locked. No one new can join until you unlock it.')],
                        flags: 64,
                    });
                    break;
                }

                case 'unlock': {
                    await unlockChannel(client, guild.id, voiceChannel.id, member.id);
                    await interaction.reply({
                        embeds: [successEmbed('🔓 VC unlocked. Anyone can now join.')],
                        flags: 64,
                    });
                    break;
                }

                case 'allow': {
                    const target = interaction.options.getUser('user');
                    await approveUser(client, guild.id, voiceChannel.id, member.id, target.id);
                    await interaction.reply({
                        embeds: [successEmbed(`✅ ${target.username} has been allowed to join your VC.`)],
                        flags: 64,
                    });
                    break;
                }

                case 'deny': {
                    const target = interaction.options.getUser('user');
                    await denyUser(client, guild.id, voiceChannel.id, member.id, target.id);
                    await interaction.reply({
                        embeds: [successEmbed(`❌ ${target.username} has been denied access to your VC.`)],
                        flags: 64,
                    });
                    break;
                }

                case 'kick': {
                    const target = interaction.options.getUser('user');
                    const targetMember = guild.members.cache.get(target.id);
                    if (targetMember?.voice?.channelId !== voiceChannel.id) {
                        return interaction.reply({
                            embeds: [warningEmbed(`${target.username} is not in your VC.`)],
                            flags: 64,
                        });
                    }
                    if (target.id === member.id) {
                        return interaction.reply({
                            embeds: [warningEmbed('You cannot kick yourself.')],
                            flags: 64,
                        });
                    }
                    await kickUser(client, guild.id, voiceChannel.id, member.id, target.id);
                    await interaction.reply({
                        embeds: [successEmbed(`👢 ${target.username} has been kicked from your VC.`)],
                        flags: 64,
                    });
                    break;
                }

                case 'claim': {
                    if (!voiceChannel) {
                        return interaction.reply({
                            embeds: [warningEmbed('You must be in a voice channel to claim it.')],
                            flags: 64,
                        });
                    }
                    const claimInfo = j2cConfig.temporaryChannels?.[voiceChannel.id];
                    if (!claimInfo) {
                        return interaction.reply({
                            embeds: [warningEmbed('This is not a temporary voice channel.')],
                            flags: 64,
                        });
                    }
                    if (claimInfo.ownerId === member.id) {
                        return interaction.reply({
                            embeds: [warningEmbed('You already own this channel.')],
                            flags: 64,
                        });
                    }
                    const currentOwner = guild.members.cache.get(claimInfo.ownerId);
                    if (currentOwner?.voice?.channelId === voiceChannel.id) {
                        return interaction.reply({
                            embeds: [warningEmbed('The current owner is still in this channel.')],
                            flags: 64,
                        });
                    }
                    await claimOwnership(client, guild.id, voiceChannel.id, member.id);
                    await interaction.reply({
                        embeds: [successEmbed('👑 You are now the owner of this VC.')],
                        flags: 64,
                    });
                    break;
                }

                case 'promote': {
                    const promoteTarget = interaction.options.getUser('user');
                    const promoteMember = guild.members.cache.get(promoteTarget.id);
                    if (promoteTarget.id === member.id) {
                        return interaction.reply({
                            embeds: [warningEmbed('You cannot promote yourself.')],
                            flags: 64,
                        });
                    }
                    if (promoteMember?.voice?.channelId !== voiceChannel.id) {
                        return interaction.reply({
                            embeds: [warningEmbed(`${promoteTarget.username} is not in your VC.`)],
                            flags: 64,
                        });
                    }
                    await promoteUser(client, guild.id, voiceChannel.id, member.id, promoteTarget.id);
                    await interaction.reply({
                        embeds: [successEmbed(`👑 Transferred ownership to ${promoteTarget.username}.`)],
                        flags: 64,
                    });
                    break;
                }

                case 'limit': {
                    const limit = interaction.options.getInteger('limit');
                    await voiceChannel.edit({ userLimit: limit === 0 ? undefined : limit }, `User limit set by ${member.id}`);
                    await interaction.reply({
                        embeds: [successEmbed(`👥 User limit set to ${limit === 0 ? 'unlimited' : limit}.`)],
                        flags: 64,
                    });
                    break;
                }

                case 'rename': {
                    const name = interaction.options.getString('name');
                    if (/[@#:`]/.test(name)) {
                        return interaction.reply({
                            embeds: [warningEmbed('Channel name cannot contain @, #, :, or backtick.')],
                            flags: 64,
                        });
                    }
                    const sanitized = name.replace(/[\x00-\x1F\x7F]/g, '').trim().substring(0, 100);
                    if (!sanitized) {
                        return interaction.reply({
                            embeds: [warningEmbed('Invalid channel name.')],
                            flags: 64,
                        });
                    }
                    await voiceChannel.edit({ name: sanitized }, `Renamed by ${member.id}`);
                    await interaction.reply({
                        embeds: [successEmbed(`✏️ VC renamed to **${sanitized}**.`)],
                        flags: 64,
                    });
                    break;
                }
            }
        } catch (error) {
            logger.error(`VC command error (${subcommand}):`, error);
            await interaction.reply({
                embeds: [warningEmbed(error.userMessage || `Failed to ${subcommand} the VC.`)],
                flags: 64,
            });
        }
    },
};
