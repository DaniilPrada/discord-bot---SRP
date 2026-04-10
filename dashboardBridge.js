const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { ChannelType } = require("discord.js");

const DEFAULT_COMMANDS = [
  { name: "ping", category: "utility", description: "Show the bot websocket ping.", moderatorOnly: false },
  { name: "тесттревога", category: "alerts", description: "Send a test alert for Israel.", moderatorOnly: false },
  { name: "тесттревогауа", category: "alerts", description: "Send a test alert for Ukraine.", moderatorOnly: false },
  { name: "тестотбой", category: "alerts", description: "Send a test all-clear for Israel.", moderatorOnly: false },
  { name: "тестотбойуа", category: "alerts", description: "Send a test all-clear for Ukraine.", moderatorOnly: false },
  { name: "say", category: "utility", description: "Send a message through the bot.", moderatorOnly: true },
  { name: "n", category: "utility", description: "Post a news/update embed.", moderatorOnly: true },
  { name: "rank", category: "rank", description: "Show a member rank card.", moderatorOnly: false },
  { name: "recountmessages", category: "rank", description: "Recount every message on the server.", moderatorOnly: false },
  { name: "top", category: "rank", description: "Show top users by message count.", moderatorOnly: false },
  { name: "setupserverlux", category: "server", description: "Create the lux server structure.", moderatorOnly: true },
  { name: "cleanextraserver", category: "server", description: "Delete extra channels/categories.", moderatorOnly: true },
  { name: "deletecategory", category: "server", description: "Delete the current category and channels.", moderatorOnly: true },
  { name: "deletechannel", category: "server", description: "Delete the current channel.", moderatorOnly: true },
  { name: "protectchannel", category: "server", description: "Protect the current channel.", moderatorOnly: true },
  { name: "unprotectchannel", category: "server", description: "Remove protection from the current channel.", moderatorOnly: true },
  { name: "protectcategory", category: "server", description: "Protect the current category.", moderatorOnly: true },
  { name: "unprotectcategory", category: "server", description: "Remove protection from the current category.", moderatorOnly: true },
  { name: "testwelcome", category: "utility", description: "Send a test welcome message.", moderatorOnly: false },
  { name: "sendtestrules", category: "utility", description: "Send a test rules embed.", moderatorOnly: false },
  { name: "sendaccesspanel", category: "utility", description: "Send the access panel placeholder.", moderatorOnly: false },
  { name: "sendcandidaterules", category: "utility", description: "Send candidate rules.", moderatorOnly: false },
  { name: "sendloginfo", category: "utility", description: "Send log information placeholder.", moderatorOnly: false },
  { name: "sendallowlistpanel", category: "allowlist", description: "Send the allowlist button panel.", moderatorOnly: true },
  { name: "прошел", category: "allowlist", description: "Grant allowlist access after check.", moderatorOnly: true },
  { name: "coin", category: "fun", description: "Flip a coin.", moderatorOnly: false },
  { name: "roll", category: "fun", description: "Roll a random number.", moderatorOnly: false },
  { name: "rps", category: "fun", description: "Play rock paper scissors.", moderatorOnly: false },
  { name: "play", category: "music", description: "Queue a music track or playlist.", moderatorOnly: false },
  { name: "skip", category: "music", description: "Skip the current track.", moderatorOnly: false },
  { name: "stop", category: "music", description: "Stop playback and clear queue.", moderatorOnly: false },
  { name: "pause", category: "music", description: "Pause playback.", moderatorOnly: false },
  { name: "resume", category: "music", description: "Resume playback.", moderatorOnly: false },
  { name: "queue", category: "music", description: "Show the music queue.", moderatorOnly: false },
  { name: "debugvoice", category: "music", description: "Debug the voice connection.", moderatorOnly: false },
  { name: "leave", category: "music", description: "Disconnect the bot from voice.", moderatorOnly: false },
  { name: "warn", category: "moderation", description: "Warn a member.", moderatorOnly: true },
  { name: "unwarn", category: "moderation", description: "Remove a specific warning.", moderatorOnly: true },
  { name: "clearwarns", category: "moderation", description: "Clear all warnings.", moderatorOnly: true },
  { name: "warns", category: "moderation", description: "Show active warnings.", moderatorOnly: true },
  { name: "mute", category: "moderation", description: "Timeout a member.", moderatorOnly: true },
  { name: "unmute", category: "moderation", description: "Remove timeout from a member.", moderatorOnly: true },
  { name: "kick", category: "moderation", description: "Kick a member.", moderatorOnly: true },
  { name: "ban", category: "moderation", description: "Ban a member.", moderatorOnly: true },
  { name: "unban", category: "moderation", description: "Unban a member.", moderatorOnly: true },
  { name: "bans", category: "moderation", description: "Show a member ban history.", moderatorOnly: true },
  { name: "clearbans", category: "moderation", description: "Clear a member ban history.", moderatorOnly: true },
  { name: "clear", category: "moderation", description: "Bulk delete recent messages.", moderatorOnly: true },
  { name: "clearall", category: "moderation", description: "Clear the current channel.", moderatorOnly: true },
  { name: "help", category: "utility", description: "Show the bot help message.", moderatorOnly: false },
];

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isoNow() {
  return new Date().toISOString();
}

function truncate(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildErrorPayload(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : "Unknown error",
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    const maxBytes = 512 * 1024;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      raw += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function postJson(targetUrl, payload, apiKey) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(targetUrl);
      const body = JSON.stringify(payload);
      const transport = url.protocol === "https:" ? https : http;

      const request = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...(apiKey ? { "x-dashboard-key": apiKey } : {}),
          },
        },
        (response) => {
          let raw = "";
          response.on("data", (chunk) => {
            raw += chunk.toString();
          });
          response.on("end", () => {
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve(raw);
              return;
            }
            reject(new Error(`Request failed with status ${response.statusCode}: ${raw}`));
          });
        }
      );

      request.on("error", reject);
      request.write(body);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function parseDuration(value) {
  const input = String(value || "").trim();
  if (!input) return null;
  const match = input.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  if (unit === "d") return amount * 24 * 60 * 60 * 1000;
  return null;
}

