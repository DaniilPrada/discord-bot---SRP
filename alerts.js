const { EmbedBuilder, ChannelType } = require("discord.js");
const cheerio = require("cheerio");

const ALERTS_CHECK_INTERVAL_MS = 5000;
const ALERTS_CHANNEL_KEYWORD = "alerts";
const ENABLE_ALERTS_LOOP = true;

// Mentions
const ISRAEL_ALERT_MENTION = "<@941764578772144229>";
const UKRAINE_ALERT_MENTION = "<@1035868648063127582>";

// Allow only these areas if needed. Leave empty for all.
const ISRAEL_ALLOWED_AREAS = [];
const UKRAINE_ALLOWED_AREAS = [];

// Sources
const ISRAEL_ALERTS_URL = "https://api.tzevaadom.co.il/notifications";
const UKRAINE_ALARMMAP_URL = "https://alarmmap.online/air/";

// Prevent duplicate sends while the bot is running
const sentAlertIds = new Set();
const sentAlertOrder = [];
const MAX_SENT_ALERT_IDS = 3000;

// Small cache helpers for If-Modified-Since
let israelLastModified = null;

// Prevent overlapping checks
let isCheckingAlerts = false;
let alertsLoopStarted = false;

// Active alerts snapshot for start/end detection
const activeAlertsSnapshot = new Map();

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(arr) {
  return [...new Set((arr || []).map((v) => normalizeText(v)).filter(Boolean))];
}

function rememberSentAlertId(alertId) {
  if (!alertId) return;
  if (sentAlertIds.has(alertId)) return;

  sentAlertIds.add(alertId);
  sentAlertOrder.push(alertId);

  while (sentAlertOrder.length > MAX_SENT_ALERT_IDS) {
    const oldestId = sentAlertOrder.shift();
    if (oldestId) {
      sentAlertIds.delete(oldestId);
    }
  }
}

function getAlertsChannel(guild) {
  if (!guild) return null;

  return (
    guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        ch.name.toLowerCase().includes(ALERTS_CHANNEL_KEYWORD)
    ) || null
  );
}

function filterAreasByAllowlist(areas, allowlist) {
  const cleanAreas = uniqueStrings(areas);

  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return cleanAreas;
  }

  const normalizedAllowlist = allowlist.map((x) => normalizeText(x).toLowerCase());

  return cleanAreas.filter((area) =>
    normalizedAllowlist.includes(normalizeText(area).toLowerCase())
  );
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function resolveIsraelAlertType(item) {
  const values = [
    item?.title,
    item?.category,
    item?.alertType,
    item?.type,
    item?.threat,
    item?.notificationType,
    item?.event,
    item?.desc,
  ]
    .map((v) => normalizeText(v))
    .filter(Boolean);

  const joined = values.join(" | ");
  const text = lowerText(joined);

  if (!text) {
    return "Цева Адом";
  }

  if (
    text.includes("חדירת כלי טיס עוין") ||
    text.includes("כלי טיס עוין") ||
    text.includes("uav") ||
    text.includes("drone")
  ) {
    return "Проникновение вражеского БПЛА";
  }

  if (
    text.includes("חדירת מחבלים") ||
    text.includes("חדירה") ||
    text.includes("infiltration")
  ) {
    return "Проникновение террористов";
  }

  if (
    text.includes("ירי רקטות וטילים") ||
    text.includes("רקטות") ||
    text.includes("טילים") ||
    text.includes("rocket") ||
    text.includes("missile")
  ) {
    return "Ракетный обстрел";
  }

  if (
    text.includes("רעידת אדמה") ||
    text.includes("earthquake")
  ) {
    return "Землетрясение";
  }

  if (
    text.includes("צונאמי") ||
    text.includes("tsunami")
  ) {
    return "Цунами";
  }

  if (
    text.includes("חומרים מסוכנים") ||
    text.includes("hazardous") ||
    text.includes("chemical")
  ) {
    return "Опасные материалы";
  }

  if (
    text.includes("ירי") ||
    text.includes("צבע אדום") ||
    text.includes("tzeva adom") ||
    text.includes("red alert")
  ) {
    return "Цева Адом";
  }

  return joined || "Цева Адом";
}

// ======================================
// ISRAEL AREA CLEANUP - HEBREW ONLY
// ======================================

