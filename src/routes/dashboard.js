import { Router } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { getGuildConfig as fetchGuildConfig, setGuildConfig as saveGuildConfig } from '../services/guildConfig.js';
import {
  getWelcomeConfig as fetchWelcomeConfig,
  saveWelcomeConfig as persistWelcomeConfig,
  getLevelingConfig as fetchLevelingConfig,
  saveLevelingConfig as persistLevelingConfig,
  getJoinToCreateConfig as fetchJoinToCreateConfig,
  saveJoinToCreateConfig as persistJoinToCreateConfig,
} from '../utils/database.js';

const router = Router();

const DISCORD_API = 'https://discord.com/api/v10';

function getClient(req) {
  return req.app.get('discordClient');
}

function requireAuth(req, res, next) {
  if (!req.session?.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

router.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauth2State = state;

  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: process.env.DASHBOARD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });

  req.session.save(err => {
    if (err) {
      logger.error('Session save error during login:', err);
      return res.status(500).json({ error: 'Session error' });
    }
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  });
});

router.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.redirect('/dashboard.html?error=missing_code');
  }

  if (!state || state !== req.session.oauth2State) {
    return res.redirect('/dashboard.html?error=csrf');
  }

  delete req.session.oauth2State;

  try {
    const tokenBody = new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DASHBOARD_REDIRECT_URI,
    });

    const tokenResp = await axios.post(`${DISCORD_API}/oauth2/token`, tokenBody.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    req.session.accessToken = tokenResp.data.access_token;
    req.session.tokenType = tokenResp.data.token_type;

    const { data: user } = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `${req.session.tokenType} ${req.session.accessToken}` },
    });
    req.session.userId = user.id;

    req.session.save(err => {
      if (err) {
        logger.error('Session save error after OAuth callback:', err);
        return res.redirect('/dashboard.html?error=session');
      }
      res.redirect(process.env.DASHBOARD_SUCCESS_URL || '/dashboard.html');
    });
  } catch (error) {
    logger.error('OAuth token exchange failed:', error.response?.data || error.message);
    res.redirect('/dashboard.html?error=auth_failed');
  }
});

router.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `${req.session.tokenType} ${req.session.accessToken}` },
    });
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch current user:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

async function requireDashboardAccess(req, res, next) {
  const { guildId } = req.params;

  if (!req.session.userId) {
    return res.status(401).json({ error: 'User ID not found in session' });
  }

  const client = getClient(req);
  const guild = client?.guilds?.cache?.get(guildId);

  if (!guild) {
    return res.status(404).json({ error: 'Guild not found or bot not present' });
  }

  try {
    const config = await fetchGuildConfig(client, guildId);
    const allowedRoles = config.dashboardAccessRoles;

    if (!allowedRoles || allowedRoles.length === 0) {
      return next();
    }

    let member = guild.members.cache.get(req.session.userId);
    if (!member) {
      try {
        member = await guild.members.fetch(req.session.userId);
      } catch {
        return res.status(403).json({ error: 'Access denied. You must be a member of this server.' });
      }
    }

    const hasRole = member.roles.cache.some(r => allowedRoles.includes(r.id));
    if (!hasRole) {
      return res.status(403).json({ error: 'Access denied. You do not have the required role to access the dashboard.' });
    }

    next();
  } catch (error) {
    logger.error(`Dashboard access check failed for guild ${guildId}:`, error);
    next();
  }
}

router.get('/guilds', requireAuth, async (req, res) => {
  try {
    const { data: guilds } = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `${req.session.tokenType} ${req.session.accessToken}` },
    });

    const client = getClient(req);
    const ADMINISTRATOR = 0x8n;
    const MANAGE_GUILD = 0x20n;

    const mapped = guilds.map(guild => {
      const perms = BigInt(guild.permissions);
      const canManage = (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;

      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: Boolean(guild.owner),
        canManage,
        botActive: client?.guilds?.cache?.has(guild.id) || false,
      };
    });

    const manageable = mapped.filter(g => g.canManage);
    res.json(manageable);
  } catch (error) {
    logger.error('Failed to fetch guilds:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch guilds' });
  }
});

router.get('/guilds/:guildId/channels', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient(req);
  const guild = client?.guilds?.cache?.get(guildId);

  if (!guild) {
    return res.status(404).json({ error: 'Guild not found or bot not present' });
  }

  const channels = guild.channels.cache
    .filter(c => c.isTextBased?.() && c.type !== 4)
    .map(c => ({ id: c.id, name: c.name, type: c.type }));

  res.json(channels);
});

