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
    const [guildConfig, welcomeConfig, levelingConfig] = await Promise.all([
      fetchGuildConfig(client, guildId),
      fetchWelcomeConfig(client, guildId),
      fetchLevelingConfig(client, guildId),
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