const HEBREW_BLOCKED_EXACT = new Set([
  "דן",
  "קו העימות",
  "המפרץ",
  "כרמל",
  "העמקים",
  "גליל עליון",
  "גליל תחתון",
  "גליל מרכזי",
  "מרכז הגליל",
  "דרום הגולן",
  "בקעה",
  "שפלה",
  "השפלה",
  "לכיש",
  "ירקון",
  "מנשה",
  "יהודה",
  "שומרון",
  "שרון",
  "גוש דן",
  "מרכז",
  "נגב",
  "אזור",
  "יעד",
]);

const HEBREW_BLOCKED_PREFIXES = [
  "אזור תעשייה",
  "איזור תעשייה",
  "בית עלמין",
  "כלא",
  "מרכז אזורי",
  "קו העימות",
  "מתחם",
  "פארק תעשייה",
  "מכללת",
  "בסיס",
  "מחנה",
  "תחנת רכבת",
  "מסוף",
  "קריית חינוך",
];

function looksLikeTime(value) {
  return /^\d{1,2}:\d{2}:\d{2}$/.test(normalizeText(value));
}

function startsWithAny(value, prefixes) {
  const cleanValue = normalizeText(value).toLowerCase();
  return prefixes.some((prefix) =>
    cleanValue.startsWith(normalizeText(prefix).toLowerCase())
  );
}

function isBlockedHebrewArea(value) {
  const cleanValue = normalizeText(value);

  if (!cleanValue) return true;
  if (looksLikeTime(cleanValue)) return true;
  if (cleanValue.includes("צבע אדום")) return true;
  if (cleanValue.includes("התרעה")) return true;
  if (HEBREW_BLOCKED_EXACT.has(cleanValue)) return true;
  if (startsWithAny(cleanValue, HEBREW_BLOCKED_PREFIXES)) return true;

  return false;
}

function cleanIsraelAreas(areas) {
  return uniqueStrings(
    (areas || [])
      .map((area) => normalizeText(area))
      .filter(Boolean)
      .filter((area) => !isBlockedHebrewArea(area))
      .filter((area) => !/^#+$/.test(area))
      .filter((area) => area.length > 1)
  );
}

function buildAreasText(areas) {
  const safeAreas = Array.isArray(areas) ? uniqueStrings(areas).filter(Boolean) : [];
  const areaCount = safeAreas.length;

  if (areaCount === 0) {
    return {
      areaCount: 0,
      areasText: "Нет данных",
      fieldName: "Населённые пункты:",
    };
  }

  const areasText = safeAreas.map((area, index) => `${index + 1}. ${area}`).join("\n");

  const fieldName =
    areaCount === 1
      ? "Населённый пункт:"
      : areaCount < 5
        ? "Населённые пункты:"
        : "Список населённых пунктов:";

  return {
    areaCount,
    areasText,
    fieldName,
  };
}

function buildStartAlertEmbed(country, alertType, areas, footerIconURL = null) {
  const safeCountry = country || "Неизвестно";
  const safeType = alertType || "Тревога";
  const normalizedCountry = normalizeText(safeCountry).toLowerCase();

  const countryFlag =
    normalizedCountry === "израиль"
      ? "🇮🇱"
      : normalizedCountry === "украина"
        ? "🇺🇦"
        : "🌍";

  const { areaCount, areasText, fieldName } = buildAreasText(areas);

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(`${countryFlag} Система оповещения`)
    .setDescription(`## ${safeType}`)
    .addFields(
      {
        name: "Страна:",
        value: safeCountry,
        inline: true,
      },
      {
        name: "Количество населённых пунктов:",
        value: String(areaCount),
        inline: true,
      },
      {
        name: fieldName,
        value: "```" + areasText.slice(0, 1000) + "```",
      },
      {
        name: "Инструкция:",
        value: "Немедленно пройдите в укрытие и оставайтесь там до дальнейших указаний.",
      }
    )
    .setFooter({
      text: `Automated Alerts System • ${new Date().toLocaleString("ru-RU")}`,
      iconURL: footerIconURL || undefined,
    })
    .setTimestamp();
}

function buildEndAlertEmbed(country, alertType, areas, footerIconURL = null) {
  const safeCountry = country || "Неизвестно";
  const safeType = alertType || "Отбой тревоги";
  const normalizedCountry = normalizeText(safeCountry).toLowerCase();

  const countryFlag =
    normalizedCountry === "израиль"
      ? "🇮🇱"
      : normalizedCountry === "украина"
        ? "🇺🇦"
        : "🌍";

  const { areaCount, areasText, fieldName } = buildAreasText(areas);

  return new EmbedBuilder()
    .setColor(0x00c853)
    .setTitle(`${countryFlag} Система оповещения`)
    .setDescription(`## ✅ Отбой события: ${safeType}`)
    .addFields(
      {
        name: "Страна:",
        value: safeCountry,
        inline: true,
      },
      {
        name: "Количество населённых пунктов:",
        value: String(areaCount),
        inline: true,
      },
      {
        name: fieldName,
        value: "```" + areasText.slice(0, 1000) + "```",
      },
      {
        name: "Статус:",
        value: "Опасность по данному событию завершена.",
      }
    )
    .setFooter({
      text: `Automated Alerts System • ${new Date().toLocaleString("ru-RU")}`,
      iconURL: footerIconURL || undefined,
    })
    .setTimestamp();
}

function getMentionForCountry(country) {
  const normalized = normalizeText(country).toLowerCase();

  if (normalized === "израиль") {
    return ISRAEL_ALERT_MENTION;
  }

  if (normalized === "украина") {
    return UKRAINE_ALERT_MENTION;
  }

  return "";
}

async function safeJsonFetch(url, options = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "StreetLifeBot/1.0",
      Accept: "application/json, text/plain, */*",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 304) {
    return { notModified: true, data: null, lastModified: null };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} for ${url} :: ${text.slice(0, 200)}`);
  }

  const lastModified = response.headers.get("last-modified");
  const data = await response.json();

  return {
    notModified: false,
    data,
    lastModified,
  };
}

async function safeTextFetch(url, options = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,uk;q=0.8,ru;q=0.7",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} for ${url} :: ${text.slice(0, 200)}`);
  }

  return response.text();
}