router.get('/guilds/:guildId/voice-channels', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient(req);
  const guild = client?.guilds?.cache?.get(guildId);

  if (!guild) {
    return res.status(404).json({ error: 'Guild not found or bot not present' });
  }

  const channels = guild.channels.cache
    .filter(c => c.type === 2)
    .map(c => ({ id: c.id, name: c.name, type: c.type }));

  res.json(channels);
});

router.get('/guilds/:guildId/roles', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient(req);
  const guild = client?.guilds?.cache?.get(guildId);

  if (!guild) {
    return res.status(404).json({ error: 'Guild not found or bot not present' });
  }

  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
    .sort((a, b) => b.name.localeCompare(a.name));

  res.json(roles);
});

router.get('/settings/:guildId', requireAuth, requireDashboardAccess, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient(req);

  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found or bot not present' });
  }

  try {
    const [guildConfig, welcomeConfig, levelingConfig, joinToCreateConfig] = await Promise.all([
      fetchGuildConfig(client, guildId),
      fetchWelcomeConfig(client, guildId),
      fetchLevelingConfig(client, guildId),
      fetchJoinToCreateConfig(client, guildId),
    ]);

    res.json({
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        memberCount: guild.memberCount,
      },
      config: guildConfig,
      welcome: welcomeConfig,
      leveling: levelingConfig,
      joinToCreate: joinToCreateConfig,
    });
  } catch (error) {
    logger.error(`Failed to fetch settings for guild ${guildId}:`, error);
    res.status(500).json({ error: 'Failed to load server configuration' });
  }
});

router.post('/settings/:guildId', requireAuth, requireDashboardAccess, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient(req);
  const guild = client?.guilds?.cache?.get(guildId);

  if (!guild) {
    return res.status(404).json({ error: 'Guild not found or bot not present' });
  }

  const body = req.body;

  try {
    const results = {};
    const errors = [];

    if (body.config !== undefined) {
      const ok = await saveGuildConfig(client, guildId, body.config);
      if (ok) {
        results.config = true;
      } else {
        errors.push('Failed to save guild config');
      }
    }

    if (body.welcome !== undefined) {
      const ok = await persistWelcomeConfig(client, guildId, body.welcome);
      if (ok) {
        results.welcome = true;
      } else {
        errors.push('Failed to save welcome config');
      }
    }

    if (body.leveling !== undefined) {
      const ok = await persistLevelingConfig(client, guildId, body.leveling);
      if (ok) {
        results.leveling = true;
      } else {
        errors.push('Failed to save leveling config');
      }
    }

    if (body.joinToCreate !== undefined) {
      const j2c = body.joinToCreate;
      const currentJ2C = await fetchJoinToCreateConfig(client, guildId);
      const merged = {
        ...currentJ2C,
        enabled: Boolean(j2c.enabled),
        triggerChannels: j2c.triggerChannels || [],
      };
      const ok = await persistJoinToCreateConfig(client, guildId, merged);
      if (ok) {
        results.joinToCreate = true;
      } else {
        errors.push('Failed to save join-to-create config');
      }
    }

    res.json({ success: errors.length === 0, results, errors });
  } catch (error) {
    logger.error(`Failed to save settings for guild ${guildId}:`, error);
    res.status(500).json({ error: 'Failed to save server configuration' });
  }
});

router.get('/settings/:guildId/access-roles', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient(req);

  try {
    const config = await fetchGuildConfig(client, guildId);
    res.json({ roleIds: config.dashboardAccessRoles || [] });
  } catch (error) {
    logger.error(`Failed to fetch access roles for guild ${guildId}:`, error);
    res.status(500).json({ error: 'Failed to fetch access roles' });
  }
});

router.put('/settings/:guildId/access-roles', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient(req);
  const { roleIds } = req.body;

  if (!Array.isArray(roleIds)) {
    return res.status(400).json({ error: 'roleIds must be an array' });
  }

  try {
    const config = await fetchGuildConfig(client, guildId);
    config.dashboardAccessRoles = roleIds;
    const saved = await saveGuildConfig(client, guildId, config);
    if (saved) {
      res.json({ success: true, roleIds });
    } else {
      res.status(500).json({ error: 'Failed to save access roles' });
    }
  } catch (error) {
    logger.error(`Failed to save access roles for guild ${guildId}:`, error);
    res.status(500).json({ error: 'Failed to save access roles' });
  }
});

