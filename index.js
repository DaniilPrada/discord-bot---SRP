// index.js
// Discord moderation + rank + utility + music bot (RU messages)

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus,
  getVoiceConnection,
  StreamType,
} = require("@discordjs/voice");

const Canvas = require("canvas");
const Database = require("better-sqlite3");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");

const {
  startAlertsLoop,
  sendTestAlert,
  sendTestEndAlert,
} = require("./alerts");


process.env.FFMPEG_PATH = ffmpegStatic || process.env.FFMPEG_PATH || "";

if (!process.env.TOKEN) {
  console.error("Missing TOKEN in .env file");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [
    Partials.Channel,
    Partials.GuildMember,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

const PREFIX = process.env.PREFIX || "!";
const DATA_FILE = path.join(__dirname, "punishments.json");
const PROTECT_FILE = path.join(__dirname, "protection.json");
const BAN_LOG_CHANNEL_NAME = "┃🪄・бан";

// =============================
// Rank system config
// =============================
const RANK_XP_PER_MESSAGE = 15;
const RANK_XP_COOLDOWN_MS = 60_000;

const ALLOWLIST_WAIT_ROLE = "AwaitingAllowlist";
const ALLOWLIST_ACCESS_ROLE = "Allowlist 🛡️";

// =============================
// Allowlist reaction / button config
// =============================
const ALLOWLIST_ROLE_NAME = "AwaitingAllowlist";
const ALLOWLIST_EMOJI = "🐾";
const ALLOWLIST_PANEL_CUSTOM_ID = "allowlist_request";

// =============================
// Third-party link auto-ban config
// =============================
const AUTO_BAN_THIRD_PARTY_LINKS = true;
const AUTO_BAN_LINK_DELETE_MESSAGE = true;
const AUTO_BAN_LINK_NOTIFY_CHANNEL = true;
const AUTO_BAN_LINK_REASON = "Отправка сторонней ссылки";
const ALLOWED_LINK_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "google.com",
  "google.ru",
  "googleusercontent.com",
  "gstatic.com",
  "yandex.ru",
  "yandex.com",
  "ya.ru",
  "yandex.kz",
  "yandex.by",
  "yandex.uz",
  "yandex.net",
  "tenor.com",
  "giphy.com",
  "imgur.com",
];

// =============================
// Rank database (SQLite)
// =============================
const rankDb = new Database("rank.db");

rankDb
  .prepare(`
    CREATE TABLE IF NOT EXISTS rank_users (
      guild_id  TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      xp        INTEGER NOT NULL DEFAULT 0,
      level     INTEGER NOT NULL DEFAULT 0,
      messages  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `)
  .run();

const getRankUserStmt = rankDb.prepare(
  "SELECT * FROM rank_users WHERE guild_id = ? AND user_id = ?"
);

const upsertRankUserStmt = rankDb.prepare(`
  INSERT INTO rank_users (guild_id, user_id, xp, level, messages)
  VALUES (@guild_id, @user_id, @xp, @level, @messages)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    xp = excluded.xp,
    level = excluded.level,
    messages = excluded.messages
`);

const leaderboardRankStmt = rankDb.prepare(`
  SELECT user_id, xp
  FROM rank_users
  WHERE guild_id = ?
  ORDER BY xp DESC
`);

const leaderboardMessagesStmt = rankDb.prepare(`
  SELECT user_id, messages
  FROM rank_users
  WHERE guild_id = ?
  ORDER BY messages DESC, xp DESC
`);

const getAllRankRowsStmt = rankDb.prepare(`
  SELECT guild_id, user_id, xp, level, messages
  FROM rank_users
  WHERE guild_id = ?
`);

const setRankUserStmt = rankDb.prepare(`
  INSERT INTO rank_users (guild_id, user_id, xp, level, messages)
  VALUES (@guild_id, @user_id, @xp, @level, @messages)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    xp = excluded.xp,
    level = excluded.level,
    messages = excluded.messages
`);

const incMessagesStmt = rankDb.prepare(`
  INSERT INTO rank_users (guild_id, user_id, xp, level, messages)
  VALUES (?, ?, 0, 0, 1)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    messages = messages + 1
`);

const xpCooldown = new Map();

// =============================
// Rank helpers
// =============================
function xpNeededForLevel(level) {
  return (level + 1) * 100;
}

function addXp(guildId, userId, amount) {
  let row = getRankUserStmt.get(guildId, userId);

  if (!row) {
    row = {
      guild_id: guildId,
      user_id: userId,
      xp: 0,
      level: 0,
      messages: 0,
    };
  }

  row.xp += amount;

  let needed = xpNeededForLevel(row.level);
  while (row.xp >= needed) {
    row.level += 1;
    needed = xpNeededForLevel(row.level);
  }

  upsertRankUserStmt.run(row);
  return row;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + w - radius.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
  ctx.lineTo(x + w, y + h - radius.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
  ctx.lineTo(x + radius.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
}

async function createRankCard(member, stats, rankPosition) {
  const width = 800;
  const height = 200;
  const canvas = Canvas.createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const bgPath = path.join(__dirname, "rank_bg.png");
  try {
    if (fs.existsSync(bgPath)) {
      const background = await Canvas.loadImage(bgPath);
      ctx.drawImage(background, 0, 0, width, height);
    } else {
      ctx.fillStyle = "#111111";
      ctx.fillRect(0, 0, width, height);
    }
  } catch {
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.fillRect(0, 0, width, height);

  const avatarSize = 120;
  const avatarX = 40;
  const avatarY = (height - avatarSize) / 2;

  const avatarURL = member.displayAvatarURL({ extension: "png", size: 256 });
  const avatarImg = await Canvas.loadImage(avatarURL);

  ctx.save();
  ctx.beginPath();
  ctx.arc(
    avatarX + avatarSize / 2,
    avatarY + avatarSize / 2,
    avatarSize / 2,
    0,
    Math.PI * 2,
    true
  );
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
  ctx.restore();

  const displayName = member.displayName || member.user.username;

  ctx.font = "28px Sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(displayName, avatarX + avatarSize + 30, 65);

  ctx.font = "22px Sans-serif";
  ctx.fillStyle = "#ffdd66";
  ctx.fillText(`Уровень: ${stats.level}`, avatarX + avatarSize + 30, 105);

  ctx.fillStyle = "#ffffff";
  ctx.fillText(`Ранг: #${rankPosition}`, avatarX + avatarSize + 250, 105);

  const barX = avatarX + avatarSize + 30;
  const barY = 135;
  const barWidth = 500;
  const barHeight = 25;

  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 12);
  ctx.fill();

  const currentLevelTotalNeeded = xpNeededForLevel(stats.level);
  const prevLevelTotalNeeded =
    stats.level === 0 ? 0 : xpNeededForLevel(stats.level - 1);

  const xpInThisLevel = stats.xp - prevLevelTotalNeeded;
  const xpNeededThisLevel = currentLevelTotalNeeded - prevLevelTotalNeeded;
  const barPercent =
    xpNeededThisLevel > 0
      ? Math.min(xpInThisLevel / xpNeededThisLevel, 1)
      : 0;

  const filledWidth = Math.max(0, barWidth * barPercent);

  ctx.fillStyle = "#ffb74d";
  if (filledWidth > 0) {
    drawRoundedRect(ctx, barX, barY, filledWidth, barHeight, 12);
    ctx.fill();
  }

  ctx.font = "18px Sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  const expText = `${xpInThisLevel} / ${xpNeededThisLevel} EXP`;
  ctx.fillText(expText, barX + barWidth / 2, barY + barHeight - 6);

  return canvas.toBuffer("image/png");
}

// =============================
// Punishments JSON
// =============================
let data = { guilds: {} };

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      data = JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load data file:", err);
    data = { guilds: {} };
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save data file:", err);
  }
}

loadData();

// =============================
// Protection JSON
// =============================
let protection = { channels: [], categories: [] };

function loadProtection() {
  try {
    if (fs.existsSync(PROTECT_FILE)) {
      const raw = fs.readFileSync(PROTECT_FILE, "utf8");
      protection = JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load protection file:", err);
    protection = { channels: [], categories: [] };
  }
}

function saveProtection() {
  try {
    fs.writeFileSync(PROTECT_FILE, JSON.stringify(protection, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save protection file:", err);
  }
}

loadProtection();

function isChannelProtected(id) {
  return protection.channels.includes(id);
}

function isCategoryProtected(id) {
  return protection.categories.includes(id);
}

function getUserData(guildId, userId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = { users: {} };
  }
  if (!data.guilds[guildId].users[userId]) {
    data.guilds[guildId].users[userId] = {
      warns: [],
      bans: [],
      banLevel: 0,
    };
  }
  return data.guilds[guildId].users[userId];
}

// =============================
// Temporary bans
// =============================
const TEMP_BAN_CHECK_INTERVAL_MS = 60 * 1000;
let tempBanInterval = null;

function parseDuration(str) {
  if (!str) return null;
  const match = String(str).trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let ms = 0;
  if (unit === "s") ms = value * 1000;
  if (unit === "m") ms = value * 60 * 1000;
  if (unit === "h") ms = value * 60 * 60 * 1000;
  if (unit === "d") ms = value * 24 * 60 * 60 * 1000;
  return ms;
}

function parseBanDuration(str) {
  if (!str) return null;

  const trimmed = String(str).trim();

  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 24 * 60 * 60 * 1000;
  }

  return parseDuration(trimmed);
}

function setActiveTempBan(guildId, userId, durationMs, reason, moderator) {
  const userData = getUserData(guildId, userId);
  userData.activeTempBan = {
    startedAt: Date.now(),
    expiresAt: Date.now() + durationMs,
    durationMs,
    reason: reason || "Причина не указана",
    moderatorId: moderator?.id || null,
    moderatorTag: moderator?.tag || null,
  };
  saveData();
}

function clearActiveTempBan(guildId, userId) {
  const userData = getUserData(guildId, userId);
  if (userData.activeTempBan) {
    delete userData.activeTempBan;
    saveData();
  }
}

function getActiveTempBan(guildId, userId) {
  const userData = getUserData(guildId, userId);
  if (!userData.activeTempBan) return null;

  const active = userData.activeTempBan;
  if (!active.expiresAt || Date.now() >= active.expiresAt) {
    delete userData.activeTempBan;
    saveData();
    return null;
  }

  return active;
}

async function processExpiredTempBans() {
  if (!client.isReady()) return;

  for (const [guildId, guildData] of Object.entries(data.guilds || {})) {
    const guild =
      client.guilds.cache.get(guildId) ||
      (await client.guilds.fetch(guildId).catch(() => null));

    if (!guild || !guildData?.users) continue;

    for (const [userId, userData] of Object.entries(guildData.users)) {
      const active = userData.activeTempBan;
      if (!active || !active.expiresAt) continue;
      if (Date.now() < active.expiresAt) continue;

      try {
        const banEntry = await guild.bans.fetch(userId).catch(() => null);
        if (banEntry) {
          await guild.members.unban(userId, "Temporary ban expired");
        }
      } catch (err) {
        console.warn(
          `Failed to unban ${userId} in guild ${guildId}:`,
          err.message
        );
      }

      delete userData.activeTempBan;
      saveData();
    }
  }
}

function startTempBanWatcher() {
  if (tempBanInterval) clearInterval(tempBanInterval);

  tempBanInterval = setInterval(() => {
    processExpiredTempBans().catch((err) => {
      console.error("Temp ban watcher error:", err);
    });
  }, TEMP_BAN_CHECK_INTERVAL_MS);

  processExpiredTempBans().catch((err) => {
    console.error("Initial temp ban processing error:", err);
  });
}

async function ensureUserStillBannedOnJoin(member) {
  const active = getActiveTempBan(member.guild.id, member.id);
  if (!active) return false;

  try {
    await member.ban({
      reason: `Temporary ban still active until ${new Date(
        active.expiresAt
      ).toISOString()}`,
    });
    return true;
  } catch (err) {
    console.warn(
      `Failed to re-ban ${member.id} on join while temp ban is active:`,
      err.message
    );
    return false;
  }
}

// =============================
// Common helpers
// =============================
const ALLOWED_ADMIN_ROLES = [
  "Owner 👑",
  "Co-Owner 🦾",
  "Lead Admin 🧩",
  "Discord Director🛡️",
  "Discord Manager🗂️",
  "Discord Admin Manager🎖️",
  "Community Manager 🌐",
];

function isModerator(member) {
  if (!member) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  return member.roles.cache.some((role) =>
    ALLOWED_ADMIN_ROLES.includes(role.name)
  );
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function canBeTimedOut(member) {
  if (!member) return false;
  if (!member.moderatable) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return false;
  }

  return true;
}

async function applyTimeout(member, durationMs, reason) {
  if (!canBeTimedOut(member)) {
    throw new Error("Member cannot be timed out");
  }

  await member.timeout(durationMs, reason);
}

async function clearTimeoutFromMember(member, reason = "Manual untimeout") {
  if (!member) return;
  if (!member.moderatable) {
    throw new Error("Member cannot be un-timed out");
  }

  await member.timeout(null, reason);
}

function normalizeLookupInput(input) {
  return String(input || "").trim().replace(/^@+/, "").toLowerCase();
}

function extractUserId(input) {
  if (!input) return null;

  const raw = String(input).trim();
  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];

  if (/^\d{16,22}$/.test(raw)) return raw;

  return null;
}

function buildUserComparableStrings(user) {
  if (!user) return [];

  const values = [];
  const username = user.username ? user.username.toLowerCase() : "";
  const globalName = user.globalName ? user.globalName.toLowerCase() : "";
  const displayName = user.displayName ? user.displayName.toLowerCase() : "";
  const tag = user.tag ? user.tag.toLowerCase() : "";

  if (username) values.push(username);
  if (globalName) values.push(globalName);
  if (displayName) values.push(displayName);
  if (tag) values.push(tag);
  if (username) values.push(`@${username}`);
  if (globalName) values.push(`@${globalName}`);

  return [...new Set(values)];
}

async function resolveGuildMember(guild, input) {
  if (!guild || !input) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  const directId = extractUserId(raw);

  if (directId) {
    const byId =
      guild.members.cache.get(directId) ||
      (await guild.members.fetch(directId).catch(() => null));
    if (byId) return byId;
  }

  const query = normalizeLookupInput(raw);

  let member =
    guild.members.cache.find((m) => {
      const candidates = buildUserComparableStrings({
        username: m.user?.username,
        globalName: m.user?.globalName,
        displayName: m.displayName,
        tag: m.user?.tag,
      });

      return candidates.includes(query) || candidates.includes(`@${query}`);
    }) || null;

  if (member) return member;

  try {
    const fetched = await guild.members.fetch();
    member =
      fetched.find((m) => {
        const candidates = buildUserComparableStrings({
          username: m.user?.username,
          globalName: m.user?.globalName,
          displayName: m.displayName,
          tag: m.user?.tag,
        });

        return candidates.includes(query) || candidates.includes(`@${query}`);
      }) || null;
  } catch {}

  return member;
}

async function resolveUserForBan(clientInstance, guild, input) {
  if (!input) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  const directId = extractUserId(raw);

  if (directId) {
    const userById = await clientInstance.users
      .fetch(directId)
      .catch(() => null);
    if (userById) return userById;
  }

  const member = await resolveGuildMember(guild, raw);
  if (member) return member.user;

  return null;
}

async function resolveBanEntry(guild, input) {
  if (!guild || !input) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  const directId = extractUserId(raw);

  if (directId) {
    const exactBan = await guild.bans.fetch(directId).catch(() => null);
    if (exactBan) return exactBan;
  }

  const bans = await guild.bans.fetch().catch(() => null);
  if (!bans) return null;

  const query = normalizeLookupInput(raw);

  const found =
    bans.find((ban) => {
      const candidates = buildUserComparableStrings({
        username: ban.user?.username,
        globalName: ban.user?.globalName,
        displayName: "",
        tag: ban.user?.tag,
      });

      if (ban.user?.id === query) return true;
      if (ban.user?.id === raw) return true;

      return candidates.includes(query) || candidates.includes(`@${query}`);
    }) || null;

  return found;
}

function extractUrls(text) {
  if (!text) return [];
  const regex = /\bhttps?:\/\/[^\s<>()]+/gi;
  return text.match(regex) || [];
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

function getHostnameFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return normalizeHostname(url.hostname);
  } catch {
    return null;
  }
}

