const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guild_filters (
    guild_id TEXT PRIMARY KEY,
    filter_nsfw INTEGER DEFAULT 1,
    filter_hate INTEGER DEFAULT 1,
    filter_spam INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = {
  getConfig(guildId) {
    return db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
  },
  setConfig(guildId, channelId) {
    return db.prepare(`
      INSERT INTO guild_config (guild_id, channel_id, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        updated_at = CURRENT_TIMESTAMP
    `).run(guildId, channelId);
  },
  getFilters(guildId) {
    return db.prepare('SELECT * FROM guild_filters WHERE guild_id = ?').get(guildId)
      || { guild_id: guildId, filter_nsfw: 1, filter_hate: 1, filter_spam: 1 };
  },
  setFilters(guildId, filterNsfw, filterHate, filterSpam) {
    return db.prepare(`
      INSERT INTO guild_filters (guild_id, filter_nsfw, filter_hate, filter_spam, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id) DO UPDATE SET
        filter_nsfw = excluded.filter_nsfw,
        filter_hate = excluded.filter_hate,
        filter_spam = excluded.filter_spam,
        updated_at = CURRENT_TIMESTAMP
    `).run(guildId, filterNsfw ? 1 : 0, filterHate ? 1 : 0, filterSpam ? 1 : 0);
  }
};