function buildSnapshotKey(country, type, areas) {
  const cleanAreas = uniqueStrings(areas).sort((a, b) => a.localeCompare(b, "he"));
  return [
    normalizeText(country).toLowerCase(),
    normalizeText(type).toLowerCase(),
    cleanAreas.join("|").toLowerCase(),
  ].join("::");
}

// =============================
// ISRAEL
// =============================
async function fetchIsraelAlerts() {
  try {
    const result = await safeJsonFetch(ISRAEL_ALERTS_URL, {
      headers: israelLastModified
        ? {
            "If-Modified-Since": israelLastModified,
            Referer: "https://www.tzevaadom.co.il/",
          }
        : {
            Referer: "https://www.tzevaadom.co.il/",
          },
    });

    if (result.notModified) {
      return [];
    }

    if (result.lastModified) {
      israelLastModified = result.lastModified;
    }

    const data = result.data;

    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    const alerts = [];

    for (const item of data) {
      if (!item) continue;

      if (typeof item === "string") {
        const filteredAreas = filterAreasByAllowlist([item], ISRAEL_ALLOWED_AREAS);
        const cleanedAreas = cleanIsraelAreas(filteredAreas);

        if (cleanedAreas.length === 0) continue;

        const type = "Цева Адом";

        alerts.push({
          id: `israel::${type}::${cleanedAreas.join("|")}`,
          snapshotKey: buildSnapshotKey("Израиль", type, cleanedAreas),
          country: "Израиль",
          type,
          areas: cleanedAreas,
        });

        continue;
      }

      const type = resolveIsraelAlertType(item);

      const rawAreas = uniqueStrings(
        item.cities ||
          item.areas ||
          item.data ||
          item.locations ||
          item.area_names ||
          item.citiesNames ||
          item.cityNames ||
          (item.city ? [item.city] : [])
      );

      const filteredAreas = filterAreasByAllowlist(rawAreas, ISRAEL_ALLOWED_AREAS);
      const cleanedAreas = cleanIsraelAreas(filteredAreas);

      if (cleanedAreas.length === 0) continue;

      const snapshotKey = buildSnapshotKey("Израиль", type, cleanedAreas);

      alerts.push({
        id:
          normalizeText(item.id) ||
          `israel::${type}::${cleanedAreas.join("|")}::${normalizeText(
            item.time || item.timestamp || item.date || ""
          )}`,
        snapshotKey,
        country: "Израиль",
        type,
        areas: cleanedAreas,
      });
    }

    return alerts;
  } catch (err) {
    console.error("fetchIsraelAlerts error:", err.message);
    return [];
  }
}