function isAllowedDomain(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;

  return ALLOWED_LINK_DOMAINS.some((domain) => {
    const allowed = normalizeHostname(domain);
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

// =============================
// Log helpers
// =============================
function getWelcomeChannel(guild) {
  return guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.name.toLowerCase().includes("welcome")
  );
}

function getLogChannel(guild) {
  return guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.name.toLowerCase().includes("лог-результаты")
  );
}

function getBanChannel(guild) {
  if (!guild) return null;

  return (
    guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText && ch.name === BAN_LOG_CHANNEL_NAME
    ) || null
  );
}

function getHighestRoleName(member) {
  if (!member || !member.roles || !member.roles.cache) {
    return "Не указано";
  }

  const highestRole = member.roles.cache
    .filter((role) => role.name !== "@everyone")
    .sort((a, b) => b.position - a.position)
    .first();

  return highestRole ? highestRole.name : "Не указано";
}

function getPunishmentTargetName(userLike) {
  if (!userLike) return "Неизвестно";
  return userLike.username || userLike.globalName || userLike.tag || "Неизвестно";
}

function formatLogDateTime(date = new Date()) {
  return {
    date: date.toLocaleDateString("ru-RU"),
    time: date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function buildStrictBanRoomLog({
  type,
  userName,
  userId,
  durationText,
  reason,
  moderatorTag,
  moderatorRole,
  at = new Date(),
}) {
  const dt = formatLogDateTime(at);

  if (type === "ban") {
    return `⛔ | Пользователь: ${userName} был забанен на: ${
      durationText || "Перманент"
    } | ID: ${userId || "Не указано"} | Причина: ${
      reason || "Причина не указана"
    } | Кто забанил: ${moderatorTag || "Неизвестно"} | Должность: ${
      moderatorRole || "Не указано"
    } | Дата: ${dt.date} | Время: ${dt.time} |`;
  }

  if (type === "unban") {
    return `✅ | Пользователь: ${userName} был разбанен | ID: ${
      userId || "Не указано"
    } | Причина: ${reason || "Причина не указана"} | Кто разбанил: ${
      moderatorTag || "Неизвестно"
    } | Должность: ${moderatorRole || "Не указано"} | Дата: ${
      dt.date
    } | Время: ${dt.time} |`;
  }

  return "";
}

async function sendOnlyToBanRoom(guild, content) {
  if (!content) return null;
  const banChannel = getBanChannel(guild);
  if (!banChannel) return null;
  return banChannel.send({ content }).catch(() => null);
}

// =============================
// Third-party link auto-ban
// =============================
async function handleThirdPartyLinkAutoBan(message) {
  if (!AUTO_BAN_THIRD_PARTY_LINKS) return false;
  if (!message.guild) return false;
  if (message.author.bot) return false;
  if (isModerator(message.member)) return false;

  const me = message.guild.members.me;
  if (!me) return false;

  if (!me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
    return false;
  }

  const targetMember =
    message.member ||
    (await message.guild.members.fetch(message.author.id).catch(() => null));

  if (targetMember && !targetMember.bannable) {
    return false;
  }

  const urls = extractUrls(message.content);
  if (urls.length === 0) return false;

  const blockedUrls = urls.filter((url) => {
    const hostname = getHostnameFromUrl(url);
    if (!hostname) return false;
    return !isAllowedDomain(hostname);
  });

  if (blockedUrls.length === 0) return false;

  try {
    const userData = getUserData(message.guild.id, message.author.id);
    userData.bans.push({
      timestamp: Date.now(),
      durationMs: null,
      reason: `${AUTO_BAN_LINK_REASON}: ${blockedUrls.join(", ")}`,
      moderatorId: client.user?.id || "bot",
      moderatorTag: client.user?.tag || "StreetLife Bot",
    });
    saveData();

    if (AUTO_BAN_LINK_DELETE_MESSAGE && message.deletable) {
      await message.delete().catch(() => null);
    }

    await message.guild.members.ban(message.author.id, {
      reason: `${AUTO_BAN_LINK_REASON}: ${blockedUrls.join(", ").slice(
        0,
        400
      )}`,
    });

    if (AUTO_BAN_LINK_NOTIFY_CHANNEL) {
      await sendOnlyToBanRoom(
        message.guild,
        buildStrictBanRoomLog({
          type: "ban",
          userName: getPunishmentTargetName(message.author),
          userId: message.author.id,
          durationText: "Перманент",
          reason: `${AUTO_BAN_LINK_REASON}: ${blockedUrls.join(", ")}`,
          moderatorTag: client.user?.tag || "StreetLife Bot",
          moderatorRole: "Auto moderation",
        })
      );
    }

    return true;
  } catch (err) {
    console.error("Third-party link auto-ban error:", err);
    return false;
  }
}

// =============================
// Lux server structure template
// =============================
const LUX_STRUCTURE = [
  {
    category: "test",
    channels: ["лог-результаты"],
  },
  {
    category: "руководство",
    channels: [
      "главный-штаб",
      "секретная-комната",
      "staff-документы",
      "статусы-персонала",
      "отчеты",
      "вопросы-персоналу",
    ],
  },
  {
    category: "информация",
    channels: [
      "welcome",
      "правила",
      "объявления",
      "полезные-ссылки",
      "как-начать",
      "ивенты",
      "новости-сервера",
      "инфо-для-новичков",
      "часто-задаваемые",
      "faq",
    ],
  },
  {
    category: "общение",
    channels: [
      "чат",
      "мемы",
      "фото",
      "клипы",
      "музыка",
      "знакомства",
      "роль",
      "ранг",
    ],
  },
  {
    category: "администрация",
    channels: [
      "информация",
      "состав-администрации",
      "правила-администрации",
      "предупреждения-выговоры",
      "информация-по-командам",
      "информация-о-выдаче-наказаний",
    ],
  },
];

const LUX_ALLOWED_NAMES = new Set();
for (const block of LUX_STRUCTURE) {
  LUX_ALLOWED_NAMES.add(block.category);
  for (const ch of block.channels) {
    LUX_ALLOWED_NAMES.add(ch);
  }
}

// =============================
// Welcome embed config + helpers
// =============================
const WELCOME_IMAGE_URL =
  "https://i.ibb.co/FH1D2LK/streetlife-welcome.png";

function buildWelcomeEmbed(member) {
  const user = member.user ?? member;
  const mention = member.toString();
  const username = user.username ?? "игрок";

  let avatarURL = null;
  try {
    if (member.displayAvatarURL) {
      avatarURL = member.displayAvatarURL({ extension: "png", size: 256 });
    } else if (user.displayAvatarURL) {
      avatarURL = user.displayAvatarURL({ extension: "png", size: 256 });
    }
  } catch {
    avatarURL = null;
  }

  const description =
    `👑 Добро пожаловать, ${mention}!\n\n` +
    `👑 Добро пожаловать на легендарный сервер **StreetLife RP — RU!**\n\n` +
    `Ты только что присоединился к одному из самых качественных и уникальных RP-проектов, ` +
    `где стиль, атмосфера и высокий уровень проработки сочетаются в одном месте.\n\n` +
    `✨ **Здесь тебя ждёт:**\n` +
    `• Авторитетное и дружелюбное сообщество\n` +
    `• Реалистичная атмосфера города и продуманные фракции\n` +
    `• Высококачественные системы, созданные для настоящего RP-опыта\n` +
    `• Профессиональная администрация, готовая помочь в любой момент\n\n` +
    `📜 Перед началом игры обязательно ознакомься с правилами сервера,\n` +
    `чтобы обеспечить себе комфортный и честный игровой процесс.\n\n` +
    `🎭 Не стесняйся общаться, заводить знакомства и строить свою собственную историю.\n` +
    `Каждый новый игрок — важная часть мира **StreetLife RP**.\n\n` +
    `Добро пожаловать домой.\n` +
    `Добро пожаловать в **StreetLife RP — RU**.\n` +
    `Твоя новая история начинается прямо сейчас. ✨`;

  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle(`👑 Добро пожаловать, ${username}!`)
    .setDescription(description)
    .setFooter({ text: "StreetLife RP — RU • Элитный RP опыт" })
    .setImage(WELCOME_IMAGE_URL);

  if (avatarURL) {
    embed.setThumbnail(avatarURL);
  }

  return embed;
}

// =============================
// Warn logic / auto punish
// =============================
const WARN_LIFETIME_MS = 4 * 24 * 60 * 60 * 1000;

function cleanupWarns(userData) {
  const now = Date.now();
  userData.warns = userData.warns.filter(
    (w) => now - w.timestamp <= WARN_LIFETIME_MS
  );
}

async function applyAutoPunishment(message, member, userData) {
  const guild = message.guild;
  if (!guild) return;

  cleanupWarns(userData);
  const activeWarns = userData.warns.length;

  if (activeWarns === 3) {
    const durationMs = 6 * 60 * 60 * 1000;
    await autoMute(
      message,
      member,
      durationMs,
      "Набрано 3 активных предупреждения"
    );
  } else if (activeWarns === 4) {
    const durationMs = 12 * 60 * 60 * 1000;
    await autoMute(
      message,
      member,
      durationMs,
      "Набрано 4 активных предупреждения"
    );
  } else if (activeWarns === 5) {
    const durationMs = 24 * 60 * 60 * 1000;
    await autoMute(
      message,
      member,
      durationMs,
      "Набрано 5 активных предупреждений"
    );
  } else if (activeWarns === 6) {
    const banSteps = [1, 3, 7, 14, 30];
    const level = Math.min(userData.banLevel, banSteps.length - 1);
    const days = banSteps[level];
    const durationMs = days * 24 * 60 * 60 * 1000;

    userData.banLevel = Math.min(userData.banLevel + 1, banSteps.length - 1);
    saveData();

    await autoBan(
      message,
      member,
      durationMs,
      `Набрано 6 активных предупреждений (уровень бана ${level + 1}, ${days}d)`
    );
  }
}

async function autoMute(message, member, durationMs, reason) {
  const guild = message.guild;
  if (!guild) return;

  try {
    await applyTimeout(member, durationMs, reason);

    await message.channel.send(
      `🔇 | ${member.user.tag} автоматически получил мут на ${formatDuration(
        durationMs
      )}. Причина: ${reason}`
    );
  } catch (err) {
    console.error("Auto mute error:", err);

    if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      await message.channel.send(
        "❌ Не удалось выдать автоматический мут: у пользователя есть Administrator."
      );
      return;
    }

    await message.channel.send(
      "❌ Не удалось выдать автоматический мут (проверьте права бота и иерархию ролей)."
    );
  }
}

async function autoBan(message, member, durationMs, reason) {
  const guild = message.guild;
  if (!guild) return;

  try {
    const userId = member.id;

    const userData = getUserData(guild.id, userId);
    userData.bans.push({
      timestamp: Date.now(),
      durationMs,
      reason,
      moderatorId: message.author.id,
      moderatorTag: message.author.tag,
    });
    saveData();

    await member.ban({ reason });

    setActiveTempBan(guild.id, userId, durationMs, reason, client.user);

    await sendOnlyToBanRoom(
      guild,
      buildStrictBanRoomLog({
        type: "ban",
        userName: getPunishmentTargetName(member.user),
        userId,
        durationText: formatDuration(durationMs),
        reason,
        moderatorTag: client.user?.tag || "StreetLife Bot",
        moderatorRole: "Auto moderation",
      })
    );
  } catch (err) {
    console.error("Auto ban error:", err);
  }
}

// =============================
// Music system
// =============================
const musicQueues = new Map();

function getMusicQueue(guildId) {
  let queue = musicQueues.get(guildId);

  if (!queue) {
    queue = {
      textChannel: null,
      voiceChannel: null,
      player: null,
      songs: [],
      isPlaying: false,
      currentSong: null,
      nowPlayingMessageId: null,
      ffmpegProcess: null,
    };
    musicQueues.set(guildId, queue);
  }

  return queue;
}

function getBotVoiceChannel(guild) {
  return guild?.members?.me?.voice?.channel || null;
}

function destroyQueueStream(queue) {
  if (!queue) return;

  if (queue.ffmpegProcess) {
    try {
      queue.ffmpegProcess.kill("SIGKILL");
    } catch (err) {
      console.error("FFmpeg kill error:", err);
    }
    queue.ffmpegProcess = null;
  }
}

function cleanupMusicQueue(guildId, destroyConnection = true) {
  const queue = musicQueues.get(guildId);

  if (queue) {
    destroyQueueStream(queue);

    if (queue.player) {
      try {
        queue.player.stop(true);
      } catch (err) {
        console.error("Player cleanup error:", err);
      }
    }
  }

  if (destroyConnection) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
      try {
        connection.destroy();
      } catch (err) {
        console.error("Voice destroy cleanup error:", err);
      }
    }
  }

  musicQueues.delete(guildId);
}

