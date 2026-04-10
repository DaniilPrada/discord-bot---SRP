const os = require("os");
const http = require("http");
const https = require("https");

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

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

            reject(
              new Error(
                `Request failed with status ${response.statusCode}: ${raw}`
              )
            );
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

function attachDashboardBridge(client, options = {}) {
  const prefix = options.prefix || "!";
  const rankDb = options.rankDb || null;
  const modules = {
    welcomeMessages: Boolean(options.modules?.welcomeMessages),
    autoModeration: Boolean(options.modules?.autoModeration),
    musicModule: Boolean(options.modules?.musicModule),
    antiSpamFilter: Boolean(options.modules?.antiSpamFilter),
  };

  const externalServerUrl = process.env.DASHBOARD_SERVER_URL
    ? String(process.env.DASHBOARD_SERVER_URL).trim().replace(/\/+$/, "")
    : "";
  const externalApiKey = process.env.DASHBOARD_API_KEY
    ? String(process.env.DASHBOARD_API_KEY).trim()
    : "";

  const enableExternalPush = Boolean(externalServerUrl && externalApiKey);
  const enableLocalApi = toBoolean(process.env.DASHBOARD_ENABLE_LOCAL_API, true);
  const bindPublicPort = toBoolean(process.env.DASHBOARD_BIND_PUBLIC_PORT, false);
  const localApiHost = process.env.DASHBOARD_BRIDGE_HOST || "0.0.0.0";
  const localApiPort = bindPublicPort
    ? toNumber(process.env.PORT, 4001)
    : toNumber(process.env.DASHBOARD_BRIDGE_PORT, 4001);

  const moderationCommands = new Set([
    "warn",
    "unwarn",
    "clearwarns",
    "warns",
    "mute",
    "unmute",
    "kick",
    "ban",
    "unban",
    "bans",
    "clearbans",
    "clear",
    "clearall",
  ]);

  const getTotalMessagesStmt =
    rankDb && typeof rankDb.prepare === "function"
      ? rankDb.prepare(
          "SELECT COALESCE(SUM(messages), 0) AS total FROM rank_users"
        )
      : null;

  const state = {
    startedAt: isoNow(),
    lastUpdate: null,
    lastCommandAt: null,
    botStatus: client.isReady() ? "online" : "starting",
    counters: {
      totalCommands: 0,
      commandsByName: {},
    },
    recentActivity: [],
    moderationLogs: [],
    lastSnapshot: {
      primaryServerName: "Unknown Server",
      primaryServerMembers: 0,
      totalServers: 0,
      totalUsers: 0,
      bannedUsers: 0,
      totalMessages: 0,
      botStatus: "starting",
      ping: 0,
      memoryMb: 0,
      cpuUsage: 0,
      modules,
    },
  };

  let snapshotTimeout = null;
  let snapshotInterval = null;
  let httpServer = null;

  function pushLog(target, entry, maxItems = 30) {
    target.unshift(entry);
    if (target.length > maxItems) {
      target.length = maxItems;
    }
  }

  function queueSnapshot(delay = 1200) {
    clearTimeout(snapshotTimeout);
    snapshotTimeout = setTimeout(() => {
      collectAndPublishSnapshot().catch((error) => {
        console.error("Dashboard snapshot error:", error.message);
      });
    }, delay);
  }

  function getPrimaryGuild() {
    return client.guilds.cache.first() || null;
  }

  function getPrimaryServerName() {
    const guild = getPrimaryGuild();
    return guild?.name || "Unknown Server";
  }

  function getPrimaryServerMembers() {
    const guild = getPrimaryGuild();
    return Number(guild?.memberCount || 0);
  }

  function getTotalUsers() {
    return [...client.guilds.cache.values()].reduce((sum, guild) => {
      return sum + Number(guild.memberCount || 0);
    }, 0);
  }

  function getTotalMessages() {
    if (!getTotalMessagesStmt) return 0;
    try {
      return Number(getTotalMessagesStmt.get()?.total || 0);
    } catch {
      return 0;
    }
  }

  async function getBannedUsers() {
    let total = 0;

    for (const guild of client.guilds.cache.values()) {
      try {
        const bans = await guild.bans.fetch();
        total += bans.size;
      } catch {
        total += 0;
      }
    }

    return total;
  }

  function getMemoryMb() {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
  }

  function getCpuUsage() {
    const cpuCount = Math.max(os.cpus().length, 1);
    const load = os.loadavg()[0] / cpuCount;
    return Number((load * 100).toFixed(1));
  }

  function getCommandUsageArray() {
    return Object.entries(state.counters.commandsByName)
      .map(([name, count]) => ({
        name,
        label: `${prefix}${name}`,
        count: Number(count || 0),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }

  function buildDashboardPayload() {
    const snapshot = state.lastSnapshot;
    const commandUsage = getCommandUsageArray();

    return {
      ok: true,
      service: "dashboard-bridge",
      startedAt: state.startedAt,
      lastUpdate: state.lastUpdate,
      snapshot,
      primaryServerName: snapshot.primaryServerName,
      primaryServerMembers: snapshot.primaryServerMembers,
      totalServers: snapshot.totalServers,
      totalUsers: snapshot.totalUsers,
      activeCommands: state.counters.totalCommands,
      bannedUsers: snapshot.bannedUsers,
      totalMessages: snapshot.totalMessages,
      botStatus: snapshot.botStatus,
      ping: snapshot.ping,
      memoryMb: snapshot.memoryMb,
      cpuUsage: snapshot.cpuUsage,
      modules: snapshot.modules,
      stats: {
        totalServers: snapshot.totalServers,
        totalUsers: snapshot.totalUsers,
        activeCommands: state.counters.totalCommands,
        bannedUsers: snapshot.bannedUsers,
        totalMessages: snapshot.totalMessages,
      },
      serverOverview: {
        serverName: snapshot.primaryServerName,
        members: snapshot.primaryServerMembers,
        realtimeStatus: snapshot.botStatus,
      },
      botControls: snapshot.modules,
      botStatusInfo: {
        status: snapshot.botStatus,
        lastUpdate: state.lastUpdate,
        ping: snapshot.ping,
        memoryMb: snapshot.memoryMb,
        cpuUsage: snapshot.cpuUsage,
      },
      commandUsage,
      recentActivity: state.recentActivity,
      moderationLogs: state.moderationLogs,
    };
  }

  async function pushExternalSnapshot(snapshot) {
    if (!enableExternalPush) return;

    await postJson(
      `${externalServerUrl}/api/ingest/snapshot`,
      snapshot,
      externalApiKey
    );
  }

  async function pushExternalEvent(type, payload) {
    if (!enableExternalPush) return;

    await postJson(
      `${externalServerUrl}/api/ingest/event`,
      {
        type,
        ...payload,
      },
      externalApiKey
    );
  }

  async function collectSnapshot() {
    return {
      primaryServerName: getPrimaryServerName(),
      primaryServerMembers: getPrimaryServerMembers(),
      totalServers: client.guilds.cache.size,
      totalUsers: getTotalUsers(),
      bannedUsers: await getBannedUsers(),
      totalMessages: getTotalMessages(),
      botStatus: client.isReady() ? "online" : "starting",
      ping: Math.round(client.ws.ping || 0),
      memoryMb: getMemoryMb(),
      cpuUsage: getCpuUsage(),
      modules,
    };
  }

  async function collectAndPublishSnapshot() {
    if (!client.isReady()) return;

    const snapshot = await collectSnapshot();
    state.lastSnapshot = snapshot;
    state.lastUpdate = isoNow();
    state.botStatus = snapshot.botStatus;

    try {
      await pushExternalSnapshot(snapshot);
    } catch (error) {
      console.error("Dashboard external snapshot error:", error.message);
    }
  }

  function startLocalApiServer() {
    if (!enableLocalApi) {
      console.log("Dashboard local API disabled.");
      return;
    }

    if (httpServer) return;

    httpServer = http.createServer(async (request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, x-dashboard-key"
      );

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const requestUrl = new URL(
        request.url || "/",
        `http://${request.headers.host || "localhost"}`
      );

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const payload = {
          ok: true,
          service: "dashboard-bridge",
          botReady: client.isReady(),
          botStatus: state.lastSnapshot.botStatus,
          lastUpdate: state.lastUpdate,
          mode: {
            localApi: enableLocalApi,
            externalPush: enableExternalPush,
            publicPortBinding: bindPublicPort,
          },
        };

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }

      if (
        request.method === "GET" &&
        (requestUrl.pathname === "/api/dashboard" ||
          requestUrl.pathname === "/api/dashboard/refresh")
      ) {
        await collectAndPublishSnapshot().catch(() => {});
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(buildDashboardPayload()));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            service: "dashboard-bridge",
            endpoints: ["/health", "/api/dashboard", "/api/dashboard/refresh"],
          })
        );
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Not found" }));
    });

    httpServer.on("error", (error) => {
      console.error(
        `Dashboard local API failed on ${localApiHost}:${localApiPort}:`,
        error.message
      );
    });

    httpServer.listen(localApiPort, localApiHost, () => {
      console.log(
        `Dashboard local API listening on http://${localApiHost}:${localApiPort}`
      );

      if (bindPublicPort) {
        console.log(
          "Dashboard bridge is bound to the public PORT. Do not run another public HTTP server on the same port."
        );
      }
    });
  }

  client.on("clientReady", () => {
    state.botStatus = "online";

    pushLog(state.recentActivity, {
      type: "system",
      message: `Bot connected as ${client.user.tag}`,
      timestamp: isoNow(),
    });

    pushExternalEvent("system", {
      message: `Bot connected as ${client.user.tag}`,
    }).catch((error) => {
      console.error("Dashboard ready event error:", error.message);
    });

    startLocalApiServer();
    queueSnapshot(2000);

    if (snapshotInterval) {
      clearInterval(snapshotInterval);
    }

    snapshotInterval = setInterval(() => {
      collectAndPublishSnapshot().catch((error) => {
        console.error("Dashboard interval snapshot error:", error.message);
      });
    }, 10000);
  });

  client.on("guildCreate", () => {
    queueSnapshot(1000);
  });

  client.on("guildDelete", () => {
    queueSnapshot(1000);
  });

  client.on("guildMemberAdd", (member) => {
    pushLog(state.recentActivity, {
      type: "member",
      message: `${member.user.tag} joined ${member.guild.name}`,
      timestamp: isoNow(),
    });

    queueSnapshot(1000);
  });

  client.on("guildMemberRemove", (member) => {
    pushLog(state.recentActivity, {
      type: "member",
      message: `${member.user.tag} left ${member.guild.name}`,
      timestamp: isoNow(),
    });

    queueSnapshot(1000);
  });

  client.on("guildBanAdd", (ban) => {
    const entry = {
      type: "moderation",
      message: `${ban.user.tag} was banned in ${ban.guild.name}`,
      timestamp: isoNow(),
    };

    pushLog(state.moderationLogs, entry);
    pushLog(state.recentActivity, entry);

    pushExternalEvent("moderation", {
      message: entry.message,
    }).catch((error) => {
      console.error("Dashboard ban event error:", error.message);
    });

    queueSnapshot(1200);
  });

  client.on("guildBanRemove", (ban) => {
    const entry = {
      type: "moderation",
      message: `${ban.user.tag} was unbanned in ${ban.guild.name}`,
      timestamp: isoNow(),
    };

    pushLog(state.moderationLogs, entry);
    pushLog(state.recentActivity, entry);

    pushExternalEvent("moderation", {
      message: entry.message,
    }).catch((error) => {
      console.error("Dashboard unban event error:", error.message);
    });

    queueSnapshot(1200);
  });

  client.on("messageCreate", (message) => {
    if (!message.guild || message.author.bot) return;

    const content = String(message.content || "").trim();

    if (!content.startsWith(prefix)) {
      queueSnapshot(1200);
      return;
    }

    const commandName =
      content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase() ||
      "unknown";

    state.counters.totalCommands += 1;
    state.counters.commandsByName[commandName] =
      Number(state.counters.commandsByName[commandName] || 0) + 1;
    state.lastCommandAt = isoNow();

    const entry = {
      type: "command",
      commandName,
      message: `${message.author.tag} used ${prefix}${commandName}`,
      timestamp: isoNow(),
    };

    pushLog(state.recentActivity, entry);

    pushExternalEvent("command", {
      commandName,
      message: entry.message,
    }).catch((error) => {
      console.error("Dashboard command event error:", error.message);
    });

    if (moderationCommands.has(commandName)) {
      const moderationEntry = {
        type: "moderation",
        message: `${message.author.tag} executed ${prefix}${commandName}`,
        timestamp: isoNow(),
      };

      pushLog(state.moderationLogs, moderationEntry);

      pushExternalEvent("moderation", {
        message: moderationEntry.message,
      }).catch((error) => {
        console.error("Dashboard moderation event error:", error.message);
      });
    }

    queueSnapshot(1200);
  });

  console.log(
    `Dashboard bridge initialized. Local API=${enableLocalApi ? "on" : "off"}, external push=${enableExternalPush ? "on" : "off"}`
  );
}

module.exports = {
  attachDashboardBridge,
};
