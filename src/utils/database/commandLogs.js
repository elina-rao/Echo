import { logger } from '../logger.js';
import { db } from './wrapper.js';

export async function insertCommandLog(client, guildId, userId, userTag, commandName, options = {}) {
    try {
        if (!db.initialized) {
            await db.initialize();
        }

        if (db.db?.pool && typeof db.db.isAvailable === 'function' && db.db.isAvailable()) {
            const { pgConfig } = await import('../../config/postgres.js');
            await db.db.pool.query(
                `INSERT INTO ${pgConfig.tables.command_logs} (guild_id, user_id, user_tag, command_name, options)
                 VALUES ($1, $2, $3, $4, $5)`,
                [guildId, userId, userTag, commandName, options],
            );
        }
    } catch (error) {
        logger.error(`Failed to insert command log for /${commandName} in guild ${guildId}:`, error);
    }
}

export async function getGuildCommandLogs(guildId, { limit = 50, offset = 0, userId, commandName } = {}) {
    try {
        if (!db.initialized) {
            await db.initialize();
        }

        if (db.db?.pool && typeof db.db.isAvailable === 'function' && db.db.isAvailable()) {
            const { pgConfig } = await import('../../config/postgres.js');
            const params = [guildId];
            const conditions = ['guild_id = $1'];

            if (userId) {
                params.push(userId);
                conditions.push(`user_id = $${params.length}`);
            }
            if (commandName) {
                params.push(commandName);
                conditions.push(`command_name = $${params.length}`);
            }

            params.push(limit);
            params.push(offset);
            const whereClause = conditions.join(' AND ');

            const result = await db.db.pool.query(
                `SELECT id, user_id, user_tag, command_name, options, executed_at
                 FROM ${pgConfig.tables.command_logs}
                 WHERE ${whereClause}
                 ORDER BY executed_at DESC
                 LIMIT $${params.length - 1} OFFSET $${params.length}`,
                params,
            );

            const countResult = await db.db.pool.query(
                `SELECT COUNT(*)::int AS total
                 FROM ${pgConfig.tables.command_logs}
                 WHERE ${whereClause}`,
                params.slice(0, -2),
            );

            return {
                logs: result.rows.map(row => ({
                    id: row.id,
                    userId: row.user_id,
                    userTag: row.user_tag,
                    commandName: row.command_name,
                    options: row.options || {},
                    executedAt: row.executed_at,
                })),
                total: Number(countResult.rows[0]?.total || 0),
            };
        }

        return { logs: [], total: 0 };
    } catch (error) {
        logger.error(`Failed to fetch command logs for guild ${guildId}:`, error);
        return { logs: [], total: 0 };
    }
}

export async function getCommandLogStats(guildId) {
    try {
        if (!db.initialized) {
            await db.initialize();
        }

        if (db.db?.pool && typeof db.db.isAvailable === 'function' && db.db.isAvailable()) {
            const { pgConfig } = await import('../../config/postgres.js');

            const totalResult = await db.db.pool.query(
                `SELECT COUNT(*)::int AS total FROM ${pgConfig.tables.command_logs} WHERE guild_id = $1`,
                [guildId],
            );

            const topCommandsResult = await db.db.pool.query(
                `SELECT command_name, COUNT(*)::int AS count
                 FROM ${pgConfig.tables.command_logs}
                 WHERE guild_id = $1
                 GROUP BY command_name
                 ORDER BY count DESC
                 LIMIT 10`,
                [guildId],
            );

            const topUsersResult = await db.db.pool.query(
                `SELECT user_id, user_tag, COUNT(*)::int AS count
                 FROM ${pgConfig.tables.command_logs}
                 WHERE guild_id = $1
                 GROUP BY user_id, user_tag
                 ORDER BY count DESC
                 LIMIT 10`,
                [guildId],
            );

            const last24hResult = await db.db.pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM ${pgConfig.tables.command_logs}
                 WHERE guild_id = $1 AND executed_at > NOW() - INTERVAL '24 hours'`,
                [guildId],
            );

            return {
                total: Number(totalResult.rows[0]?.total || 0),
                last24h: Number(last24hResult.rows[0]?.count || 0),
                topCommands: topCommandsResult.rows.map(r => ({ name: r.command_name, count: Number(r.count) })),
                topUsers: topUsersResult.rows.map(r => ({ userId: r.user_id, userTag: r.user_tag, count: Number(r.count) })),
            };
        }

        return { total: 0, last24h: 0, topCommands: [], topUsers: [] };
    } catch (error) {
        logger.error(`Failed to fetch command log stats for guild ${guildId}:`, error);
        return { total: 0, last24h: 0, topCommands: [], topUsers: [] };
    }
}