function createGuildPlayer(guildId) {
  const queue = getMusicQueue(guildId);

  if (queue.player) return queue.player;

  queue.player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });

  queue.player.on("stateChange", (oldState, newState) => {
    console.log(
      `[PLAYER STATE] guild=${guildId} ${oldState.status} -> ${newState.status}`
    );
  });

  queue.player.on(AudioPlayerStatus.Playing, () => {
    console.log(`[PLAYER] guild=${guildId} status=playing`);
  });

  queue.player.on(AudioPlayerStatus.Idle, async () => {
    const currentQueue = getMusicQueue(guildId);

    destroyQueueStream(currentQueue);

    if (currentQueue.songs.length > 0) {
      currentQueue.songs.shift();
    }

    currentQueue.currentSong = null;
    currentQueue.isPlaying = false;

    if (currentQueue.songs.length > 0) {
      await playNextSong(guildId);
    }
  });

  queue.player.on("error", async (err) => {
    console.error("Audio player error:", err);

    const currentQueue = getMusicQueue(guildId);

    destroyQueueStream(currentQueue);

    if (currentQueue.songs.length > 0) {
      currentQueue.songs.shift();
    }

    currentQueue.currentSong = null;
    currentQueue.isPlaying = false;

    if (currentQueue.textChannel) {
      await currentQueue.textChannel.send(
        `❌ Audio player error: ${err?.message || "unknown error"}`
      );
    }

    if (currentQueue.songs.length > 0) {
      await playNextSong(guildId);
    }
  });

  return queue.player;
}

function stopMusicQueue(guildId) {
  const queue = musicQueues.get(guildId);
  if (!queue) return false;

  destroyQueueStream(queue);

  queue.songs = [];
  queue.currentSong = null;
  queue.isPlaying = false;
  queue.nowPlayingMessageId = null;

  if (queue.player) {
    try {
      queue.player.stop(true);
    } catch (err) {
      console.error("Stop player error:", err);
    }
  }

  return true;
}

function validateVoiceChannelForBot(voiceChannel) {
  if (!voiceChannel) {
    throw new Error("Voice channel was not found");
  }

  if (!voiceChannel.guild) {
    throw new Error("Guild was not found for voice channel");
  }

  const botMember = voiceChannel.guild.members.me;
  if (!botMember) {
    throw new Error("Bot member was not found in guild");
  }

  const permissions = voiceChannel.permissionsFor(botMember);

  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel)) {
    throw new Error("Missing ViewChannel permission");
  }

  if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
    throw new Error("Missing Connect permission");
  }

  if (!permissions?.has(PermissionsBitField.Flags.Speak)) {
    throw new Error("Missing Speak permission");
  }

  if (voiceChannel.full) {
    throw new Error("Voice channel is full");
  }
}