router.get('/tags/:guildId', requireAuth, async (req, res) => {
  try {
    const { getTagList } = await import('../services/tagService.js');
    const tags = await getTagList(req.app.get('discordClient'), req.params.guildId);
    res.json({ tags });
  } catch (error) {
    logger.error(`Failed to fetch tags for guild ${req.params.guildId}:`, error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

router.get('/command-logs/:guildId', requireAuth, async (req, res) => {
  try {
    const { getGuildCommandLogs, getCommandLogStats } = await import('../utils/database/commandLogs.js');
    const { guildId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.query.userId || null;
    const commandName = req.query.commandName || null;

    const [logs, stats] = await Promise.all([
      getGuildCommandLogs(guildId, { limit, offset, userId, commandName }),
      getCommandLogStats(guildId),
    ]);

    res.json({ ...logs, stats });
  } catch (error) {
    logger.error(`Failed to fetch command logs for guild ${req.params.guildId}:`, error);
    res.status(500).json({ error: 'Failed to fetch command logs' });
  }
});

router.get('/scheduled/:guildId', requireAuth, async (req, res) => {
  try {
    const { getScheduledMessages } = await import('../services/scheduledMessageService.js');
    const messages = await getScheduledMessages(req.app.get('discordClient'), req.params.guildId);
    res.json({ messages });
  } catch (error) {
    logger.error(`Failed to fetch scheduled messages for guild ${req.params.guildId}:`, error);
    res.status(500).json({ error: 'Failed to fetch scheduled messages' });
  }
});

/* ───── Tickets ───── */

router.get('/tickets/:guildId', requireAuth, async (req, res) => {
  try {
    const { getGuildTicketStats, listGuildTickets } = await import('../utils/database/tickets.js');
    const { guildId } = req.params;
    const client = getClient(req);
    const config = await fetchGuildConfig(client, guildId);

    const ticketConfig = {
      panelChannelId: config.ticketPanelChannelId || null,
      panelMessageId: config.ticketPanelMessageId || null,
      panelMessage: config.ticketPanelMessage || 'Click the button below to create a support ticket.',
      buttonLabel: config.ticketButtonLabel || 'Create Ticket',
      categoryId: config.ticketCategoryId || null,
      closedCategoryId: config.ticketClosedCategoryId || null,
      staffRoleId: config.ticketStaffRoleId || null,
      logsChannelId: config.ticketLogsChannelId || null,
      transcriptChannelId: config.ticketTranscriptChannelId || null,
      maxTicketsPerUser: config.maxTicketsPerUser || 3,
      dmOnClose: config.dmOnClose !== false,
      enablePriority: config.enablePriority || false,
    };

    const [stats, tickets] = await Promise.all([
      getGuildTicketStats(guildId),
      listGuildTickets(guildId),
    ]);

    const openTickets = tickets.filter(t => t.status === 'open');
    const closedTickets = tickets.filter(t => t.status === 'closed').slice(-20);

    res.json({ config: ticketConfig, stats, openTickets, closedTickets });
  } catch (error) {
    logger.error(`Failed to fetch tickets for guild ${req.params.guildId}:`, error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

/* ───── Reaction Roles ───── */

router.get('/reaction-roles/:guildId', requireAuth, async (req, res) => {
  try {
    const { getAllReactionRoleMessages, getReactionRoleMessage } = await import('../services/reactionRoleService.js');
    const client = getClient(req);
    const guildId = req.params.guildId;
    const guild = client?.guilds?.cache?.get(guildId);

    const panels = await getAllReactionRoleMessages(client, guildId);

    const enriched = await Promise.all(panels.map(async (panel) => {
      const channel = guild?.channels?.cache?.get(panel.channelId);
      let messageExists = false;
      let title = '';
      let description = '';

      if (channel) {
        try {
          const msg = await channel.messages.fetch(panel.messageId);
          messageExists = true;
          title = msg.embeds?.[0]?.title || '';
          description = msg.embeds?.[0]?.description || '';
        } catch {
          messageExists = false;
        }
      }

      const roleIds = Array.isArray(panel.roles)
        ? panel.roles
        : (typeof panel.roles === 'object' ? Object.values(panel.roles) : []);

      const roles = roleIds.map(rid => {
        const r = guild?.roles?.cache?.get(rid);
        return { id: rid, name: r?.name || 'Unknown', color: r?.hexColor || '#000000' };
      });

      return {
        ...panel,
        title,
        description,
        messageExists,
        channelName: channel?.name || 'deleted-channel',
        roles,
      };
    }));

    res.json({ panels: enriched });
  } catch (error) {
    logger.error(`Failed to fetch reaction roles for guild ${req.params.guildId}:`, error);
    res.status(500).json({ error: 'Failed to fetch reaction roles' });
  }
});

router.delete('/reaction-roles/:guildId/:messageId', requireAuth, async (req, res) => {
  try {
    const { deleteReactionRoleMessage } = await import('../services/reactionRoleService.js');
    const client = getClient(req);
    await deleteReactionRoleMessage(client, req.params.guildId, req.params.messageId);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to delete reaction role panel:`, error);
    res.status(500).json({ error: 'Failed to delete panel' });
  }
});

/* ───── Economy ───── */

router.get('/economy/:guildId', requireAuth, async (req, res) => {
  try {
    const client = getClient(req);
    const guildId = req.params.guildId;
    const config = await fetchGuildConfig(client, guildId);

    const economyConfig = {
      enabled: config.economyEnabled !== false,
      workMin: config.economyWorkMin || 10,
      workMax: config.economyWorkMax || 100,
      daily: config.economyDaily || 100,
      premiumRoleId: config.economyPremiumRoleId || null,
      shopItems: config.economyShopItems || [],
    };

    let stats = { totalUsers: 0, totalCoins: 0, topBalances: [] };
    if (client.db?.db?.pool && typeof client.db.db.isAvailable === 'function' && client.db.db.isAvailable()) {
      const { pgConfig } = await import('../../config/postgres.js');
      const topResult = await client.db.db.pool.query(
        `SELECT user_id, (data->>'wallet')::bigint + (data->>'bank')::bigint AS total
         FROM ${pgConfig.tables.economy}
         WHERE guild_id = $1
         ORDER BY total DESC LIMIT 10`,
        [guildId],
      );
      const countResult = await client.db.db.pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM((data->>'wallet')::bigint + (data->>'bank')::bigint), 0)::bigint AS total
         FROM ${pgConfig.tables.economy}
         WHERE guild_id = $1`,
        [guildId],
      );

      stats = {
        totalUsers: Number(countResult.rows[0]?.count || 0),
        totalCoins: Number(countResult.rows[0]?.total || 0),
        topBalances: topResult.rows.map(r => ({
          userId: r.user_id,
          total: Number(r.total),
        })),
      };
    }

    res.json({ config: economyConfig, stats });
  } catch (error) {
    logger.error(`Failed to fetch economy for guild ${req.params.guildId}:`, error);
    res.status(500).json({ error: 'Failed to fetch economy data' });
  }
});

router.post('/economy/:guildId/shop', requireAuth, async (req, res) => {
  try {
    const client = getClient(req);
    const guildId = req.params.guildId;
    const item = req.body;

    if (!item.name || !item.price) {
      return res.status(400).json({ error: 'Item must have a name and price' });
    }

    const config = await fetchGuildConfig(client, guildId);
    const items = config.economyShopItems || [];
    const newItem = {
      id: item.id || `shop_${Date.now()}`,
      name: item.name,
      price: Number(item.price),
      description: item.description || '',
      emoji: item.emoji || '🛒',
      roleId: item.roleId || null,
      type: item.type || 'role',
    };
    items.push(newItem);
    config.economyShopItems = items;
    await saveGuildConfig(client, guildId, config);
    res.json({ success: true, item: newItem });
  } catch (error) {
    logger.error(`Failed to add shop item:`, error);
    res.status(500).json({ error: 'Failed to add shop item' });
  }
});

router.delete('/economy/:guildId/shop/:itemId', requireAuth, async (req, res) => {
  try {
    const client = getClient(req);
    const guildId = req.params.guildId;
    const itemId = req.params.itemId;
    const config = await fetchGuildConfig(client, guildId);
    const items = (config.economyShopItems || []).filter(i => i.id !== itemId);
    config.economyShopItems = items;
    await saveGuildConfig(client, guildId, config);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to delete shop item:`, error);
    res.status(500).json({ error: 'Failed to delete shop item' });
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

export default router;
