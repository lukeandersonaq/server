require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ─── Internal Bot API ─────────────────────────────────────────────────────────
app.get('/internal/config/:guildId', (req, res) => {
  const secret = req.headers['x-api-secret'];
  if (secret !== process.env.API_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const config = db.getConfig(req.params.guildId);
  res.json(config || { guild_id: req.params.guildId, channel_id: null });
});

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();

    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const guilds = await guildsRes.json();

    const adminGuilds = guilds.filter(g =>
      (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8)
    );

    req.session.user = {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      adminGuilds: adminGuilds.map(g => ({ id: g.id, name: g.name, icon: g.icon }))
    };

    res.redirect('/');
  } catch (err) {
    console.error('[Auth] OAuth error:', err);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const { id, username, avatar, adminGuilds } = req.session.user;
  res.json({ user: { id, username, avatar, adminGuilds } });
});

// Only return guilds where the bot is also a member
app.get('/api/guilds', requireAuth, async (req, res) => {
  try {
    const botGuildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    const botGuilds = await botGuildsRes.json();
    const botGuildIds = new Set(botGuilds.map(g => g.id));
    const filtered = req.session.user.adminGuilds.filter(g => botGuildIds.has(g.id));
    res.json(filtered);
  } catch (err) {
    console.error('[API] Failed to fetch bot guilds:', err);
    res.json(req.session.user.adminGuilds);
  }
});

// Bot invite URL
app.get('/api/invite', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=274877908992&scope=bot`;
  res.json({ url });
});

app.get('/api/channels/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const isAdmin = req.session.user.adminGuilds.some(g => g.id === guildId);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

  try {
    const channelsRes = await fetch(`https://discord.com/api/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    const channels = await channelsRes.json();
    const textChannels = channels
      .filter(c => c.type === 0)
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(textChannels);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

app.get('/api/config/:guildId', requireAuth, (req, res) => {
  const { guildId } = req.params;
  const isAdmin = req.session.user.adminGuilds.some(g => g.id === guildId);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
  const config = db.getConfig(guildId);
  res.json(config || { guild_id: guildId, channel_id: null });
});

app.post('/api/config', requireAuth, (req, res) => {
  const { guildId, channelId } = req.body;
  if (!guildId || !channelId) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = req.session.user.adminGuilds.some(g => g.id === guildId);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    db.setConfig(guildId, channelId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});