async function connectToVoice(voiceChannel) {
  validateVoiceChannelForBot(voiceChannel);

  const guildId = voiceChannel.guild.id;
  const existingConnection = getVoiceConnection(guildId);

  if (existingConnection) {
    const currentChannelId = existingConnection.joinConfig?.channelId;

    if (
      currentChannelId === voiceChannel.id &&
      existingConnection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      try {
        await entersState(existingConnection, VoiceConnectionStatus.Ready, 10000);
        console.log(`[VOICE REUSE READY] guild=${guildId}`);
        return existingConnection;
      } catch (err) {
        console.warn("[VOICE REUSE FAILED]", err?.message || err);
        try {
          existingConnection.destroy();
        } catch {}
      }
    } else {
      try {
        existingConnection.destroy();
      } catch (err) {
        console.error("Failed to destroy old voice connection:", err);
      }
    }
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  let destroyedByFailure = false;

  connection.on("stateChange", async (oldState, newState) => {
    console.log(
      `[VOICE STATE] guild=${guildId} ${oldState.status} -> ${newState.status}`
    );

    if (destroyedByFailure) return;

    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        console.log(`[VOICE] guild=${guildId} recovered after disconnect`);
        return;
      } catch {
        console.log(`[VOICE] guild=${guildId} destroy after disconnect`);
        destroyedByFailure = true;
        try {
          connection.destroy();
        } catch {}
        cleanupMusicQueue(guildId);
      }
    }

    if (newState.status === VoiceConnectionStatus.Destroyed) {
      console.log(`[VOICE] guild=${guildId} destroyed`);
    }
  });

  connection.on("error", (err) => {
    console.error(`[VOICE ERROR] guild=${guildId}`, err);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    console.log(`[VOICE READY] guild=${guildId}`);
    return connection;
  } catch (err) {
    console.error("[VOICE READY FAILED]", err);

    destroyedByFailure = true;

    try {
      connection.destroy();
    } catch (destroyErr) {
      console.error(
        "Failed to destroy voice connection after failure:",
        destroyErr
      );
    }

    throw new Error(err?.message || "Voice connection failed");
  }
}

function isLikelyUrl(value) {
  try {
    new URL(String(value).trim());
    return true;
  } catch {
    return false;
  }
}

function isYouTubeHostname(hostname) {
  const normalized = String(hostname || "")
    .replace(/^www\./, "")
    .toLowerCase();

  return (
    normalized === "youtube.com" ||
    normalized === "m.youtube.com" ||
    normalized === "music.youtube.com" ||
    normalized === "youtu.be"
  );
}

function isYouTubeMixUrl(input) {
  try {
    const url = new URL(String(input).trim());
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();

    if (!isYouTubeHostname(hostname)) return false;

    const listId = url.searchParams.get("list");
    return Boolean(listId && listId.startsWith("RD"));
  } catch {
    return false;
  }
}

function isRealPlaylistUrl(input) {
  try {
    const url = new URL(String(input).trim());
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();

    if (!isYouTubeHostname(hostname)) return false;

    const listId = url.searchParams.get("list");
    if (!listId) return false;
    if (listId.startsWith("RD")) return false;

    return true;
  } catch {
    return false;
  }
}

function sanitizeYoutubeUrl(input) {
  try {
    const raw = String(input).trim();
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();

    if (hostname === "youtu.be") {
      const videoId = url.pathname.slice(1).split("/")[0];
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com"
    ) {
      if (url.pathname === "/watch") {
        const videoId = url.searchParams.get("v");
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }

      if (url.pathname.startsWith("/shorts/")) {
        const videoId = url.pathname.split("/shorts/")[1]?.split("/")[0];
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }

      if (url.pathname.startsWith("/live/")) {
        const videoId = url.pathname.split("/live/")[1]?.split("/")[0];
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
    }

    return raw;
  } catch {
    return String(input).trim();
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Process exited with code ${code}`));
      }
    });
  });
}

async function ytDlpJson(args) {
  const stdout = await runProcess("python", ["-m", "yt_dlp", ...args]);
  return JSON.parse(stdout);
}

async function ytDlpText(args) {
  return runProcess("python", ["-m", "yt_dlp", ...args]);
}

async function resolvePlaylistTracks(url) {
  const raw = String(url).trim();

  const data = await ytDlpJson([
    "--dump-single-json",
    "--flat-playlist",
    "--no-warnings",
    "--yes-playlist",
    raw,
  ]);

  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const tracks = [];

  for (const entry of entries) {
    if (!entry) continue;

    const entryUrl =
      entry.url && /^https?:\/\//i.test(entry.url)
        ? entry.url
        : entry.id
          ? `https://www.youtube.com/watch?v=${entry.id}`
          : null;

    if (!entryUrl) continue;

    tracks.push({
      title: entry.title || "Unknown title",
      url: sanitizeYoutubeUrl(entryUrl),
    });
  }

  if (!tracks.length) {
    throw new Error("Playlist is empty or unavailable");
  }

  return tracks;
}

async function resolveTracks(query) {
  const trimmed = String(query || "").trim();

  if (!trimmed) {
    throw new Error("Empty query");
  }

  console.log("[YT RESOLVE QUERY]", trimmed);

  if (isLikelyUrl(trimmed)) {
    if (isRealPlaylistUrl(trimmed)) {
      return resolvePlaylistTracks(trimmed);
    }

    const cleanUrl = sanitizeYoutubeUrl(trimmed);

    try {
      const data = await ytDlpJson([
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        cleanUrl,
      ]);

      if (!data) {
        throw new Error("No data returned");
      }

      const resolvedUrl =
        data.webpage_url ||
        (data.id ? `https://www.youtube.com/watch?v=${data.id}` : null) ||
        cleanUrl;

      return [
        {
          title: data.title || "Unknown title",
          url: sanitizeYoutubeUrl(resolvedUrl),
        },
      ];
    } catch (err) {
      console.error("[YT URL RESOLVE ERROR]", err?.message || err);

      if (isYouTubeMixUrl(trimmed)) {
        const fallbackUrl = sanitizeYoutubeUrl(trimmed);
        return [
          {
            title: "YouTube Mix Track",
            url: fallbackUrl,
          },
        ];
      }

      throw new Error("This video is unavailable or could not be resolved");
    }
  }

  const searchData = await ytDlpJson([
    "--dump-single-json",
    "--no-warnings",
    "ytsearch5:" + trimmed,
  ]);

  const entries = Array.isArray(searchData?.entries) ? searchData.entries : [];
  const validEntries = [];

  for (const entry of entries) {
    if (!entry) continue;

    const resolvedUrl =
      entry.webpage_url ||
      (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);

    if (!resolvedUrl) continue;

    validEntries.push({
      title: entry.title || "Unknown title",
      url: sanitizeYoutubeUrl(resolvedUrl),
    });
  }

  if (!validEntries.length) {
    throw new Error("No tracks found");
  }

  return [validEntries[0]];
}

async function getDirectAudioUrl(url) {
  const safeUrl = sanitizeYoutubeUrl(url);

  try {
    const output = await ytDlpText([
      "-f",
      "bestaudio/best",
      "--no-playlist",
      "--no-warnings",
      "--geo-bypass",
      "--extractor-args",
      "youtube:player_client=android,web",
      "--get-url",
      safeUrl,
    ]);

    const directUrl = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0];

    if (!directUrl) {
      throw new Error("yt-dlp did not return a playable audio URL");
    }

    return directUrl;
  } catch (err) {
    console.error("[AUDIO ERROR 1]", err?.message || err);

    try {
      const fallbackOutput = await ytDlpText([
        "-f",
        "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
        "--no-playlist",
        "--no-warnings",
        "--geo-bypass",
        "--extractor-args",
        "youtube:player_client=android,web",
        "--get-url",
        safeUrl,
      ]);

      const fallbackUrl = fallbackOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0];

      if (!fallbackUrl) {
        throw new Error("No fallback audio URL returned");
      }

      return fallbackUrl;
    } catch (fallbackErr) {
      console.error("[AUDIO ERROR 2]", fallbackErr?.message || fallbackErr);
      throw new Error("No playable audio found");
    }
  }
}

async function createPlayableResourceFromUrl(song, guildId) {
  const queue = getMusicQueue(guildId);

  if (!song || typeof song !== "object") {
    throw new Error("Song object is missing");
  }

  if (!song.url || typeof song.url !== "string") {
    throw new Error("Song URL is missing");
  }

  let directAudioUrl;

  try {
    directAudioUrl = song.directAudioUrl || (await getDirectAudioUrl(song.url));
  } catch (err) {
    console.warn("[DIRECT AUDIO PRIMARY FAILED]", err?.message || err);

    if (song.title) {
      const retryTracks = await resolveTracks(song.title);
      const retryTrack = retryTracks.find((t) => t?.url);

      if (!retryTrack) {
        throw err;
      }

      song.url = retryTrack.url;
      directAudioUrl = await getDirectAudioUrl(song.url);
    } else {
      throw err;
    }
  }

  song.directAudioUrl = directAudioUrl;

  console.log("[DIRECT AUDIO URL]", {
    original: song.url,
    directAudioUrl,
  });

  destroyQueueStream(queue);

  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!ffmpegPath) {
    throw new Error("FFmpeg path was not found");
  }

  const ffmpegArgs = [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", directAudioUrl,
    "-analyzeduration", "0",
    "-loglevel", "error",
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1",
  ];

  const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  queue.ffmpegProcess = ffmpeg;

  ffmpeg.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      console.log("[FFMPEG STDERR]", text);
    }
  });

  ffmpeg.on("error", (err) => {
    console.error("FFmpeg process error:", err);
  });

  ffmpeg.on("close", (code, signal) => {
    console.log(`[FFMPEG CLOSED] code=${code} signal=${signal || "none"}`);
  });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });

  if (resource.volume) {
    resource.volume.setVolume(0.7);
  }

  return resource;
}

async function playNextSong(guildId) {
  const queue = getMusicQueue(guildId);
  const connection = getVoiceConnection(guildId);

  if (!queue || queue.songs.length === 0) return;
  if (!connection) {
    queue.isPlaying = false;
    return;
  }
  if (queue.isPlaying) return;

  const song = queue.songs[0];

  if (!song || typeof song !== "object" || !song.url) {
    console.error("Invalid song object:", song);
    queue.songs.shift();
    return playNextSong(guildId);
  }

  const player = createGuildPlayer(guildId);

  try {
    queue.isPlaying = true;
    queue.currentSong = song;

    const guild = client.guilds.cache.get(guildId);
    const botMember = guild?.members?.me;

    if (botMember?.voice?.serverMute) {
      throw new Error("Bot is server muted");
    }

    const resource = await createPlayableResourceFromUrl(song, guildId);

    connection.subscribe(player);
    player.play(resource);

    console.log(`[PLAYER STARTED] guild=${guildId} title=${song.title}`);

    if (queue.textChannel) {
      queue.textChannel
        .send(`▶️ Now playing: **${song.title}**`)
        .catch(() => {});
    }

    const nextSong = queue.songs[1];
    if (nextSong && !nextSong.directAudioUrl) {
      getDirectAudioUrl(nextSong.url)
        .then((url) => {
          nextSong.directAudioUrl = url;
        })
        .catch((err) => {
          console.warn("Preload next song failed:", err?.message || err);
        });
    }
  } catch (err) {
    console.error("playNextSong error:", err);
    console.error("playNextSong message:", err?.message || "no message");
    console.error("playNextSong stack:", err?.stack || "no stack");

    queue.isPlaying = false;
    queue.currentSong = null;

    destroyQueueStream(queue);

    if (queue.songs.length > 0) {
      queue.songs.shift();
    }

    if (queue.textChannel) {
      if (err.message === "Bot is server muted") {
        await queue.textChannel.send(
          "❌ Bot is server muted. Please unmute the bot in the voice channel."
        );
      } else {
        await queue.textChannel.send(
          `❌ Failed to play track: ${err?.message || "unknown error"}`
        );
      }
    }

    if (queue.songs.length > 0) {
      await playNextSong(guildId);
    }
  }
}