function attachDashboardBridge(client, options = {}) {
  const prefixRef =
    options.prefixRef && typeof options.prefixRef === "object"
      ? options.prefixRef
      : { current: options.prefix || "!" };
  const rankDb = options.rankDb || null;
  const modulesRef =
    options.modulesRef && typeof options.modulesRef === "object"
      ? options.modulesRef
      : {
          welcomeMessages: Boolean(options.modules?.welcomeMessages),
          autoModeration: Boolean(options.modules?.autoModeration),
          musicModule: Boolean(options.modules?.musicModule),
          antiSpamFilter: Boolean(options.modules?.antiSpamFilter),
        };
  const protectionRef =
    options.protectionRef && typeof options.protectionRef === "object"
      ? options.protectionRef
      : { channels: [], categories: [] };
  const punishmentsDataRef =
    options.punishmentsDataRef && typeof options.punishmentsDataRef === "object"
      ? options.punishmentsDataRef
      : { guilds: {} };
  const systemConfigRef =
    options.systemConfigRef && typeof options.systemConfigRef === "object"
      ? options.systemConfigRef
      : {};

  const protectionFilePath = options.protectionFilePath || path.join(__dirname, "protection.json");
  const punishmentsFilePath = options.punishmentsFilePath || path.join(__dirname, "punishments.json");
  const dashboardConfigFilePath = options.dashboardConfigFilePath || path.join(__dirname, "dashboard_config.json");
  const commandCatalog = Array.isArray(options.commandCatalog) ? options.commandCatalog : DEFAULT_COMMANDS;

  const externalServerUrl = process.env.DASHBOARD_SERVER_URL
    ? String(process.env.DASHBOARD_SERVER_URL).trim().replace(/\/+$/, "")
    : "";
  const externalApiKey = process.env.DASHBOARD_API_KEY ? String(process.env.DASHBOARD_API_KEY).trim() : "";
  const writeToken = String(process.env.DASHBOARD_WRITE_TOKEN || process.env.DASHBOARD_API_KEY || "").trim();

  const enableExternalPush = Boolean(externalServerUrl && externalApiKey);
  const enableLocalApi = toBoolean(process.env.DASHBOARD_ENABLE_LOCAL_API, true);
  const bindPublicPort = toBoolean(process.env.DASHBOARD_BIND_PUBLIC_PORT, false);
  const localApiHost = process.env.DASHBOARD_BRIDGE_HOST || "0.0.0.0";
  const localApiPort = bindPublicPort ? toNumber(process.env.PORT, 4001) : toNumber(process.env.DASHBOARD_BRIDGE_PORT, 4001);

  const getAllRankRowsStmt =
    rankDb && typeof rankDb.prepare === "function"
      ? rankDb.prepare("SELECT user_id, xp, level, messages FROM rank_users WHERE guild_id = ?")
      : null;

  const getTotalMessagesStmt =
    rankDb && typeof rankDb.prepare === "function"
      ? rankDb.prepare("SELECT COALESCE(SUM(messages), 0) AS total FROM rank_users WHERE guild_id = ?")
      : null;

  const state = {
    startedAt: isoNow(),
    lastUpdate: null,
    httpServer: null,
    globalLogs: [],
    guildLogs: new Map(),
    guildModerationLogs: new Map(),
    guildCommands: new Map(),
  };

  let snapshotInterval = null;

  function ensureModules() {
    if (typeof modulesRef.welcomeMessages !== "boolean") modulesRef.welcomeMessages = true;
    if (typeof modulesRef.autoModeration !== "boolean") modulesRef.autoModeration = true;
    if (typeof modulesRef.musicModule !== "boolean") modulesRef.musicModule = true;
    if (typeof modulesRef.antiSpamFilter !== "boolean") modulesRef.antiSpamFilter = false;
    return modulesRef;
  }

  function loadDashboardConfig() {
    if (fs.existsSync(dashboardConfigFilePath)) {
      const parsed = safeJsonParse(fs.readFileSync(dashboardConfigFilePath, "utf8"), { guilds: {} });
      return {
        guilds: parsed && typeof parsed.guilds === "object" ? parsed.guilds : {},
      };
    }
    return { guilds: {} };
  }

  const dashboardConfig = loadDashboardConfig();

  function saveDashboardConfig() {
    try {
      fs.writeFileSync(dashboardConfigFilePath, JSON.stringify(dashboardConfig, null, 2), "utf8");
    } catch (error) {
      console.error("Failed to save dashboard config:", error.message);
    }
  }

  function getGuildStoredConfig(guildId) {
    if (!dashboardConfig.guilds[guildId] || typeof dashboardConfig.guilds[guildId] !== "object") {
      dashboardConfig.guilds[guildId] = {};
    }
    return dashboardConfig.guilds[guildId];
  }

  function getCurrentPrefix(guildId) {
    const stored = getGuildStoredConfig(guildId).prefix;
    return String(stored || prefixRef.current || "!").trim() || "!";
  }

  function getEnvironmentForGuild(guildId) {
    const stored = getGuildStoredConfig(guildId);
    return {
      welcomeChannelId: stored.welcomeChannelId || systemConfigRef.welcomeChannelId || process.env.WELCOME_CHANNEL_ID || null,
      logResultsChannelId: stored.logResultsChannelId || systemConfigRef.logResultsChannelId || process.env.LOG_RESULTS_CHANNEL_ID || null,
      rulesCheckChannelId: stored.rulesCheckChannelId || systemConfigRef.rulesCheckChannelId || process.env.RULES_CHECK_CHANNEL_ID || null,
      getAccessChannelId: stored.getAccessChannelId || systemConfigRef.getAccessChannelId || process.env.GET_ACCESS_CHANNEL_ID || null,
      allowlistRoleId: stored.allowlistRoleId || process.env.ALLOWLIST_ROLE_ID || null,
    };
  }

  function updateGuildGeneralSettings(guildId, payload) {
    const stored = getGuildStoredConfig(guildId);
    if (typeof payload.prefix === "string") {
      stored.prefix = String(payload.prefix).trim().slice(0, 4) || "!";
      prefixRef.current = stored.prefix;
    }
    const channelKeys = [
      "welcomeChannelId",
      "logResultsChannelId",
      "rulesCheckChannelId",
      "getAccessChannelId",
      "allowlistRoleId",
    ];
    for (const key of channelKeys) {
      if (payload[key] !== undefined) {
        stored[key] = payload[key] ? String(payload[key]).trim() : "";
      }
    }
    saveDashboardConfig();
    logForGuild(guildId, "dashboard-action", "Dashboard updated general settings.");
    return {
      prefix: getCurrentPrefix(guildId),
      environment: getEnvironmentForGuild(guildId),
    };
  }

  function getPunishmentsData() {
    if (punishmentsDataRef && typeof punishmentsDataRef.guilds === "object") {
      return punishmentsDataRef;
    }
    if (fs.existsSync(punishmentsFilePath)) {
      return safeJsonParse(fs.readFileSync(punishmentsFilePath, "utf8"), { guilds: {} });
    }
    return { guilds: {} };
  }

  function savePunishmentsData() {
    try {
      fs.writeFileSync(punishmentsFilePath, JSON.stringify(punishmentsDataRef, null, 2), "utf8");
    } catch (error) {
      console.error("Failed to save punishments file:", error.message);
    }
  }

  function getGuildPunishmentBucket(guildId) {
    const punishments = getPunishmentsData();
    if (!punishments.guilds[guildId]) {
      punishments.guilds[guildId] = { users: {} };
    }
    if (!punishments.guilds[guildId].users || typeof punishments.guilds[guildId].users !== "object") {
      punishments.guilds[guildId].users = {};
    }
    return punishments.guilds[guildId].users;
  }

  function getMemberPunishmentData(guildId, userId) {
    const users = getGuildPunishmentBucket(guildId);
    if (!users[userId]) {
      users[userId] = { warns: [], bans: [], banLevel: 0 };
    }
    if (!Array.isArray(users[userId].warns)) users[userId].warns = [];
    if (!Array.isArray(users[userId].bans)) users[userId].bans = [];
    return users[userId];
  }

  function getGuildLogList(map, guildId) {
    if (!map.has(guildId)) map.set(guildId, []);
    return map.get(guildId);
  }

  function pushLog(list, entry, maxItems = 350) {
    list.unshift(entry);
    if (list.length > maxItems) list.length = maxItems;
  }

  function logForGuild(guildId, type, message, extra = {}) {
    if (!guildId) return null;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message: truncate(message, 220),
      timestamp: isoNow(),
      ...extra,
    };
    pushLog(state.globalLogs, { ...entry, guildId }, 500);
    pushLog(getGuildLogList(state.guildLogs, guildId), entry, 350);
    if (["moderation", "system", "dashboard-action"].includes(type)) {
      pushLog(getGuildLogList(state.guildModerationLogs, guildId), entry, 350);
    }
    return entry;
  }

  function getCommandState(guildId) {
    if (!state.guildCommands.has(guildId)) {
      state.guildCommands.set(guildId, { total: 0, byName: {} });
    }
    return state.guildCommands.get(guildId);
  }

  function incrementCommandUsage(guildId, commandName) {
    const usage = getCommandState(guildId);
    usage.total += 1;
    usage.byName[commandName] = Number(usage.byName[commandName] || 0) + 1;
  }

  function getProtectionData() {
    if (Array.isArray(protectionRef.channels) && Array.isArray(protectionRef.categories)) {
      return protectionRef;
    }
    if (fs.existsSync(protectionFilePath)) {
      const parsed = safeJsonParse(fs.readFileSync(protectionFilePath, "utf8"), { channels: [], categories: [] });
      return {
        channels: Array.isArray(parsed.channels) ? parsed.channels : [],
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      };
    }
    return { channels: [], categories: [] };
  }

  function saveProtectionData(nextProtection) {
    const normalized = {
      channels: Array.from(new Set(nextProtection.channels || [])),
      categories: Array.from(new Set(nextProtection.categories || [])),
    };
    protectionRef.channels = normalized.channels;
    protectionRef.categories = normalized.categories;
    try {
      fs.writeFileSync(protectionFilePath, JSON.stringify(normalized, null, 2), "utf8");
    } catch (error) {
      console.error("Failed to save protection data:", error.message);
    }
    return normalized;
  }

  function isProtectedChannel(channelId) {
    return getProtectionData().channels.includes(channelId);
  }

  function isProtectedCategory(categoryId) {
    return getProtectionData().categories.includes(categoryId);
  }

  async function getGuild(guildId) {
    if (!guildId) throw new Error("Missing guildId");
    const cached = client.guilds.cache.get(guildId);
    if (cached) return cached;
    const fetched = await client.guilds.fetch(guildId).catch(() => null);
    if (!fetched) throw new Error(`Guild ${guildId} was not found`);
    return fetched;
  }

  function getGuildModules() {
    const modules = ensureModules();
    return {
      welcomeMessages: Boolean(modules.welcomeMessages),
      autoModeration: Boolean(modules.autoModeration),
      musicModule: Boolean(modules.musicModule),
      antiSpamFilter: Boolean(modules.antiSpamFilter),
    };
  }

  function getMemoryMb() {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
  }

  function getCpuUsage() {
    const cpuCount = Math.max(os.cpus().length, 1);
    const load = os.loadavg()[0] / cpuCount;
    return Number((load * 100).toFixed(1));
  }

  function mapGuild(guild) {
    return {
      id: guild.id,
      name: guild.name,
      memberCount: Number(guild.memberCount || 0),
      iconUrl: guild.iconURL({ extension: "png", size: 128 }),
      ownerId: guild.ownerId || null,
    };
  }

  function mapRole(role) {
    return {
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      managed: role.managed,
      mentionable: role.mentionable,
    };
  }

  function mapChannel(channel) {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId || null,
      position: channel.position || channel.rawPosition || 0,
      categoryName: channel.parent?.name || null,
      protected: channel.type === ChannelType.GuildCategory ? isProtectedCategory(channel.id) : isProtectedChannel(channel.id),
    };
  }

  function getGuildCommandUsage(guildId) {
    const usage = getCommandState(guildId);
    const guildPrefix = getCurrentPrefix(guildId);
    return commandCatalog.map((command) => ({
      ...command,
      usageCount: Number(usage.byName[command.name] || 0),
      enabled: command.category === "music" ? getGuildModules().musicModule : true,
      label: `${guildPrefix}${command.name}`,
    }));
  }

  function buildPunishmentLogs(guildId) {
    const users = getGuildPunishmentBucket(guildId);
    const entries = [];
    for (const [userId, userData] of Object.entries(users)) {
      const warns = Array.isArray(userData.warns) ? userData.warns : [];
      const bans = Array.isArray(userData.bans) ? userData.bans : [];
      warns.forEach((warn, index) => {
        entries.push({
          id: `warn-${guildId}-${userId}-${warn.timestamp || index}`,
          type: "warn-history",
          message: `Warn #${index + 1} for user ${userId}: ${truncate(warn.reason || "No reason", 120)}${warn.moderatorTag ? ` (mod: ${warn.moderatorTag})` : ""}`,
          timestamp: warn.timestamp ? new Date(warn.timestamp).toISOString() : isoNow(),
          userId,
        });
      });
      bans.forEach((ban, index) => {
        const duration = ban.durationMs == null ? "permanent" : `${Math.round(Number(ban.durationMs) / 60000)}m`;
        entries.push({
          id: `ban-${guildId}-${userId}-${ban.timestamp || index}`,
          type: "ban-history",
          message: `Ban record for ${userId}: ${duration} – ${truncate(ban.reason || "No reason", 120)}${ban.moderatorTag ? ` (mod: ${ban.moderatorTag})` : ""}`,
          timestamp: ban.timestamp ? new Date(ban.timestamp).toISOString() : isoNow(),
          userId,
        });
      });
      if (userData.activeTempBan && userData.activeTempBan.startedAt) {
        entries.push({
          id: `tempban-${guildId}-${userId}-${userData.activeTempBan.startedAt}`,
          type: "temp-ban",
          message: `Active temp ban for ${userId}: ${truncate(userData.activeTempBan.reason || "No reason", 120)}`,
          timestamp: new Date(userData.activeTempBan.startedAt).toISOString(),
          userId,
        });
      }
    }
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries;
  }

  async function buildGuildDashboard(guildId) {
    const guild = await getGuild(guildId);
    const commandState = getCommandState(guildId);
    const totalMessages = getTotalMessagesStmt ? Number(getTotalMessagesStmt.get(guildId)?.total || 0) : 0;

    let bannedUsers = 0;
    try {
      bannedUsers = (await guild.bans.fetch()).size;
    } catch {
      bannedUsers = 0;
    }

    return {
      ok: true,
      guild: mapGuild(guild),
      primaryServerName: guild.name,
      primaryServerMembers: Number(guild.memberCount || 0),
      totalServers: client.guilds.cache.size,
      totalUsers: Number(guild.memberCount || 0),
      activeCommands: commandState.total,
      bannedUsers,
      totalMessages,
      botStatus: client.isReady() ? "online" : "starting",
      ping: Math.round(client.ws.ping || 0),
      memoryMb: getMemoryMb(),
      cpuUsage: getCpuUsage(),
      modules: getGuildModules(),
      lastUpdate: isoNow(),
      recentActivity: getGuildLogList(state.guildLogs, guildId).slice(0, 50),
      moderationLogs: getGuildLogList(state.guildModerationLogs, guildId).slice(0, 50),
      commandUsage: getGuildCommandUsage(guildId)
        .filter((item) => item.usageCount > 0)
        .map((item) => ({ name: item.name, label: `${getCurrentPrefix(guildId)}${item.name}`, count: item.usageCount })),
      security: { writeAuthRequired: Boolean(writeToken) },
    };
  }

  async function buildUsersPayload(guildId) {
    const guild = await getGuild(guildId);
    await guild.members.fetch().catch(() => null);

    const rankRows = getAllRankRowsStmt ? getAllRankRowsStmt.all(guildId) : [];
    const rankMap = new Map(rankRows.map((row) => [row.user_id, { xp: Number(row.xp || 0), level: Number(row.level || 0), messages: Number(row.messages || 0) }]));

    const users = guild.members.cache
      .filter((member) => !member.user.bot)
      .map((member) => {
        const topRole = member.roles.cache.filter((role) => role.name !== "@everyone").sort((a, b) => b.position - a.position).first();
        const rank = rankMap.get(member.id) || { xp: 0, level: 0, messages: 0 };
        const punishments = getMemberPunishmentData(guildId, member.id);
        return {
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
          tag: member.user.tag,
          avatarUrl: member.displayAvatarURL({ extension: "png", size: 128 }),
          joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
          highestRole: topRole ? topRole.name : "No role",
          roleIds: member.roles.cache.filter((role) => role.name !== "@everyone").sort((a, b) => b.position - a.position).map((role) => role.id),
          roles: member.roles.cache.filter((role) => role.name !== "@everyone").sort((a, b) => b.position - a.position).map((role) => role.name),
          xp: rank.xp,
          level: rank.level,
          messages: rank.messages,
          warns: Array.isArray(punishments.warns) ? punishments.warns : [],
          bans: Array.isArray(punishments.bans) ? punishments.bans : [],
          activeTempBan: punishments.activeTempBan || null,
          timedOutUntil: member.communicationDisabledUntil ? member.communicationDisabledUntil.toISOString() : null,
          isBanned: false,
        };
      })
      .sort((a, b) => b.messages - a.messages || a.displayName.localeCompare(b.displayName));

    return { ok: true, guild: mapGuild(guild), users };
  }

  async function buildCommandsPayload(guildId) {
    const guild = await getGuild(guildId);
    return {
      ok: true,
      guild: mapGuild(guild),
      totalCommands: getCommandState(guildId).total,
      commands: getGuildCommandUsage(guildId),
    };
  }

  async function buildLogsPayload(guildId) {
    const guild = await getGuild(guildId);
    const liveLogs = getGuildLogList(state.guildLogs, guildId);
    const deepLogs = buildPunishmentLogs(guildId);
    const merged = [...liveLogs, ...deepLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const moderation = [...getGuildLogList(state.guildModerationLogs, guildId), ...deepLogs.filter((entry) => entry.type.includes("warn") || entry.type.includes("ban"))].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return { ok: true, guild: mapGuild(guild), logs: merged.slice(0, 400), moderationLogs: moderation.slice(0, 300) };
  }

  async function buildSettingsPayload(guildId) {
    const guild = await getGuild(guildId);
    await guild.channels.fetch().catch(() => null);
    await guild.roles.fetch().catch(() => null);

    const categories = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).sort((a, b) => (a.rawPosition || a.position || 0) - (b.rawPosition || b.position || 0)).map(mapChannel);
    const channels = guild.channels.cache.filter((channel) => channel.type !== ChannelType.GuildCategory).sort((a, b) => (a.rawPosition || a.position || 0) - (b.rawPosition || b.position || 0)).map(mapChannel);
    const roles = guild.roles.cache.filter((role) => role.name !== "@everyone").sort((a, b) => b.position - a.position).map(mapRole);
    const textChannels = guild.channels.cache
      .filter((channel) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
      .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
      .map((channel) => ({ id: channel.id, name: channel.name }));

    return {
      ok: true,
      guild: mapGuild(guild),
      prefix: getCurrentPrefix(guildId),
      modules: getGuildModules(),
      protection: getProtectionData(),
      categories,
      channels,
      roles,
      textChannels,
      environment: getEnvironmentForGuild(guildId),
      security: { writeAuthRequired: Boolean(writeToken) },
    };
  }

  function updateModules(partialModules) {
    const modules = ensureModules();
    const allowedKeys = ["welcomeMessages", "autoModeration", "musicModule", "antiSpamFilter"];
    for (const key of allowedKeys) {
      if (typeof partialModules[key] === "boolean") modules[key] = partialModules[key];
    }
    return getGuildModules();
  }

  async function createTextChannel(guildId, payload) {
    const guild = await getGuild(guildId);
    const name = truncate(payload.name || "", 90).toLowerCase();
    if (!name) throw new Error("Channel name is required");
    const channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: payload.parentId || undefined });
    logForGuild(guildId, "dashboard-action", `Dashboard created text channel #${channel.name}.`);
    return mapChannel(channel);
  }

  async function createVoiceChannel(guildId, payload) {
    const guild = await getGuild(guildId);
    const name = truncate(payload.name || "", 90);
    if (!name) throw new Error("Voice channel name is required");
    const channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: payload.parentId || undefined });
    logForGuild(guildId, "dashboard-action", `Dashboard created voice channel ${channel.name}.`);
    return mapChannel(channel);
  }

  async function createCategory(guildId, payload) {
    const guild = await getGuild(guildId);
    const name = truncate(payload.name || "", 90);
    if (!name) throw new Error("Category name is required");
    const channel = await guild.channels.create({ name, type: ChannelType.GuildCategory });
    logForGuild(guildId, "dashboard-action", `Dashboard created category ${channel.name}.`);
    return mapChannel(channel);
  }

  async function updateChannel(guildId, channelId, payload) {
    const guild = await getGuild(guildId);
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel) throw new Error("Channel was not found");
    if (channel.type === ChannelType.GuildCategory) throw new Error("Use the category endpoint to update a category");
    const beforeName = channel.name;
    const updated = await channel.edit({ ...(payload.name ? { name: truncate(payload.name, 90) } : {}), ...(payload.parentId !== undefined ? { parent: payload.parentId || null } : {}) });
    logForGuild(guildId, "dashboard-action", `Dashboard updated channel ${beforeName} -> ${updated.name}.`);
    return mapChannel(updated);
  }

  async function updateCategory(guildId, categoryId, payload) {
    const guild = await getGuild(guildId);
    const channel = guild.channels.cache.get(categoryId) || (await guild.channels.fetch(categoryId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildCategory) throw new Error("Category was not found");
    const beforeName = channel.name;
    const updated = await channel.edit({ ...(payload.name ? { name: truncate(payload.name, 90) } : {}) });
    logForGuild(guildId, "dashboard-action", `Dashboard updated category ${beforeName} -> ${updated.name}.`);
    return mapChannel(updated);
  }

  async function deleteChannel(guildId, channelId) {
    const guild = await getGuild(guildId);
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel) throw new Error("Channel was not found");
    if (channel.type === ChannelType.GuildCategory) throw new Error("Use the category endpoint to delete a category");
    if (isProtectedChannel(channel.id)) throw new Error("This channel is protected");
    const name = channel.name;
    await channel.delete("Deleted from dashboard");
    logForGuild(guildId, "dashboard-action", `Dashboard deleted channel ${name}.`);
    return { ok: true };
  }

  async function deleteCategory(guildId, categoryId) {
    const guild = await getGuild(guildId);
    const category = guild.channels.cache.get(categoryId) || (await guild.channels.fetch(categoryId).catch(() => null));
    if (!category || category.type !== ChannelType.GuildCategory) throw new Error("Category was not found");
    if (isProtectedCategory(category.id)) throw new Error("This category is protected");
    const protectedChildren = category.children.cache.filter((channel) => isProtectedChannel(channel.id));
    if (protectedChildren.size > 0) throw new Error("This category contains protected channels");
    for (const channel of category.children.cache.values()) {
      await channel.delete("Deleted with category from dashboard");
    }
    const name = category.name;
    await category.delete("Deleted from dashboard");
    logForGuild(guildId, "dashboard-action", `Dashboard deleted category ${name}.`);
    return { ok: true };
  }

  function protectChannel(guildId, channelId) {
    const protection = getProtectionData();
    if (!protection.channels.includes(channelId)) {
      protection.channels.push(channelId);
      saveProtectionData(protection);
      logForGuild(guildId, "dashboard-action", `Dashboard protected channel ${channelId}.`);
    }
    return protection;
  }

  function unprotectChannel(guildId, channelId) {
    const protection = getProtectionData();
    protection.channels = protection.channels.filter((id) => id !== channelId);
    saveProtectionData(protection);
    logForGuild(guildId, "dashboard-action", `Dashboard removed protection from channel ${channelId}.`);
    return protection;
  }

  function protectCategory(guildId, categoryId) {
    const protection = getProtectionData();
    if (!protection.categories.includes(categoryId)) {
      protection.categories.push(categoryId);
      saveProtectionData(protection);
      logForGuild(guildId, "dashboard-action", `Dashboard protected category ${categoryId}.`);
    }
    return protection;
  }

  function unprotectCategory(guildId, categoryId) {
    const protection = getProtectionData();
    protection.categories = protection.categories.filter((id) => id !== categoryId);
    saveProtectionData(protection);
    logForGuild(guildId, "dashboard-action", `Dashboard removed protection from category ${categoryId}.`);
    return protection;
  }

  async function addRoleToMember(guildId, memberId, roleId) {
    const guild = await getGuild(guildId);
    const member = await guild.members.fetch(memberId).catch(() => null);
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
    if (!member || !role) throw new Error("Member or role was not found");
    await member.roles.add(role, "Added from dashboard");
    logForGuild(guildId, "dashboard-action", `Dashboard added role ${role.name} to ${member.user.tag}.`);
    return { ok: true };
  }

  async function removeRoleFromMember(guildId, memberId, roleId) {
    const guild = await getGuild(guildId);
    const member = await guild.members.fetch(memberId).catch(() => null);
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
    if (!member || !role) throw new Error("Member or role was not found");
    await member.roles.remove(role, "Removed from dashboard");
    logForGuild(guildId, "dashboard-action", `Dashboard removed role ${role.name} from ${member.user.tag}.`);
    return { ok: true };
  }

  async function warnMember(guildId, memberId, reason) {
    const guild = await getGuild(guildId);
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) throw new Error("Member was not found");
    const userData = getMemberPunishmentData(guildId, memberId);
    userData.warns.push({ timestamp: Date.now(), reason: truncate(reason || "No reason", 180), moderatorId: "dashboard", moderatorTag: "Dashboard" });
    savePunishmentsData();
    logForGuild(guildId, "moderation", `Dashboard warned ${member.user.tag}: ${truncate(reason || "No reason", 140)}.`);
    return { ok: true };
  }

  async function clearWarnsForMember(guildId, memberId) {
    const guild = await getGuild(guildId);
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) throw new Error("Member was not found");
    const userData = getMemberPunishmentData(guildId, memberId);
    userData.warns = [];
    savePunishmentsData();
    logForGuild(guildId, "moderation", `Dashboard cleared warnings for ${member.user.tag}.`);
    return { ok: true };
  }

  async function muteMember(guildId, memberId, durationText, reason) {
    const guild = await getGuild(guildId);
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) throw new Error("Member was not found");
    const durationMs = parseDuration(durationText);
    if (!durationMs) throw new Error("Duration must look like 10m, 1h or 1d");
    await member.timeout(durationMs, `Dashboard mute: ${reason || "No reason"}`);
    logForGuild(guildId, "moderation", `Dashboard muted ${member.user.tag} for ${durationText}: ${truncate(reason || "No reason", 140)}.`);
    return { ok: true };
  }

  async function unmuteMember(guildId, memberId) {
    const guild = await getGuild(guildId);
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) throw new Error("Member was not found");
    await member.timeout(null, "Dashboard unmute");
    logForGuild(guildId, "moderation", `Dashboard removed timeout from ${member.user.tag}.`);
    return { ok: true };
  }

  async function kickMember(guildId, memberId, reason) {
    const guild = await getGuild(guildId);
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) throw new Error("Member was not found");
    await member.kick(`Dashboard: ${reason || "No reason"}`);
    logForGuild(guildId, "moderation", `Dashboard kicked ${member.user.tag}: ${truncate(reason || "No reason", 140)}.`);
    return { ok: true };
  }

  async function banMember(guildId, memberId, durationText, reason) {
    const guild = await getGuild(guildId);
    const userData = getMemberPunishmentData(guildId, memberId);
    const durationMs = durationText ? parseDuration(durationText) : null;
    userData.bans.push({ timestamp: Date.now(), durationMs, reason: truncate(reason || "No reason", 180), moderatorId: "dashboard", moderatorTag: "Dashboard" });
    if (durationMs) {
      userData.activeTempBan = {
        startedAt: Date.now(),
        expiresAt: Date.now() + durationMs,
        durationMs,
        reason: truncate(reason || "No reason", 180),
        moderatorId: "dashboard",
        moderatorTag: "Dashboard",
      };
    } else {
      delete userData.activeTempBan;
    }
    savePunishmentsData();
    await guild.members.ban(memberId, { reason: `Dashboard: ${reason || "No reason"}` });
    logForGuild(guildId, "moderation", `Dashboard banned ${memberId}${durationText ? ` for ${durationText}` : " permanently"}: ${truncate(reason || "No reason", 140)}.`);
    return { ok: true };
  }

  async function unbanMember(guildId, memberId, reason) {
    const guild = await getGuild(guildId);
    await guild.members.unban(memberId, `Dashboard: ${reason || "No reason"}`);
    const userData = getMemberPunishmentData(guildId, memberId);
    delete userData.activeTempBan;
    savePunishmentsData();
    logForGuild(guildId, "moderation", `Dashboard unbanned ${memberId}: ${truncate(reason || "No reason", 140)}.`);
    return { ok: true };
  }

  async function pushExternalSnapshot(snapshot) {
    if (!enableExternalPush) return;
    await postJson(`${externalServerUrl}/api/ingest/snapshot`, snapshot, externalApiKey);
  }

  async function pushExternalEvent(type, payload) {
    if (!enableExternalPush) return;
    await postJson(`${externalServerUrl}/api/ingest/event`, { type, ...payload }, externalApiKey);
  }

  async function refreshAllGuildSnapshots() {
    if (!client.isReady()) return;
    for (const guild of client.guilds.cache.values()) {
      try {
        const payload = await buildGuildDashboard(guild.id);
        await pushExternalSnapshot(payload);
      } catch (error) {
        console.error(`Dashboard snapshot failed for guild ${guild.id}:`, error.message);
      }
    }
    state.lastUpdate = isoNow();
  }

  function isAuthorizedWrite(request) {
    if (!writeToken) return true;
    const headerValue = String(request.headers["x-dashboard-token"] || "").trim();
    const authHeader = String(request.headers.authorization || "").trim();
    const bearerValue = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    return headerValue === writeToken || bearerValue === writeToken;
  }

  async function handleApiRequest(request, response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dashboard-key, x-dashboard-token, Authorization");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    const parts = pathname.split("/").filter(Boolean);

    if (request.method !== "GET" && !isAuthorizedWrite(request)) {
      sendJson(response, 401, { ok: false, error: "Unauthorized write action" });
      return;
    }

    if (request.method === "GET" && pathname === "/") {
      sendJson(response, 200, {
        ok: true,
        service: "dashboard-bridge",
        endpoints: [
          "/health",
          "/api/guilds",
          "/api/guilds/:guildId/dashboard",
          "/api/guilds/:guildId/users",
          "/api/guilds/:guildId/logs",
          "/api/guilds/:guildId/commands",
          "/api/guilds/:guildId/settings",
          "/api/guilds/:guildId/settings/general",
        ],
      });
      return;
    }

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "dashboard-bridge",
        botReady: client.isReady(),
        lastUpdate: state.lastUpdate,
        writeAuthRequired: Boolean(writeToken),
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/guilds") {
      await client.guilds.fetch().catch(() => null);
      sendJson(response, 200, {
        ok: true,
        guilds: client.guilds.cache.map((guild) => ({
          id: guild.id,
          name: guild.name,
          memberCount: Number(guild.memberCount || 0),
          iconUrl: guild.iconURL({ extension: "png", size: 128 }),
          ownerId: guild.ownerId || null,
        })),
        security: { writeAuthRequired: Boolean(writeToken) },
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/dashboard") {
      const firstGuild = client.guilds.cache.first();
      if (!firstGuild) {
        sendJson(response, 200, {
          ok: true,
          primaryServerName: "No Server",
          primaryServerMembers: 0,
          totalServers: 0,
          totalUsers: 0,
          activeCommands: 0,
          bannedUsers: 0,
          totalMessages: 0,
          botStatus: client.isReady() ? "online" : "starting",
          ping: Math.round(client.ws.ping || 0),
          memoryMb: getMemoryMb(),
          cpuUsage: getCpuUsage(),
          modules: getGuildModules(),
          lastUpdate: state.lastUpdate,
          recentActivity: [],
          moderationLogs: [],
          commandUsage: [],
          security: { writeAuthRequired: Boolean(writeToken) },
        });
        return;
      }
      sendJson(response, 200, await buildGuildDashboard(firstGuild.id));
      return;
    }

    if (parts[0] === "api" && parts[1] === "guilds" && parts[2]) {
      const guildId = parts[2];

      if (request.method === "GET" && parts[3] === "dashboard") {
        sendJson(response, 200, await buildGuildDashboard(guildId));
        return;
      }
      if (request.method === "GET" && parts[3] === "users") {
        sendJson(response, 200, await buildUsersPayload(guildId));
        return;
      }
      if (request.method === "GET" && parts[3] === "logs") {
        sendJson(response, 200, await buildLogsPayload(guildId));
        return;
      }
      if (request.method === "GET" && parts[3] === "commands") {
        sendJson(response, 200, await buildCommandsPayload(guildId));
        return;
      }
      if (request.method === "GET" && parts[3] === "settings") {
        sendJson(response, 200, await buildSettingsPayload(guildId));
        return;
      }
      if (request.method === "GET" && parts[3] === "roles") {
        const settings = await buildSettingsPayload(guildId);
        sendJson(response, 200, { ok: true, guild: settings.guild, roles: settings.roles });
        return;
      }
      if (request.method === "PATCH" && parts[3] === "modules") {
        const payload = await parseJsonBody(request);
        const modules = updateModules(payload || {});
        logForGuild(guildId, "dashboard-action", `Dashboard updated bot controls: ${JSON.stringify(modules)}`);
        sendJson(response, 200, { ok: true, modules });
        return;
      }
      if (request.method === "PATCH" && parts[3] === "settings" && parts[4] === "general") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, { ok: true, settings: updateGuildGeneralSettings(guildId, payload || {}) });
        return;
      }
      if (request.method === "POST" && parts[3] === "channels" && parts[4] === "text") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, { ok: true, channel: await createTextChannel(guildId, payload) });
        return;
      }
      if (request.method === "POST" && parts[3] === "channels" && parts[4] === "voice") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, { ok: true, channel: await createVoiceChannel(guildId, payload) });
        return;
      }
      if (request.method === "POST" && parts[3] === "categories") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, { ok: true, category: await createCategory(guildId, payload) });
        return;
      }
      if (request.method === "PATCH" && parts[3] === "channels" && parts[4]) {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, { ok: true, channel: await updateChannel(guildId, parts[4], payload) });
        return;
      }
      if (request.method === "DELETE" && parts[3] === "channels" && parts[4]) {
        sendJson(response, 200, await deleteChannel(guildId, parts[4]));
        return;
      }
      if (request.method === "PATCH" && parts[3] === "categories" && parts[4]) {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, { ok: true, category: await updateCategory(guildId, parts[4], payload) });
        return;
      }
      if (request.method === "DELETE" && parts[3] === "categories" && parts[4]) {
        sendJson(response, 200, await deleteCategory(guildId, parts[4]));
        return;
      }
      if (parts[3] === "protect" && parts[4] === "channel" && parts[5] && request.method === "POST") {
        sendJson(response, 200, { ok: true, protection: protectChannel(guildId, parts[5]) });
        return;
      }
      if (parts[3] === "protect" && parts[4] === "channel" && parts[5] && request.method === "DELETE") {
        sendJson(response, 200, { ok: true, protection: unprotectChannel(guildId, parts[5]) });
        return;
      }
      if (parts[3] === "protect" && parts[4] === "category" && parts[5] && request.method === "POST") {
        sendJson(response, 200, { ok: true, protection: protectCategory(guildId, parts[5]) });
        return;
      }
      if (parts[3] === "protect" && parts[4] === "category" && parts[5] && request.method === "DELETE") {
        sendJson(response, 200, { ok: true, protection: unprotectCategory(guildId, parts[5]) });
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "roles" && request.method === "POST") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, await addRoleToMember(guildId, parts[4], payload.roleId));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "roles" && parts[6] && request.method === "DELETE") {
        sendJson(response, 200, await removeRoleFromMember(guildId, parts[4], parts[6]));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "warn" && request.method === "POST") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, await warnMember(guildId, parts[4], payload.reason));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "warns" && request.method === "DELETE") {
        sendJson(response, 200, await clearWarnsForMember(guildId, parts[4]));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "mute" && request.method === "POST") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, await muteMember(guildId, parts[4], payload.duration, payload.reason));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "mute" && request.method === "DELETE") {
        sendJson(response, 200, await unmuteMember(guildId, parts[4]));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "kick" && request.method === "POST") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, await kickMember(guildId, parts[4], payload.reason));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "ban" && request.method === "POST") {
        const payload = await parseJsonBody(request);
        sendJson(response, 200, await banMember(guildId, parts[4], payload.duration, payload.reason));
        return;
      }
      if (parts[3] === "members" && parts[4] && parts[5] === "ban" && request.method === "DELETE") {
        const payload = await parseJsonBody(request).catch(() => ({}));
        sendJson(response, 200, await unbanMember(guildId, parts[4], payload.reason));
        return;
      }
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  }

  function startLocalApiServer() {
    if (!enableLocalApi) {
      console.log("Dashboard local API disabled.");
      return;
    }
    if (state.httpServer) return;
    state.httpServer = http.createServer(async (request, response) => {
      try {
        await handleApiRequest(request, response);
      } catch (error) {
        console.error("Dashboard API request error:", error);
        sendJson(response, 500, buildErrorPayload(error));
      }
    });

    state.httpServer.on("error", (error) => {
      console.error(`Dashboard local API failed on ${localApiHost}:${localApiPort}:`, error.message);
    });

    state.httpServer.listen(localApiPort, localApiHost, () => {
      console.log(`Dashboard local API listening on http://${localApiHost}:${localApiPort}`);
      if (bindPublicPort) {
        console.log("Dashboard bridge is bound to the public PORT. Do not run another public HTTP server on the same port.");
      }
    });
  }

  client.on("clientReady", () => {
    const firstGuild = client.guilds.cache.first();
    if (firstGuild) {
      logForGuild(firstGuild.id, "system", `Bot connected as ${client.user.tag}.`);
    }

    pushExternalEvent("system", { message: `Bot connected as ${client.user.tag}` }).catch((error) => {
      console.error("Dashboard ready event error:", error.message);
    });

    startLocalApiServer();
    refreshAllGuildSnapshots().catch((error) => {
      console.error("Initial dashboard snapshot error:", error.message);
    });

    if (snapshotInterval) clearInterval(snapshotInterval);
    snapshotInterval = setInterval(() => {
      refreshAllGuildSnapshots().catch((error) => {
        console.error("Dashboard interval snapshot error:", error.message);
      });
    }, 10000);
  });

  client.on("guildCreate", (guild) => {
    logForGuild(guild.id, "system", `Bot joined guild ${guild.name}.`);
  });

  client.on("guildDelete", (guild) => {
    logForGuild(guild.id, "system", `Bot left guild ${guild.name}.`);
  });

  client.on("guildMemberAdd", (member) => {
    logForGuild(member.guild.id, "member", `${member.user.tag} joined ${member.guild.name}.`);
  });

  client.on("guildMemberRemove", (member) => {
    logForGuild(member.guild.id, "member", `${member.user.tag} left ${member.guild.name}.`);
  });

  client.on("guildBanAdd", (ban) => {
    const message = `${ban.user.tag} was banned in ${ban.guild.name}.`;
    logForGuild(ban.guild.id, "moderation", message);
    pushExternalEvent("moderation", { message }).catch((error) => {
      console.error("Dashboard ban event error:", error.message);
    });
  });

  client.on("guildBanRemove", (ban) => {
    const message = `${ban.user.tag} was unbanned in ${ban.guild.name}.`;
    logForGuild(ban.guild.id, "moderation", message);
    pushExternalEvent("moderation", { message }).catch((error) => {
      console.error("Dashboard unban event error:", error.message);
    });
  });

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    const oldRoles = new Set(oldMember.roles.cache.keys());
    const newRoles = new Set(newMember.roles.cache.keys());
    for (const roleId of newRoles) {
      if (!oldRoles.has(roleId) && roleId !== newMember.guild.id) {
        const role = newMember.guild.roles.cache.get(roleId);
        logForGuild(newMember.guild.id, "role", `${newMember.user.tag} received role ${role ? role.name : roleId}.`);
      }
    }
    for (const roleId of oldRoles) {
      if (!newRoles.has(roleId) && roleId !== newMember.guild.id) {
        const role = oldMember.guild.roles.cache.get(roleId);
        logForGuild(oldMember.guild.id, "role", `${newMember.user.tag} lost role ${role ? role.name : roleId}.`);
      }
    }
  });

  client.on("channelCreate", (channel) => {
    if (!channel.guild) return;
    logForGuild(channel.guild.id, "channel", `Channel created: ${channel.name}.`);
  });

  client.on("channelUpdate", (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    if (oldChannel.name !== newChannel.name) {
      logForGuild(newChannel.guild.id, "channel", `Channel renamed: ${oldChannel.name} -> ${newChannel.name}.`);
    }
  });

  client.on("channelDelete", (channel) => {
    if (!channel.guild) return;
    logForGuild(channel.guild.id, "channel", `Channel deleted: ${channel.name}.`);
  });

  client.on("roleCreate", (role) => {
    logForGuild(role.guild.id, "role", `Role created: ${role.name}.`);
  });

  client.on("roleUpdate", (oldRole, newRole) => {
    if (oldRole.name !== newRole.name) {
      logForGuild(newRole.guild.id, "role", `Role renamed: ${oldRole.name} -> ${newRole.name}.`);
    }
  });

  client.on("roleDelete", (role) => {
    logForGuild(role.guild.id, "role", `Role deleted: ${role.name}.`);
  });

  client.on("messageCreate", (message) => {
    if (!message.guild || message.author.bot) return;
    const guildPrefix = getCurrentPrefix(message.guild.id);
    const content = String(message.content || "").trim();
    if (!content.startsWith(guildPrefix)) return;

    const commandName = content.slice(guildPrefix.length).trim().split(/\s+/)[0]?.toLowerCase() || "unknown";
    incrementCommandUsage(message.guild.id, commandName);
    const baseMessage = `${message.author.tag} used ${guildPrefix}${commandName}`;
    logForGuild(message.guild.id, "command", baseMessage, { commandName, rawCommand: truncate(content, 240) });

    pushExternalEvent("command", { commandName, message: baseMessage }).catch((error) => {
      console.error("Dashboard command event error:", error.message);
    });

    const moderationCommands = new Set(["warn", "unwarn", "clearwarns", "warns", "mute", "unmute", "kick", "ban", "unban", "bans", "clearbans", "clear", "clearall"]);
    if (moderationCommands.has(commandName)) {
      const moderationMessage = `${message.author.tag} executed ${truncate(content, 220)}`;
      logForGuild(message.guild.id, "moderation", moderationMessage, { commandName });
      pushExternalEvent("moderation", { message: moderationMessage }).catch((error) => {
        console.error("Dashboard moderation event error:", error.message);
      });
    }
  });

  ensureModules();
  console.log(`Dashboard bridge initialized. Local API=${enableLocalApi ? "on" : "off"}, external push=${enableExternalPush ? "on" : "off"}`);
}

module.exports = { attachDashboardBridge };
