const http = require("http");
const { EmbedBuilder, ChannelType } = require("discord.js");

const FORMS_RELAY_ENABLED =
  String(process.env.FORMS_RELAY_ENABLED || "true").toLowerCase() === "true";

const FORMS_RELAY_HOST = process.env.FORMS_RELAY_HOST || "0.0.0.0";
const FORMS_RELAY_PORT = Number(
  process.env.PORT || process.env.FORMS_RELAY_PORT || 3210
);
const FORMS_RELAY_SECRET = String(process.env.FORMS_RELAY_SECRET || "").trim();

const IDEAS_CHANNEL_ID = String(
  process.env.IDEAS_CHANNEL_ID || "1490720997635133520"
).trim();

const IDEAS_MENTION_IDS = String(
  process.env.IDEAS_MENTION_IDS || "941764578772144229,650035853590003722"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const MAX_BODY_BYTES = 256 * 1024;
const RECENT_REQUEST_TTL_MS = 60_000;

const recentFingerprints = new Map();
let relayServer = null;

function cleanupRecentFingerprints() {
  const now = Date.now();

  for (const [fingerprint, createdAt] of recentFingerprints.entries()) {
    if (now - createdAt > RECENT_REQUEST_TTL_MS) {
      recentFingerprints.delete(fingerprint);
    }
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
}

function buildMentionText() {
  return IDEAS_MENTION_IDS.map((id) => `<@${id}>`).join(" ");
}

function buildAllowedMentions() {
  return {
    parse: [],
    users: IDEAS_MENTION_IDS,
  };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
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
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });

  res.end(JSON.stringify(payload));
}

function buildFingerprint(payload) {
  return [
    normalizeText(payload.name).toLowerCase(),
    normalizeText(payload.nickname).toLowerCase(),
    normalizeText(payload.idea).toLowerCase(),
  ].join("::");
}

function validatePayload(payload) {
  const name = normalizeText(payload.name);
  const nickname = normalizeText(payload.nickname);
  const idea = normalizeText(payload.idea);
  const submittedAt =
    normalizeText(payload.submittedAt) || new Date().toISOString();

  if (!name) {
    throw new Error('Missing "name"');
  }

  if (!nickname) {
    throw new Error('Missing "nickname"');
  }

  if (!idea) {
    throw new Error('Missing "idea"');
  }

  return {
    name,
    nickname,
    idea,
    submittedAt,
  };
}

async function resolveIdeasChannel(client) {
  if (!IDEAS_CHANNEL_ID) {
    throw new Error("IDEAS_CHANNEL_ID is not configured");
  }

  const cached = client.channels.cache.get(IDEAS_CHANNEL_ID);
  if (cached) return cached;

  const fetched = await client.channels.fetch(IDEAS_CHANNEL_ID).catch(() => null);
  if (!fetched) {
    throw new Error(`Channel ${IDEAS_CHANNEL_ID} was not found`);
  }

  return fetched;
}

function formatSubmittedAt(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Не указано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function buildIdeaEmbed(payload, channel) {
  const guildIconUrl =
    channel && channel.guild
      ? channel.guild.iconURL({ extension: "png", size: 256 })
      : null;

  const embed = new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle("💡 Новая идея")
    .addFields(
      {
        name: "Имя",
        value: truncateText(payload.name, 1024),
        inline: false,
      },
      {
        name: "Никнейм",
        value: truncateText(payload.nickname, 1024),
        inline: false,
      },
      {
        name: "Идея",
        value: truncateText(payload.idea, 1024),
        inline: false,
      },
      {
        name: "Время",
        value: formatSubmittedAt(payload.submittedAt),
        inline: false,
      }
    )
    .setFooter({
      text: "StreetLife RP",
    })
    .setTimestamp(new Date(payload.submittedAt));

  if (guildIconUrl) {
    embed.setThumbnail(guildIconUrl);
  }

  return embed;
}

async function deliverIdeaToDiscord(client, payload) {
  if (!client || typeof client.isReady !== "function" || !client.isReady()) {
    throw new Error("Discord client is not ready yet");
  }

  const channel = await resolveIdeasChannel(client);

  if (channel.type !== ChannelType.GuildText) {
    throw new Error("Configured ideas channel is not a text channel");
  }

  const embed = buildIdeaEmbed(payload, channel);
  const mentionText = buildMentionText();

  await channel.send({
    content: mentionText || undefined,
    embeds: [embed],
    allowedMentions: buildAllowedMentions(),
  });
}

function isAuthorized(req, payload) {
  if (!FORMS_RELAY_SECRET) {
    return true;
  }

  const headerSecret = String(req.headers["x-forms-secret"] || "").trim();
  const bodySecret = String(payload.secret || "").trim();

  return (
    headerSecret === FORMS_RELAY_SECRET || bodySecret === FORMS_RELAY_SECRET
  );
}

function startFormsRelay(client) {
  if (!FORMS_RELAY_ENABLED) {
    console.log("[forms-relay] disabled by FORMS_RELAY_ENABLED=false");
    return null;
  }

  if (relayServer) {
    console.log("[forms-relay] server already started");
    return relayServer;
  }

  relayServer = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, {
          ok: true,
          service: "forms-relay",
          discordReady:
            client && typeof client.isReady === "function"
              ? client.isReady()
              : false,
        });
        return;
      }

      if (req.method !== "POST" || req.url !== "/forms/idea") {
        sendJson(res, 404, { ok: false, error: "Not found" });
        return;
      }

      const rawPayload = await parseJsonBody(req);

      if (!isAuthorized(req, rawPayload)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const payload = validatePayload(rawPayload);

      cleanupRecentFingerprints();

      const fingerprint = buildFingerprint(payload);
      if (recentFingerprints.has(fingerprint)) {
        sendJson(res, 200, { ok: true, duplicate: true });
        return;
      }

      await deliverIdeaToDiscord(client, payload);
      recentFingerprints.set(fingerprint, Date.now());

      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error("[forms-relay] request failed:", error);

      sendJson(res, 500, {
        ok: false,
        error: error && error.message ? error.message : "Unknown server error",
      });
    }
  });

  relayServer.listen(FORMS_RELAY_PORT, FORMS_RELAY_HOST, () => {
    console.log(
      `[forms-relay] listening on http://${FORMS_RELAY_HOST}:${FORMS_RELAY_PORT}`
    );
  });

  return relayServer;
}

module.exports = {
  startFormsRelay,
};