// =============================
// Events
// =============================
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await Promise.all(
    client.guilds.cache.map((guild) =>
      guild.members.fetch().catch(() => null)
    )
  );

  startTempBanWatcher();
  startAlertsLoop(client);
});

client.on("guildMemberAdd", async (member) => {
  const reBanned = await ensureUserStillBannedOnJoin(member);
  if (reBanned) return;

  const welcomeChannel = getWelcomeChannel(member.guild);
  if (!welcomeChannel) return;

  const embed = buildWelcomeEmbed(member);
  await welcomeChannel.send({ embeds: [embed] });
});

// =============================
// Reaction role: AwaitingAllowlist
// =============================
client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (reaction.partial) {
      await reaction.fetch();
    }
    if (user.bot) return;

    const message = reaction.message;
    const guild = message.guild;
    if (!guild) return;

    if (reaction.emoji.name !== ALLOWLIST_EMOJI) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const role = guild.roles.cache.find(
      (r) =>
        r.name === ALLOWLIST_ROLE_NAME ||
        r.name.startsWith(ALLOWLIST_ROLE_NAME)
    );

    if (!role) {
      console.warn(
        `Allowlist role "${ALLOWLIST_ROLE_NAME}" not found in guild ${guild.id}`
      );
      return;
    }

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, "Allowlist reaction add");
    }
  } catch (err) {
    console.error("messageReactionAdd error:", err);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  try {
    if (reaction.partial) {
      await reaction.fetch();
    }
    if (user.bot) return;

    const message = reaction.message;
    const guild = message.guild;
    if (!guild) return;

    if (reaction.emoji.name !== ALLOWLIST_EMOJI) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const role = guild.roles.cache.find(
      (r) =>
        r.name === ALLOWLIST_ROLE_NAME ||
        r.name.startsWith(ALLOWLIST_ROLE_NAME)
    );

    if (!role) return;

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, "Allowlist reaction removed");
    }
  } catch (err) {
    console.error("messageReactionRemove error:", err);
  }
});

// =============================
// Button interactions
// =============================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== ALLOWLIST_PANEL_CUSTOM_ID) return;

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({
      content: "❌ Ошибка: сервер не найден.",
      ephemeral: true,
    });
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return interaction.reply({
      content: "❌ Ошибка: участник не найден.",
      ephemeral: true,
    });
  }

  const role = guild.roles.cache.find(
    (r) =>
      r.name === ALLOWLIST_ROLE_NAME ||
      r.name.startsWith(ALLOWLIST_ROLE_NAME)
  );

  if (!role) {
    return interaction.reply({
      content: `❌ Роль "${ALLOWLIST_ROLE_NAME}" не найдена. Обратитесь к администрации.`,
      ephemeral: true,
    });
  }

  if (member.roles.cache.has(role.id)) {
    return interaction.reply({
      content: "✅ У тебя уже есть роль для проверки.",
      ephemeral: true,
    });
  }

  try {
    await member.roles.add(role, "Allowlist button press");

    return interaction.reply({
      content:
        "✅ Роль для прохождения проверки выдана! Администрация увидит, что ты готов к проверке.",
      ephemeral: true,
    });
  } catch (err) {
    console.error("Allowlist button error:", err);

    return interaction.reply({
      content: "❌ Не удалось выдать роль. Сообщите администрации.",
      ephemeral: true,
    });
  }
});

async function recountAllMessagesInGuild(guild) {
  await guild.members.fetch();
  await guild.channels.fetch();

  const textChannels = guild.channels.cache.filter(
    (c) => c.isTextBased && c.isTextBased()
  );

  const totals = new Map();

  for (const member of guild.members.cache.values()) {
    if (!member.user.bot) {
      totals.set(member.id, 0);
    }
  }

  for (const channel of textChannels.values()) {
    let lastId = null;

    while (true) {
      let messages;

      try {
        messages = await channel.messages.fetch({
          limit: 100,
          ...(lastId ? { before: lastId } : {}),
        });
      } catch {
        break;
      }

      if (!messages || messages.size === 0) break;

      for (const msg of messages.values()) {
        if (!msg.author || msg.author.bot) continue;

        totals.set(msg.author.id, (totals.get(msg.author.id) || 0) + 1);
      }

      lastId = messages.last().id;

      if (messages.size < 100) break;
    }
  }

  const existingRows = getAllRankRowsStmt.all(guild.id);
  const existingMap = new Map();

  for (const row of existingRows) {
    existingMap.set(row.user_id, row);
  }

  const transaction = rankDb.transaction((rows) => {
    for (const row of rows) {
      setRankUserStmt.run(row);
    }
  });

  const rowsToSave = [];

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;

    const oldRow = existingMap.get(member.id);

    rowsToSave.push({
      guild_id: guild.id,
      user_id: member.id,
      xp: oldRow?.xp || 0,
      level: oldRow?.level || 0,
      messages: totals.get(member.id) || 0,
    });
  }

  transaction(rowsToSave);
}