// =============================
// UKRAINE - alarmmap.online scraper
// =============================
function parseUkraineAlarmMapHtml(html) {
  const $ = cheerio.load(html);
  const pageText = $("body").text();
  const lines = pageText
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const alerts = [];
  const invalidPrefixes = [
    "Карта",
    "Служба",
    "Версія",
    "Перелік",
    "Дотримуйтесь",
    "Leaflet",
    "Mapbox",
    "global.loading_map",
    "Отримуємо",
    "Повітряна тривога в Україні",
    "Air raid alert map of Ukraine",
  ];

  for (let i = 0; i < lines.length - 2; i += 1) {
    const regionName = lines[i];
    const alertType = lines[i + 1];
    const announcedLine = lines[i + 2];

    const isAnnouncedLine =
      announcedLine.toLowerCase().startsWith("announced at:") ||
      announcedLine.toLowerCase().startsWith("оголошено в:");

    if (!isAnnouncedLine) {
      continue;
    }

    if (invalidPrefixes.some((prefix) => regionName.startsWith(prefix))) {
      continue;
    }

    const announcedAt = normalizeText(announcedLine.split(":").slice(1).join(":"));

    alerts.push({
      id: `ukraine::${alertType}::${regionName}::${announcedAt}`,
      snapshotKey: buildSnapshotKey("Украина", normalizeText(alertType || "Воздушная тревога"), [regionName]),
      country: "Украина",
      type: normalizeText(alertType || "Воздушная тревога"),
      areas: [regionName],
      announcedAt,
    });
  }

  const deduped = [];
  const seen = new Set();

  for (const alert of alerts) {
    if (seen.has(alert.snapshotKey)) continue;
    seen.add(alert.snapshotKey);
    deduped.push(alert);
  }

  return deduped;
}

async function fetchUkraineAlerts() {
  try {
    const html = await safeTextFetch(UKRAINE_ALARMMAP_URL, {
      headers: {
        Referer: "https://alarmmap.online/",
      },
    });

    console.log("[ukraine] html length:", html.length);

    const parsedAlerts = parseUkraineAlarmMapHtml(html);

    console.log("[ukraine] parsed alerts count:", parsedAlerts.length);

    if (!Array.isArray(parsedAlerts) || parsedAlerts.length === 0) {
      console.log("[ukraine] no alerts parsed from html");
      return [];
    }

    const normalizedAlerts = [];

    for (const item of parsedAlerts) {
      const filteredAreas = filterAreasByAllowlist(
        item.areas || [],
        UKRAINE_ALLOWED_AREAS
      );

      if (filteredAreas.length === 0) {
        continue;
      }

      normalizedAlerts.push({
        id:
          item.id ||
          `ukraine::${item.type || "air-raid"}::${filteredAreas.join("|")}`,
        snapshotKey:
          item.snapshotKey ||
          buildSnapshotKey("Украина", item.type || "Воздушная тревога", filteredAreas),
        country: "Украина",
        type: normalizeText(item.type || "Воздушная тревога"),
        areas: uniqueStrings(filteredAreas),
      });
    }

    console.log("[ukraine] normalized alerts count:", normalizedAlerts.length);

    return normalizedAlerts;
  } catch (err) {
    console.error("fetchUkraineAlerts error:", err.message);
    return [];
  }
}

async function fetchAllAlerts() {
  const [israelAlerts, ukraineAlerts] = await Promise.all([
    fetchIsraelAlerts(),
    fetchUkraineAlerts(),
  ]);

  console.log(
    `[alerts] fetched -> israel=${israelAlerts.length}, ukraine=${ukraineAlerts.length}`
  );

  return [...israelAlerts, ...ukraineAlerts];
}

function buildCurrentSnapshotMap(alerts) {
  const map = new Map();

  for (const alert of alerts || []) {
    if (!alert?.snapshotKey) continue;

    map.set(alert.snapshotKey, {
      snapshotKey: alert.snapshotKey,
      country: alert.country,
      type: alert.type,
      areas: uniqueStrings(alert.areas || []),
    });
  }

  return map;
}

function getStartedAlerts(previousMap, currentMap) {
  const started = [];

  for (const [key, alert] of currentMap.entries()) {
    if (!previousMap.has(key)) {
      started.push(alert);
    }
  }

  return started;
}

function getEndedAlerts(previousMap, currentMap) {
  const ended = [];

  for (const [key, alert] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      ended.push(alert);
    }
  }

  return ended;
}

async function sendStartedAlertToGuild(guild, alert, footerIconURL) {
  const alertsChannel = getAlertsChannel(guild);
  if (!alertsChannel) return;

  const mentionText = getMentionForCountry(alert.country);
  const sendId = `start::${alert.snapshotKey}`;

  if (sentAlertIds.has(sendId)) {
    return;
  }

  const embed = buildStartAlertEmbed(
    alert.country,
    alert.type,
    alert.areas,
    footerIconURL
  );

  await alertsChannel.send({
    content: mentionText || undefined,
    embeds: [embed],
  });

  rememberSentAlertId(sendId);

  console.log(
    `[alerts] START sent ${alert.country} ${alert.type} -> ${alert.areas.join(", ")} in guild ${guild.id}`
  );
}

