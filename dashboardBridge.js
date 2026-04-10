const os = require("os");
const http = require("http");
const https = require("https");

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
            "x-dashboard-key": apiKey,
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
  const serverUrl = process.env.DASHBOARD_SERVER_URL;
  const apiKey = process.env.DASHBOARD_API_KEY;

  if (!serverUrl || !apiKey) {
    console.warn(
      "Dashboard bridge disabled: missing DASHBOARD_SERVER_URL or DASHBOARD_API_KEY"
    );
    return;
  }

  const prefix = options.prefix || "!";
  const rankDb = options.rankDb || null;
  const modules = {
    welcomeMessages: Boolean(options.modules?.welcomeMessages),
    autoModeration: Boolean(options.modules?.autoModeration),
    musicModule: Boolean(options.modules?.musicModule),
    antiSpamFilter: Boolean(options.modules?.antiSpamFilter),
  };

  const moderationCommands = new Set([
    "warn",
    "unwarn",
    "clearwarns",
    "warns",
    "mute",
    "unmute",
    "kick",
    "clear",
    "clearall",
  ]);

  const getTotalMessagesStmt =
    rankDb && typeof rankDb.prepare === "function"
      ? rankDb.prepare("SELECT COALESCE(SUM(messages), 0) AS total FROM rank_users")
      : null;

  let snapshotTimeout = null;
  let snapshotInterval = null;

  function queueSnapshot(delay = 1200) {
    clearTimeout(snapshotTimeout);
    snapshotTimeout = setTimeout(() => {
      sendSnapshot().catch((error) => {
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

  async function sendSnapshot() {
    if (!client.isReady()) return;

    const payload = {
      primaryServerName: getPrimaryServerName(),
      primaryServerMembers: getPrimaryServerMembers(),
      totalServers: client.guilds.cache.size,
      totalUsers: getTotalUsers(),
      bannedUsers: await getBannedUsers(),
      totalMessages: getTotalMessages(),
      botStatus: "online",
      ping: Math.round(client.ws.ping || 0),
      memoryMb: getMemoryMb(),
      cpuUsage: getCpuUsage(),
      modules,
    };

    await postJson(`${serverUrl}/api/ingest/snapshot`, payload, apiKey);
  }

  async function sendEvent(type, payload) {
    await postJson(
      `${serverUrl}/api/ingest/event`,
      {
        type,
        ...payload,
      },
      apiKey
    );
  }

  client.on("clientReady", () => {
    sendEvent("system", {
      message: `Bot connected as ${client.user.tag}`,
    }).catch((error) => {
      console.error("Dashboard ready event error:", error.message);
    });

    queueSnapshot(2000);

    if (snapshotInterval) {
      clearInterval(snapshotInterval);
    }

    snapshotInterval = setInterval(() => {
      sendSnapshot().catch((error) => {
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

  client.on("guildMemberAdd", () => {
    queueSnapshot(1000);
  });

  client.on("guildMemberRemove", () => {
    queueSnapshot(1000);
  });

  client.on("guildBanAdd", (ban) => {
    sendEvent("moderation", {
      message: `${ban.user.tag} was banned in ${ban.guild.name}`,
    }).catch((error) => {
      console.error("Dashboard ban event error:", error.message);
    });

    queueSnapshot(1200);
  });

  client.on("guildBanRemove", (ban) => {
    sendEvent("moderation", {
      message: `${ban.user.tag} was unbanned in ${ban.guild.name}`,
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

    sendEvent("command", {
      commandName,
      message: `${message.author.tag} used ${prefix}${commandName}`,
    }).catch((error) => {
      console.error("Dashboard command event error:", error.message);
    });

    if (moderationCommands.has(commandName)) {
      sendEvent("moderation", {
        message: `${message.author.tag} executed ${prefix}${commandName}`,
      }).catch((error) => {
        console.error("Dashboard moderation event error:", error.message);
      });
    }

    queueSnapshot(1200);
  });
}

module.exports = {
  attachDashboardBridge,
};