// =============================
// Messages / Commands
// =============================
client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;
  const isCommandMessage = message.content.startsWith(PREFIX);

  if (!isCommandMessage) {
    const autoBanned = await handleThirdPartyLinkAutoBan(message);
    if (autoBanned) {
      return;
    }
  }

  if (!isCommandMessage) {
    try {
      incMessagesStmt.run(guildId, userId);
    } catch (err) {
      console.error("incMessages error:", err);
    }

    const key = `${guildId}:${userId}`;
    const last = xpCooldown.get(key) || 0;
    const now = Date.now();

    if (now - last >= RANK_XP_COOLDOWN_MS) {
      xpCooldown.set(key, now);
      addXp(guildId, userId, RANK_XP_PER_MESSAGE);
    }
  }

  if (!isCommandMessage) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || "").toLowerCase();
  const moderator = isModerator(message.member);

  if (command === "ping") {
    const ping = Math.round(client.ws.ping);
    await message.reply(`🏓 Pong! ${ping} ms`);
    return;
  }

   if (command === "тесттревога") {
    await sendTestAlert(message, "Израиль");
    return;
  }

  if (command === "тесттревогауа") {
    await sendTestAlert(message, "Украина");
    return;
  }

  if (command === "тестотбой") {
    await sendTestEndAlert(message, "Израиль");
    return;
  }

  if (command === "тестотбойуа") {
    await sendTestEndAlert(message, "Украина");
    return;
  }

  if (command === "say") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const text = args.join(" ");
    if (!text) {
      return message.reply("❗ Использование: `!say <текст>`");
    }

    await message.delete().catch(() => {});
    await message.channel.send(text);
    return;
  }

  if (command === "rank") {
    let member = message.member;

    if (message.mentions.members.first()) {
      member = message.mentions.members.first();
    }

    const targetId = member.id;
    let stats = getRankUserStmt.get(guildId, targetId);

    if (!stats) {
      stats = {
        guild_id: guildId,
        user_id: targetId,
        xp: 0,
        level: 0,
        messages: 0,
      };
      upsertRankUserStmt.run(stats);
    }

    const rows = leaderboardRankStmt.all(guildId);
    const index = rows.findIndex((r) => r.user_id === targetId);
    const rankPosition = index === -1 ? rows.length + 1 : index + 1;

    const buffer = await createRankCard(member, stats, rankPosition);

    await message.channel.send({
      files: [{ attachment: buffer, name: "rank.png" }],
    });

    return;
  }

  if (command === "recountmessages") {
    await message.reply("🔄 Сканирую все сообщения... Это может занять время.");

    try {
      await recountAllMessagesInGuild(message.guild);

      await message.channel.send(
        "✅ Готово! Теперь !top показывает все сообщения."
      );
    } catch (err) {
      console.error(err);
      await message.channel.send("❌ Ошибка при пересчёте.");
    }

    return;
  }

  if (command === "top") {
    try {
      const rows = leaderboardMessagesStmt.all(guildId) || [];

      const statsMap = new Map();
      for (const row of rows) {
        if (!row || !row.user_id) continue;
        statsMap.set(row.user_id, Number(row.messages) || 0);
      }

      const leaderboard = [];

      for (const member of message.guild.members.cache.values()) {
        if (!member || !member.user || member.user.bot) continue;

        const serverName =
          member.displayName ||
          member.nickname ||
          member.user.globalName ||
          member.user.username ||
          member.user.tag ||
          member.id;

        leaderboard.push({
          id: member.id,
          name: serverName,
          messages: statsMap.get(member.id) || 0,
        });
      }

      leaderboard.sort((a, b) => {
        const msgDiff = b.messages - a.messages;
        if (msgDiff !== 0) return msgDiff;
        return String(a.name).localeCompare(String(b.name), "ru");
      });

      if (leaderboard.length === 0) {
        return message.reply("📊 Пока нет данных по сообщениям.");
      }

      const lines = leaderboard.map((user, index) => {
        return `${index + 1}. ${user.name} — сообщений: ${user.messages}`;
      });

      const chunks = [];
      let currentChunk = "🏆 Топ по сообщениям (все участники):\n";

      for (const line of lines) {
        if ((currentChunk + line + "\n").length > 1900) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        currentChunk += line + "\n";
      }

      if (currentChunk.trim()) {
        chunks.push(currentChunk);
      }

      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } catch (err) {
      console.error("Top command error:", err?.stack || err);
      await message.reply("❌ Ошибка при получении топа.");
    }

    return;
  }

  if (command === "setupserverlux") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    await message.channel.send(
      "🏗 | Запускаю создание/обновление структуры сервера по люксовому макету..."
    );

    try {
      for (const block of LUX_STRUCTURE) {
        let category = message.guild.channels.cache.find(
          (ch) =>
            ch.type === ChannelType.GuildCategory && ch.name === block.category
        );

        if (!category) {
          category = await message.guild.channels.create({
            name: block.category,
            type: ChannelType.GuildCategory,
          });
        }

        for (const chName of block.channels) {
          let channel = message.guild.channels.cache.find(
            (ch) =>
              ch.parentId === category.id &&
              ch.type === ChannelType.GuildText &&
              ch.name === chName
          );

          if (!channel) {
            await message.guild.channels.create({
              name: chName,
              type: ChannelType.GuildText,
              parent: category.id,
            });
          }
        }
      }

      await message.channel.send(
        "✅ | Структура сервера люкс успешно создана/обновлена."
      );
    } catch (err) {
      console.error("setupserverlux error:", err);
      await message.channel.send(
        "❌ | Не удалось настроить структуру сервера (проверьте права бота)."
      );
    }

    return;
  }

  if (command === "cleanextraserver") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    await message.channel.send(
      "🧼 | Умная чистка сервера: удаляю лишние каналы и категории..."
    );

    try {
      for (const [, ch] of message.guild.channels.cache) {
        if (ch.type === ChannelType.GuildCategory) {
          if (!LUX_ALLOWED_NAMES.has(ch.name) && !isCategoryProtected(ch.id)) {
            await ch.delete("cleanextraserver: remove extra category");
          }
        } else {
          const parentProtected = ch.parentId && isCategoryProtected(ch.parentId);

          if (
            !LUX_ALLOWED_NAMES.has(ch.name) &&
            !isChannelProtected(ch.id) &&
            !parentProtected
          ) {
            await ch.delete("cleanextraserver: remove extra channel");
          }
        }
      }

      await message.channel.send("✅ | Чистка сервера завершена.");
    } catch (err) {
      console.error("cleanextraserver error:", err);
      await message.channel.send(
        "❌ | Не удалось выполнить чистку (проверьте права бота)."
      );
    }

    return;
  }

  if (command === "deletecategory") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const category = message.channel.parent;
    if (!category || category.type !== ChannelType.GuildCategory) {
      return message.reply(
        "❗ Эта команда должна быть выполнена внутри категории."
      );
    }

    if (isCategoryProtected(category.id)) {
      return message.reply("⛔ Эта категория защищена и не может быть удалена.");
    }

    try {
      const children = category.children.cache;
      for (const [, ch] of children) {
        if (!isChannelProtected(ch.id)) {
          await ch.delete("deletecategory command");
        }
      }
      await category.delete("deletecategory command");
    } catch (err) {
      console.error("deletecategory error:", err);
      await message.channel.send(
        "❌ | Не удалось удалить категорию (проверьте права бота)."
      );
    }

    return;
  }

  if (command === "deletechannel") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    if (isChannelProtected(message.channel.id)) {
      return message.reply("⛔ Этот канал защищён и не может быть удалён.");
    }

    try {
      await message.channel.delete("deletechannel command");
    } catch (err) {
      console.error("deletechannel error:", err);
    }

    return;
  }

  if (command === "protectchannel") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    if (!isChannelProtected(message.channel.id)) {
      protection.channels.push(message.channel.id);
      saveProtection();
    }

    await message.reply("🔒 Этот канал теперь защищён от удаления.");
    return;
  }

  if (command === "unprotectchannel") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    protection.channels = protection.channels.filter(
      (id) => id !== message.channel.id
    );
    saveProtection();
    await message.reply("🔓 Защита канала снята.");
    return;
  }

  if (command === "protectcategory") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const category = message.channel.parent;
    if (!category || category.type !== ChannelType.GuildCategory) {
      return message.reply("❗ Эту команду нужно писать внутри категории.");
    }

    if (!isCategoryProtected(category.id)) {
      protection.categories.push(category.id);
      saveProtection();
    }

    await message.reply("🔒 Категория теперь защищена от удаления.");
    return;
  }

  if (command === "unprotectcategory") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const category = message.channel.parent;
    if (!category || category.type !== ChannelType.GuildCategory) {
      return message.reply("❗ Эту команду нужно писать внутри категории.");
    }

    protection.categories = protection.categories.filter(
      (id) => id !== category.id
    );
    saveProtection();
    await message.reply("🔓 Защита категории снята.");
    return;
  }

  if (command === "testwelcome") {
    const embed = buildWelcomeEmbed(message.member);
    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === "sendtestrules") {
    const embed = new EmbedBuilder()
      .setTitle("📜 Основные правила сервера")
      .setDescription(
        "1. Уважайте друг друга.\n2. Без оскорблений и токсичности.\n3. Запрещён спам и реклама.\n4. Соблюдайте правила проекта StreetLife RP.\n5. Администрация всегда имеет последнее слово."
      )
      .setColor(0xffa500);

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === "sendaccesspanel") {
    const embed = new EmbedBuilder()
      .setTitle("🎫 Панель доступа")
      .setDescription(
        "Здесь может быть панель с реакциями/кнопками для получения ролей или доступа.\nПока что это просто заглушка."
      )
      .setColor(0x00bfff);

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === "sendcandidaterules") {
    const embed = new EmbedBuilder()
      .setTitle("📝 Правила для кандидатов")
      .setDescription(
        "1. Заполняйте заявку честно.\n2. Будьте готовы к собеседованию.\n3. Соблюдайте конфиденциальность внутренней информации проекта."
      )
      .setColor(0x32cd32);

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === "sendloginfo") {
    const embed = new EmbedBuilder()
      .setTitle("📂 Логи сервера")
      .setDescription(
        "Здесь могут отображаться логи действий (входы, выходы, наказания и т.д.).\nСейчас это тестовое сообщение."
      )
      .setColor(0x8a2be2);

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === "sendallowlistpanel") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const embed = new EmbedBuilder()
      .setTitle("🧪 Получить доступ к проверке")
      .setDescription(
        "Добро пожаловать на **StreetLife RP — RU**.\n\n" +
          "Чтобы пройти проверку и попасть на сервер, нажми на кнопку ниже.\n" +
          "Тебе будет выдана роль **AwaitingAllowlist**, и администрация увидит, что ты готов к проверке."
      )
      .setColor(0x00ff66);

    const button = new ButtonBuilder()
      .setCustomId(ALLOWLIST_PANEL_CUSTOM_ID)
      .setLabel("Получить доступ к проверке")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await message.channel.send({ embeds: [embed], components: [row] });
    return;
  }

  if (command === "прошел" && args[0] === "проверку") {
    if (!isModerator(message.member)) {
      return;
    }

    const target =
      message.mentions.members.first() ||
      message.guild.members.cache.get(args[1]);

    if (!target) {
      return message.reply("❗ Использование: !прошел проверку @User");
    }

    const accessRole = message.guild.roles.cache.find(
      (r) => r.name === ALLOWLIST_ACCESS_ROLE
    );

    if (!accessRole) {
      return message.reply(`❌ Роль "${ALLOWLIST_ACCESS_ROLE}" не найдена.`);
    }

    const waitingRole = message.guild.roles.cache.find(
      (r) =>
        r.name === ALLOWLIST_ROLE_NAME ||
        r.name.startsWith(ALLOWLIST_ROLE_NAME)
    );

    try {
      if (!target.roles.cache.has(accessRole.id)) {
        await target.roles.add(
          accessRole,
          `Passed allowlist check by ${message.author.tag}`
        );
      }

      if (waitingRole && target.roles.cache.has(waitingRole.id)) {
        await target.roles.remove(waitingRole, "Passed allowlist check");
      }

      await message.channel.send(
        `🎉 ${target} успешно прошёл проверку!\n🛡️ Проверяющий: ${message.author}`
      );

      const logChannel = getLogChannel(message.guild);
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor(0x00ff66)
          .setTitle("✅ Проверка пройдена")
          .addFields(
            { name: "👤 Кандидат", value: `${target}`, inline: true },
            { name: "🛡️ Проверяющий", value: `${message.author}`, inline: true }
          )
          .setTimestamp();

        await logChannel.send({ embeds: [embed] });
      }

      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(0x00ff66)
          .setTitle("✅ Проверка успешно пройдена")
          .setDescription(
            "Здравствуйте!\n\n" +
              "🎉 **Поздравляем!** Вы успешно прошли проверку на сервере **StreetLife RP — RU**.\n\n" +
              "🛡️ Вам выдана роль **Allowlist**, и теперь у Вас есть доступ к серверу.\n\n" +
              "Добро пожаловать в наш проект!\n\n" +
              "С уважением,\n" +
              "**Администрация StreetLife RP — RU**"
          )
          .setTimestamp();

        await target.send({ embeds: [dmEmbed] });
      } catch {
        console.warn("Не удалось отправить DM пользователю");
      }
    } catch (err) {
      console.error("Allowlist pass error:", err);
      return message.reply(
        "❌ Произошла ошибка при выдаче доступа. Проверьте права бота."
      );
    }

    return;
  }

  if (command === "coin") {
    const result = Math.random() < 0.5 ? "🦅 Орёл" : "🪙 Решка";
    await message.reply(`🪙 Монета: **${result}**`);
    return;
  }

  if (command === "roll") {
    const max = parseInt(args[0], 10) || 100;

    if (max <= 0) {
      return message.reply("❌ Максимум должен быть положительным числом.");
    }

    const roll = Math.floor(Math.random() * max) + 1;
    await message.reply(`🎲 Выпало число: **${roll}** (из 1–${max})`);
    return;
  }

  if (command === "rps") {
    const choice = (args[0] || "").toLowerCase();

    if (!["rock", "paper", "scissors"].includes(choice)) {
      return message.reply("❗ Использование: `!rps rock | paper | scissors`");
    }

    const options = ["rock", "paper", "scissors"];
    const botChoice = options[Math.floor(Math.random() * options.length)];

    let result;
    if (choice === botChoice) {
      result = "🤝 Ничья!";
    } else if (
      (choice === "rock" && botChoice === "scissors") ||
      (choice === "paper" && botChoice === "rock") ||
      (choice === "scissors" && botChoice === "paper")
    ) {
      result = "✅ Ты выиграл!";
    } else {
      result = "❌ Я выиграл!";
    }

    await message.reply(
      `✊✋✌ Ты: **${choice}**\n🤖 Бот: **${botChoice}**\n${result}`
    );
    return;
  }

  if (command === "play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply("❌ Ты должен находиться в голосовом канале.");
    }

    const query = args.join(" ").trim();
    if (!query) {
      return message.reply("❗ Использование: !play <название песни / ссылка>");
    }

    const queue = getMusicQueue(guildId);
    queue.textChannel = message.channel;
    queue.voiceChannel = voiceChannel;

    console.log("[PLAY COMMAND]", {
      guildId: message.guild.id,
      userId: message.author.id,
      userVoiceChannelId: voiceChannel.id,
      userVoiceChannelName: voiceChannel.name,
      query,
    });

    let connection;
    try {
      connection = await connectToVoice(voiceChannel);
    } catch (err) {
      console.error("Voice connection error:", err);
      return message.reply(
        `❌ Не удалось подключиться к голосовому каналу.\nОшибка: ${err.message}`
      );
    }

    if (!connection) {
      return message.reply("❌ Не удалось создать voice connection.");
    }

    try {
      const tracks = await resolveTracks(query);

      if (!tracks || tracks.length === 0) {
        return message.reply("❌ Не удалось найти треки.");
      }

      createGuildPlayer(guildId);

      if (isLikelyUrl(query) || isRealPlaylistUrl(query)) {
        for (const track of tracks) {
          if (track?.url) {
            queue.songs.push(track);
          }
        }

        if (!queue.songs.length) {
          return message.reply("❌ Не удалось добавить трек в очередь.");
        }

        if (tracks.length === 1) {
          await message.channel.send(`➕ Добавлено в очередь: **${tracks[0].title}**`);
        } else {
          await message.channel.send(`➕ Добавлен плейлист: **${tracks.length}** трек(ов).`);
        }
      } else {
        let addedTrack = null;

        for (const candidate of tracks) {
          try {
            await getDirectAudioUrl(candidate.url);
            addedTrack = candidate;
            break;
          } catch (err) {
            console.warn("[SEARCH CANDIDATE FAILED]", candidate.title, err?.message || err);
          }
        }

        if (!addedTrack) {
          return message.reply("❌ Не удалось найти воспроизводимый трек по этому запросу.");
        }

        queue.songs.push(addedTrack);
        await message.channel.send(`➕ Добавлено в очередь: **${addedTrack.title}**`);
      }

      if (!queue.isPlaying) {
        await playNextSong(guildId);
      }
    } catch (err) {
      console.error("Play command error:", err);
      console.error("Play command stack:", err?.stack || "no stack");
      return message.reply(
        `❌ Ошибка при обработке трека/плейлиста: ${err.message || "unknown error"}`
      );
    }

    return;
  }

  if (command === "skip") {
    const queue = musicQueues.get(guildId);
    if (!queue || !queue.player || queue.songs.length === 0) {
      return message.reply("ℹ️ Сейчас ничего не играет.");
    }

    destroyQueueStream(queue);
    queue.player.stop(true);
    await message.reply("⏭ Трек пропущен.");
    return;
  }

  if (command === "stop") {
    const queue = musicQueues.get(guildId);
    if (!queue || !queue.player) {
      return message.reply("ℹ️ Сейчас ничего не играет.");
    }

    stopMusicQueue(guildId);
    musicQueues.delete(guildId);

    await message.reply("⏹ Воспроизведение остановлено, очередь очищена.");
    return;
  }

  if (command === "pause") {
    const queue = musicQueues.get(guildId);
    if (!queue || !queue.player) {
      return message.reply("ℹ️ Сейчас ничего не играет.");
    }

    queue.player.pause();
    await message.reply("⏸ Музыка на паузе.");
    return;
  }

  if (command === "resume") {
    const queue = musicQueues.get(guildId);
    if (!queue || !queue.player) {
      return message.reply("ℹ️ Сейчас ничего не играет.");
    }

    queue.player.unpause();
    await message.reply("▶️ Продолжаю воспроизведение.");
    return;
  }

  if (command === "queue") {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.songs.length === 0) {
      return message.reply("ℹ️ Очередь пуста.");
    }

    const lines = queue.songs.map((s, i) => {
      if (i === 0) return `▶️ 1. **${s.title}** (играет сейчас)`;
      return `${i + 1}. ${s.title}`;
    });

    await message.channel.send("🎶 Очередь треков:\n" + lines.join("\n"));
    return;
  }

  if (command === "debugvoice") {
    const connection = getVoiceConnection(guildId);
    const queue = musicQueues.get(guildId);
    const botVoiceChannel = getBotVoiceChannel(message.guild);
    const userVoiceChannel = message.member.voice?.channel;
    const botServerMute = message.guild.members.me?.voice?.serverMute;
    const botSelfMute = message.guild.members.me?.voice?.selfMute;

    await message.reply(
      [
        `connection: ${connection ? "yes" : "no"}`,
        `connection state: ${connection?.state?.status || "none"}`,
        `connection channel: ${connection?.joinConfig?.channelId || "none"}`,
        `bot voice channel: ${botVoiceChannel?.id || "none"}`,
        `bot voice name: ${botVoiceChannel?.name || "none"}`,
        `bot server mute: ${botServerMute ? "yes" : "no"}`,
        `bot self mute: ${botSelfMute ? "yes" : "no"}`,
        `user voice channel: ${userVoiceChannel?.id || "none"}`,
        `user voice name: ${userVoiceChannel?.name || "none"}`,
        `queue exists: ${queue ? "yes" : "no"}`,
        `songs in queue: ${queue?.songs?.length || 0}`,
        `isPlaying: ${queue?.isPlaying ? "yes" : "no"}`,
        `currentSong: ${queue?.currentSong?.title || "none"}`,
      ].join("\n")
    );

    return;
  }

  if (command === "leave") {
    const queue = musicQueues.get(guildId);
    const connection = getVoiceConnection(guildId);
    const botVoiceChannel = getBotVoiceChannel(message.guild);

    console.log("[LEAVE COMMAND]", {
      guildId,
      hasQueue: !!queue,
      hasConnection: !!connection,
      connectionState: connection?.state?.status || "none",
      botVoiceChannelId: botVoiceChannel?.id || "none",
      botVoiceChannelName: botVoiceChannel?.name || "none",
    });

    if (queue) {
      queue.songs = [];
      queue.currentSong = null;
      queue.isPlaying = false;

      destroyQueueStream(queue);

      if (queue.player) {
        try {
          queue.player.stop(true);
        } catch (err) {
          console.error("Leave player stop error:", err);
        }
      }
    }

    if (connection) {
      try {
        connection.destroy();
      } catch (err) {
        console.error("Leave connection destroy error:", err);
      }
    }

    if (botVoiceChannel && message.guild.members.me?.voice?.channelId) {
      try {
        await message.guild.members.me.voice.disconnect();
      } catch (err) {
        console.error("Bot voice disconnect error:", err);
      }
    }

    musicQueues.delete(guildId);

    const stillInVoice = getBotVoiceChannel(message.guild);

    if (stillInVoice) {
      return message.reply(
        `⚠️ Попытался выйти, но бот всё ещё отображается в голосовом канале: ${stillInVoice.name}`
      );
    }

    await message.reply("👋 Вышел из голосового канала и очистил очередь.");
    return;
  }

  if (command === "warn") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    if (!target) {
      return message.reply("❗ Использование: `!warn @User/ID/tag <причина>`");
    }

    if (target.id === message.author.id) {
      return message.reply("❌ Нельзя выдать предупреждение самому себе.");
    }

    const userData = getUserData(message.guild.id, target.id);
    cleanupWarns(userData);

    args.shift();
    const reason = args.join(" ") || "Причина не указана";

    userData.warns.push({
      timestamp: Date.now(),
      reason,
      moderatorId: message.author.id,
      moderatorTag: message.author.tag,
    });

    cleanupWarns(userData);
    saveData();

    await message.channel.send(
      `⚠️ | Пользователь ${target.user.tag} получил предупреждение. Причина: ${reason}\n` +
        `Активных предупреждений (за последние 4 дня): ${userData.warns.length}`
    );

    await applyAutoPunishment(message, target, userData);
    return;
  }

  if (command === "unwarn") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    if (!target) {
      return message.reply("❗ Использование: `!unwarn @User/ID/tag <номер>`");
    }

    args.shift();
    const warnNumber = parseInt(args.shift(), 10);

    if (!warnNumber || warnNumber < 1) {
      return message.reply("❗ Укажите корректный номер предупреждения.");
    }

    const userData = getUserData(message.guild.id, target.id);
    cleanupWarns(userData);
    saveData();

    if (warnNumber > userData.warns.length) {
      return message.reply("❗ Предупреждения с таким номером не существует.");
    }

    userData.warns.splice(warnNumber - 1, 1);
    saveData();

    await message.channel.send(
      `🗑️ | У пользователя ${target.user.tag} удалено предупреждение №${warnNumber}.`
    );
    return;
  }

  if (command === "clearwarns") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    if (!target) {
      return message.reply("❗ Использование: `!clearwarns @User/ID/tag`");
    }

    const userData = getUserData(message.guild.id, target.id);
    userData.warns = [];
    saveData();

    await message.channel.send(
      `🧹 | Все предупреждения пользователя ${target.user.tag} были очищены.`
    );
    return;
  }

  if (command === "warns") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    if (!target) {
      return message.reply("❗ Использование: `!warns @User/ID/tag`");
    }

    const userData = getUserData(message.guild.id, target.id);
    cleanupWarns(userData);
    saveData();

    if (userData.warns.length === 0) {
      return message.channel.send(
        `ℹ️ | У пользователя ${target} нет активных предупреждений (последние 4 дня).`
      );
    }

    const list = userData.warns
      .map((w, i) => {
        const date = new Date(w.timestamp).toLocaleString();
        let modDisplay = "Неизвестно";

        if (w.moderatorId) {
          const modMember = message.guild.members.cache.get(w.moderatorId);
          if (modMember) {
            modDisplay = modMember.toString();
          } else if (w.moderatorTag) {
            modDisplay = w.moderatorTag;
          } else {
            modDisplay = w.moderatorId;
          }
        } else if (w.moderatorTag) {
          modDisplay = w.moderatorTag;
        }

        return `${i + 1}. ${w.reason} – ${date} (модератор: ${modDisplay})`;
      })
      .join("\n");

    await message.channel.send(
      `⚠️ Активные предупреждения пользователя ${target} (последние 4 дня):\n${list}`
    );
    return;
  }

  if (command === "mute") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    if (!target) {
      return message.reply(
        "❗ Использование: `!mute @User/ID/tag <время> <причина>`"
      );
    }

    if (target.id === message.author.id) {
      return message.reply("❌ Нельзя выдать мут самому себе.");
    }

    if (!canBeTimedOut(target)) {
      return message.reply(
        "❌ Не удалось выдать мут. У пользователя может быть Administrator или роль выше бота."
      );
    }

    args.shift();
    const durationStr = args.shift();
    const durationMs = parseDuration(durationStr);

    if (!durationMs) {
      return message.reply(
        "❗ Некорректное время. Примеры: `10m`, `1h`, `1d`."
      );
    }

    const reason = args.join(" ") || "Причина не указана";

    try {
      await applyTimeout(
        target,
        durationMs,
        `Manual mute by ${message.author.tag}: ${reason}`
      );

      await message.channel.send(
        `🔇 | Пользователь ${target.user.tag} получил мут на ${formatDuration(
          durationMs
        )}. Причина: ${reason}`
      );
    } catch (err) {
      console.error("Manual mute error:", err);
      await message.channel.send(
        "❌ Не удалось выдать мут (проверьте права бота и иерархию ролей)."
      );
    }

    return;
  }

  if (command === "unmute") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    if (!target) {
      return message.reply("❗ Использование: `!unmute @User/ID/tag`");
    }

    try {
      if (!target.isCommunicationDisabled()) {
        return message.reply("❗ У пользователя сейчас нет мута.");
      }

      await clearTimeoutFromMember(
        target,
        `Manual unmute by ${message.author.tag}`
      );

      await message.channel.send(
        `🔊 | Мут пользователя ${target.user.tag} был снят.`
      );
    } catch (err) {
      console.error("Unmute error:", err);
      await message.channel.send(
        "❌ Не удалось снять мут (проверьте права бота и иерархию ролей)."
      );
    }

    return;
  }

  if (command === "kick") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    if (!target) {
      return message.reply("❗ Использование: `!kick @User/ID/tag <причина>`");
    }

    args.shift();
    const reason = args.join(" ") || "Причина не указана";

    try {
      await target.kick(reason);
      await message.channel.send(
        `👢 | Пользователь ${target.user.tag} был кикнут. Причина: ${reason}`
      );
    } catch (err) {
      console.error("Kick error:", err);
      await message.channel.send(
        "❌ Не удалось кикнуть пользователя (проверьте права)."
      );
    }

    return;
  }

  if (command === "ban") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const targetUser = await resolveUserForBan(
      client,
      message.guild,
      targetInput
    );

    if (!targetUser) {
      return message.reply(
        "❗ Использование: `!ban @User/ID/tag <время> <причина>` или `!ban @User/ID/tag <причина>`"
      );
    }

    args.shift();
    const durationStr = args[0];
    let durationMs = parseBanDuration(durationStr);
    let reason;

    if (durationMs) {
      args.shift();
      reason = args.join(" ") || "Причина не указана";
    } else {
      durationMs = null;
      reason = args.join(" ") || "Причина не указана";
    }

    try {
      await message.guild.members.fetch(targetUser.id).catch(() => null);

      const userData = getUserData(message.guild.id, targetUser.id);
      userData.bans.push({
        timestamp: Date.now(),
        durationMs,
        reason,
        moderatorId: message.author.id,
        moderatorTag: message.author.tag,
      });
      userData.banLevel = Math.min(userData.banLevel + 1, 4);
      saveData();

      await message.guild.members.ban(targetUser.id, { reason });

      const targetName = getPunishmentTargetName(targetUser);
      const moderatorRole = getHighestRoleName(message.member);

      if (durationMs) {
        setActiveTempBan(
          message.guild.id,
          targetUser.id,
          durationMs,
          reason,
          message.author
        );

        await sendOnlyToBanRoom(
          message.guild,
          buildStrictBanRoomLog({
            type: "ban",
            userName: targetName,
            userId: targetUser.id,
            durationText: formatDuration(durationMs),
            reason,
            moderatorTag: message.author.tag,
            moderatorRole,
          })
        );
      } else {
        clearActiveTempBan(message.guild.id, targetUser.id);

        await sendOnlyToBanRoom(
          message.guild,
          buildStrictBanRoomLog({
            type: "ban",
            userName: targetName,
            userId: targetUser.id,
            durationText: "Перманент",
            reason,
            moderatorTag: message.author.tag,
            moderatorRole,
          })
        );
      }
    } catch (err) {
      console.error("Ban error:", err);
      return;
    }

    return;
  }

  if (command === "unban") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args.shift();
    if (!targetInput) {
      return message.reply(
        "❗ Использование: `!unban <UserID/mention/username/tag> [причина]`"
      );
    }

    const reason = args.join(" ") || "Причина не указана";

    try {
      const banEntry = await resolveBanEntry(message.guild, targetInput);

      if (!banEntry) {
        return;
      }

      await message.guild.members.unban(banEntry.user.id, reason);

      const userData = getUserData(message.guild.id, banEntry.user.id);
      if (!Array.isArray(userData.bans)) {
        userData.bans = [];
      }
      clearActiveTempBan(message.guild.id, banEntry.user.id);
      saveData();

      await sendOnlyToBanRoom(
        message.guild,
        buildStrictBanRoomLog({
          type: "unban",
          userName: getPunishmentTargetName(banEntry.user),
          userId: banEntry.user.id,
          reason,
          moderatorTag: message.author.tag,
          moderatorRole: getHighestRoleName(message.member),
        })
      );
    } catch (err) {
      console.error("Unban error:", err);
      return;
    }

    return;
  }

  if (command === "bans") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    let id = null;

    if (target) {
      id = target.id;
    } else if (targetInput) {
      const banEntry = await resolveBanEntry(message.guild, targetInput).catch(
        () => null
      );
      if (banEntry) {
        id = banEntry.user.id;
      } else if (/^\d{16,22}$/.test(targetInput)) {
        id = targetInput;
      }
    }

    if (!id) {
      return message.reply("❗ Использование: `!bans @User/ID/tag`");
    }

    const userData = getUserData(message.guild.id, id);

    if (!userData.bans || userData.bans.length === 0) {
      return message.channel.send(
        `ℹ️ | Для этого пользователя нет записей о банах.`
      );
    }

    const list = userData.bans
      .map((b, i) => {
        const date = new Date(b.timestamp).toLocaleString();
        const duration =
          b.durationMs == null ? "перманент" : formatDuration(b.durationMs);

        let modDisplay = "Неизвестно";
        if (b.moderatorId) {
          const modMember = message.guild.members.cache.get(b.moderatorId);
          if (modMember) {
            modDisplay = modMember.toString();
          } else if (b.moderatorTag) {
            modDisplay = b.moderatorTag;
          } else {
            modDisplay = b.moderatorId;
          }
        } else if (b.moderatorTag) {
          modDisplay = b.moderatorTag;
        }

        return `${i + 1}. ${date} – ${duration} – ${b.reason} (модератор: ${modDisplay})`;
      })
      .join("\n");

    await message.channel.send(
      `⛔ История банов для пользователя ID ${id}:\n${list}`
    );
    return;
  }

  if (command === "clearbans") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const targetInput = args[0];
    const target = await resolveGuildMember(message.guild, targetInput);

    let id = null;

    if (target) {
      id = target.id;
    } else if (targetInput) {
      const banEntry = await resolveBanEntry(message.guild, targetInput).catch(
        () => null
      );
      if (banEntry) {
        id = banEntry.user.id;
      } else if (/^\d{16,22}$/.test(targetInput)) {
        id = targetInput;
      }
    }

    if (!id) {
      return message.reply("❗ Использование: `!clearbans @User/ID/tag`");
    }

    const userData = getUserData(message.guild.id, id);
    userData.bans = [];
    saveData();

    await message.channel.send(
      `🧹 | История банов пользователя ID ${id} была очищена.`
    );
    return;
  }

  if (command === "clear") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const amount = parseInt(args[0], 10);
    if (!amount || amount < 1 || amount > 100) {
      return message.reply("❗ Укажите число от 1 до 100.");
    }

    try {
      const deleted = await message.channel.bulkDelete(amount, true);
      await message.channel
        .send(`🧹 | Удалено ${deleted.size} сообщений.`)
        .then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));
    } catch (err) {
      console.error("Clear error:", err);
      await message.channel.send(
        "❌ Не удалось удалить сообщения (проверьте права)."
      );
    }

    return;
  }

  if (command === "clearall") {
    if (!moderator) {
      return message.reply("❌ У вас нет прав для этой команды.");
    }

    const channel = message.channel;
    await channel.send("🧹 | Очищаю все сообщения в этом канале...");

    try {
      let deleted;
      do {
        const fetched = await channel.messages.fetch({ limit: 100 });
        if (fetched.size === 0) break;
        deleted = await channel.bulkDelete(fetched, true);
      } while (deleted.size !== 0);

      await channel.send(
        "✅ | Канал и статистика сообщений полностью очищены (кроме очень старых сообщений старше 14 дней)."
      );
    } catch (err) {
      console.error("Clearall error:", err);
      await channel.send(
        "❌ | Не удалось очистить сообщения (проверьте права бота)."
      );
    }

    return;
  }

  if (command === "help") {
    const helpText =
      "📋 Команды бота:\n" +
      "— Структура сервера:\n" +
      "`!setupserverlux` – создать/обновить структуру сервера по люксовому русскому макету\n" +
      "`!cleanextraserver` – умная чистка: удалить лишние каналы/категории\n" +
      "`!deletecategory` – удалить текущую категорию и её каналы (если не защищена)\n" +
      "`!deletechannel` – удалить текущий канал (если не защищён)\n" +
      "`!protectchannel` / `!unprotectchannel` – защита канала\n" +
      "`!protectcategory` / `!unprotectcategory` – защита категории\n\n" +
      "— Утилиты:\n" +
      "`!ping` – пинг бота\n" +
      "`!say <текст>` – отправить сообщение от имени бота\n" +
      "`!testwelcome`, `!sendtestrules`, `!sendaccesspanel`, `!sendcandidaterules`, `!sendloginfo`, `!sendallowlistpanel`\n" +
      "`!прошел проверку @User`\n\n" +
      "— Развлечения:\n" +
      "`!coin` – орёл/решка\n" +
      "`!roll <число>` – бросок кубика\n" +
      "`!rps rock|paper|scissors` – камень-ножницы-бумага\n\n" +
      "— Музыка:\n" +
      "`!play <ссылка или название>` – добавить трек и воспроизвести\n" +
      "`!skip`, `!stop`, `!pause`, `!resume`, `!queue`, `!leave`, `!debugvoice`\n\n" +
      "— Ранги:\n" +
      "`!rank` / `!rank @User` – карточка ранга\n" +
      "`!top` – топ-10 по количеству сообщений\n\n" +
      "— Модерация:\n" +
      "`!warn @User/ID/tag <причина>`\n" +
      "`!warns @User/ID/tag`\n" +
      "`!unwarn @User/ID/tag <номер>`\n" +
      "`!clearwarns @User/ID/tag`\n" +
      "`!mute @User/ID/tag <время> <причина>` / `!unmute @User/ID/tag` – Discord timeout\n" +
      "`!kick @User/ID/tag <причина>`\n" +
      "`!ban @User/ID/tag <время> <причина>` – временный бан\n" +
      "`!ban @User/ID/tag <причина>` – перманентный бан\n" +
      "`!unban <UserID/mention/username/tag> <причина>`\n" +
      "`!bans @User/ID/tag` – история банов\n" +
      "`!clearbans @User/ID/tag` – очистить историю банов\n" +
      "`!clear <1-100>` – удалить последние сообщения\n" +
      "`!clearall` – очистить канал и статистика сообщений\n\n" +
      "⏱ Формат времени: `s` = секунды, `m` = минуты, `h` = часы, `d` = дни.\n" +
      "⚠️ Предупреждения считаются только за последние 4 дня.\n" +
      "🔗 Авто-бан за сторонние ссылки включён.";

    await message.channel.send(helpText);
    return;
  }
});

// =============================
// Login
// =============================
client.login(process.env.TOKEN);

// Load allowlist override if present
const allowlistOverridePath = path.join(__dirname, "allowlist_override.js");

if (fs.existsSync(allowlistOverridePath)) {
  require(allowlistOverridePath)(client);
} else {
  console.warn("allowlist_override.js not found, skipping.");
}