async function sendEndedAlertToGuild(guild, alert, footerIconURL) {
  const alertsChannel = getAlertsChannel(guild);
  if (!alertsChannel) return;

  const embed = buildEndAlertEmbed(
    alert.country,
    alert.type,
    alert.areas,
    footerIconURL
  );

  await alertsChannel.send({
    embeds: [embed],
  });

  console.log(
    `[alerts] END sent ${alert.country} ${alert.type} -> ${alert.areas.join(", ")} in guild ${guild.id}`
  );
}

async function checkAndSendAlerts(client) {
  if (isCheckingAlerts) {
    console.log("[alerts] skipped: previous check still running");
    return;
  }

  isCheckingAlerts = true;

  try {
    const alerts = await fetchAllAlerts();
    const currentSnapshot = buildCurrentSnapshotMap(alerts);

    const startedAlerts = getStartedAlerts(activeAlertsSnapshot, currentSnapshot);
    const endedAlerts = getEndedAlerts(activeAlertsSnapshot, currentSnapshot);

    console.log(
      `[alerts] state diff -> started=${startedAlerts.length}, ended=${endedAlerts.length}, active=${currentSnapshot.size}`
    );

    for (const guild of client.guilds.cache.values()) {
      const alertsChannel = getAlertsChannel(guild);
      if (!alertsChannel) continue;

      const footerIconURL = guild.iconURL({ extension: "png", size: 128 });

      for (const alert of startedAlerts) {
        try {
          await sendStartedAlertToGuild(guild, alert, footerIconURL);
        } catch (err) {
          console.error("Failed to send START alert message:", err);
        }
      }

      for (const alert of endedAlerts) {
        try {
          await sendEndedAlertToGuild(guild, alert, footerIconURL);
        } catch (err) {
          console.error("Failed to send END alert message:", err);
        }
      }
    }

    activeAlertsSnapshot.clear();
    for (const [key, value] of currentSnapshot.entries()) {
      activeAlertsSnapshot.set(key, value);
    }
  } catch (err) {
    console.error("checkAndSendAlerts error:", err);
  } finally {
    isCheckingAlerts = false;
  }
}

function startAlertsLoop(client) {
  if (!ENABLE_ALERTS_LOOP) return;
  if (alertsLoopStarted) {
    console.log("[alerts] loop already started");
    return;
  }

  alertsLoopStarted = true;

  console.log(`[alerts] loop started, interval=${ALERTS_CHECK_INTERVAL_MS}ms`);

  checkAndSendAlerts(client).catch((err) => {
    console.error("Initial alert loop error:", err);
  });

  setInterval(() => {
    checkAndSendAlerts(client).catch((err) => {
      console.error("Alert loop error:", err);
    });
  }, ALERTS_CHECK_INTERVAL_MS);
}

async function sendTestAlert(message, country = "Израиль") {
  const isUkraine = country.toLowerCase() === "украина";
  const footerIconURL = message.guild?.iconURL({ extension: "png", size: 128 });

  const embed = isUkraine
    ? buildStartAlertEmbed(
        "Украина",
        "Воздушная тревога",
        ["Киев", "Харьков", "Одесса"],
        footerIconURL
      )
    : buildStartAlertEmbed(
        "Израиль",
        "Ракетный обстрел",
        ["אשקלון", "אשדוד", "שדרות"],
        footerIconURL
      );

  await message.channel.send({
    content: isUkraine ? UKRAINE_ALERT_MENTION : ISRAEL_ALERT_MENTION,
    embeds: [embed],
  });
}

async function sendTestEndAlert(message, country = "Израиль") {
  const isUkraine = country.toLowerCase() === "украина";
  const footerIconURL = message.guild?.iconURL({ extension: "png", size: 128 });

  const embed = isUkraine
    ? buildEndAlertEmbed(
        "Украина",
        "Воздушная тревога",
        ["Киев", "Харьков", "Одесса"],
        footerIconURL
      )
    : buildEndAlertEmbed(
        "Израиль",
        "Ракетный обстрел",
        ["אשקלון", "אשדוד", "שדרות"],
        footerIconURL
      );

  await message.channel.send({ embeds: [embed] });
}

module.exports = {
  startAlertsLoop,
  sendTestAlert,
  sendTestEndAlert,
  checkAndSendAlerts,
  fetchIsraelAlerts,
  fetchUkraineAlerts,
  fetchAllAlerts,
  buildStartAlertEmbed,
  buildEndAlertEmbed,
};
