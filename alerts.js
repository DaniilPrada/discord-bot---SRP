const { EmbedBuilder, ChannelType } = require("discord.js");
const cheerio = require("cheerio");

const ALERTS_CHECK_INTERVAL_MS = 5000;
const ALERTS_CHANNEL_KEYWORD = "alerts";
const ENABLE_ALERTS_LOOP = true;

// Extra protection against false "end" caused by one bad poll
const END_CONFIRMATIONS_REQUIRED = 2;

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

// How many successful polls in a row the alert was missing
const pendingEndCounters = new Map();

const ISRAEL_ALERT_TYPE_CODE_MAP = new Map([
  ["5", "Проникновение вражеского БПЛА"],
]);

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

  const normalizedAllowlist = allowlist.map((x) =>
    normalizeText(x).toLowerCase()
  );

  return cleanAreas.filter((area) =>
    normalizedAllowlist.includes(normalizeText(area).toLowerCase())
  );
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function resolveIsraelAlertTypeCode(value) {
  const code = normalizeText(value);

  if (!code) return null;
  return ISRAEL_ALERT_TYPE_CODE_MAP.get(code) || null;
}

function mapIsraelAlertValue(value) {
  const raw = normalizeText(value);
  if (!raw) return "";

  const mappedCode = resolveIsraelAlertTypeCode(raw);
  return mappedCode || raw;
}

function resolveIsraelAlertType(item) {
  const directCodeCandidates = [
    item?.cat,
    item?.category,
    item?.alertType,
    item?.type,
    item?.notificationType,
    item?.eventCode,
  ]
    .map((v) => normalizeText(v))
    .filter(Boolean);

  for (const code of directCodeCandidates) {
    const mapped = resolveIsraelAlertTypeCode(code);
    if (mapped) {
      return mapped;
    }
  }

  const values = [
    item?.title,
    item?.category,
    item?.alertType,
    item?.type,
    item?.threat,
    item?.notificationType,
    item?.event,
    item?.desc,
    item?.cat,
    item?.eventCode,
  ]
    .map((v) => mapIsraelAlertValue(v))
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

  if (text.includes("רעידת אדמה") || text.includes("earthquake")) {
    return "Землетрясение";
  }

  if (text.includes("צונאמי") || text.includes("tsunami")) {
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

  if (/^\d+$/.test(joined)) {
    return resolveIsraelAlertTypeCode(joined) || "Цева Адом";
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
  const safeAreas = Array.isArray(areas)
    ? uniqueStrings(areas).filter(Boolean)
    : [];
  const areaCount = safeAreas.length;

  if (areaCount === 0) {
    return {
      areaCount: 0,
      areasText: "Нет данных",
      fieldName: "Населённые пункты:",
    };
  }

  const areasText = safeAreas
    .map((area, index) => `${index + 1}. ${area}`)
    .join("\n");

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
        value:
          "Немедленно пройдите в укрытие и оставайтесь там до дальнейших указаний.",
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
    throw new Error(
      `HTTP ${response.status} for ${url} :: ${text.slice(0, 200)}`
    );
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
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,uk;q=0.8,ru;q=0.7",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} for ${url} :: ${text.slice(0, 200)}`
    );
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

function getCountryKey(country) {
  return normalizeText(country).toLowerCase();
}

function cloneAlert(alert) {
  return {
    snapshotKey: alert.snapshotKey,
    country: alert.country,
    type: alert.type,
    areas: uniqueStrings(alert.areas || []),
  };
}

function getSnapshotForCountry(snapshotMap, country) {
  const result = new Map();
  const targetCountry = getCountryKey(country);

  for (const [key, value] of snapshotMap.entries()) {
    if (getCountryKey(value.country) === targetCountry) {
      result.set(key, cloneAlert(value));
    }
  }

  return result;
}

function replaceSnapshotForCountry(snapshotMap, country, newCountryMap) {
  const targetCountry = getCountryKey(country);

  for (const [key, value] of snapshotMap.entries()) {
    if (getCountryKey(value.country) === targetCountry) {
      snapshotMap.delete(key);
    }
  }

  for (const [key, value] of newCountryMap.entries()) {
    snapshotMap.set(key, cloneAlert(value));
  }
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
      return {
        ok: true,
        unchanged: true,
        country: "Израиль",
        alerts: null,
      };
    }

    if (result.lastModified) {
      israelLastModified = result.lastModified;
    }

    const data = result.data;

    if (!Array.isArray(data) || data.length === 0) {
      return {
        ok: true,
        unchanged: false,
        country: "Израиль",
        alerts: [],
      };
    }

    const alerts = [];

    for (const item of data) {
      if (!item) continue;

      if (typeof item === "string") {
        const filteredAreas = filterAreasByAllowlist(
          [item],
          ISRAEL_ALLOWED_AREAS
        );
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

      const filteredAreas = filterAreasByAllowlist(
        rawAreas,
        ISRAEL_ALLOWED_AREAS
      );
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

    return {
      ok: true,
      unchanged: false,
      country: "Израиль",
      alerts,
    };
  } catch (err) {
    console.error("fetchIsraelAlerts error:", err.message);
    return {
      ok: false,
      unchanged: false,
      country: "Израиль",
      alerts: null,
      error: err.message,
    };
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

    const announcedAt = normalizeText(
      announcedLine.split(":").slice(1).join(":")
    );

    alerts.push({
      id: `ukraine::${alertType}::${regionName}::${announcedAt}`,
      snapshotKey: buildSnapshotKey(
        "Украина",
        normalizeText(alertType || "Воздушная тревога"),
        [regionName]
      ),
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

      return {
        ok: true,
        unchanged: false,
        country: "Украина",
        alerts: [],
      };
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
          buildSnapshotKey(
            "Украина",
            item.type || "Воздушная тревога",
            filteredAreas
          ),
        country: "Украина",
        type: normalizeText(item.type || "Воздушная тревога"),
        areas: uniqueStrings(filteredAreas),
      });
    }

    console.log("[ukraine] normalized alerts count:", normalizedAlerts.length);

    return {
      ok: true,
      unchanged: false,
      country: "Украина",
      alerts: normalizedAlerts,
    };
  } catch (err) {
    console.error("fetchUkraineAlerts error:", err.message);
    return {
      ok: false,
      unchanged: false,
      country: "Украина",
      alerts: null,
      error: err.message,
    };
  }
}

async function fetchAllAlerts() {
  const [israelResult, ukraineResult] = await Promise.all([
    fetchIsraelAlerts(),
    fetchUkraineAlerts(),
  ]);

  console.log(
    `[alerts] fetched -> israel_ok=${israelResult.ok} israel_unchanged=${israelResult.unchanged} israel_count=${
      Array.isArray(israelResult.alerts) ? israelResult.alerts.length : "n/a"
    }, ukraine_ok=${ukraineResult.ok} ukraine_unchanged=${ukraineResult.unchanged} ukraine_count=${
      Array.isArray(ukraineResult.alerts) ? ukraineResult.alerts.length : "n/a"
    }`
  );

  return {
    israel: israelResult,
    ukraine: ukraineResult,
  };
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
    `[alerts] START sent ${alert.country} ${alert.type} -> ${alert.areas.join(
      ", "
    )} in guild ${guild.id}`
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
    `[alerts] END sent ${alert.country} ${alert.type} -> ${alert.areas.join(
      ", "
    )} in guild ${guild.id}`
  );
}

function markCurrentAlertsAsSeen(countryMap) {
  for (const key of countryMap.keys()) {
    pendingEndCounters.delete(key);
  }
}

function getConfirmedEndedAlerts(previousMap, currentMap) {
  const confirmedEnded = [];

  for (const [key, alert] of previousMap.entries()) {
    if (currentMap.has(key)) {
      pendingEndCounters.delete(key);
      continue;
    }

    const nextCount = (pendingEndCounters.get(key) || 0) + 1;
    pendingEndCounters.set(key, nextCount);

    if (nextCount >= END_CONFIRMATIONS_REQUIRED) {
      confirmedEnded.push(alert);
      pendingEndCounters.delete(key);
    }
  }

  return confirmedEnded;
}

async function processCountryChangesForGuilds(client, previousCountryMap, currentCountryMap) {
  const startedAlerts = getStartedAlerts(previousCountryMap, currentCountryMap);
  const endedAlerts = getConfirmedEndedAlerts(previousCountryMap, currentCountryMap);

  console.log(
    `[alerts] country diff -> started=${startedAlerts.length}, ended=${endedAlerts.length}, active=${currentCountryMap.size}`
  );

  if (startedAlerts.length === 0 && endedAlerts.length === 0) {
    return;
  }

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
}

async function applyCountryResult(client, result) {
  const country = result.country;
  const previousCountryMap = getSnapshotForCountry(activeAlertsSnapshot, country);

  if (!result.ok) {
    console.log(
      `[alerts] ${country}: source failed, keeping previous active alerts unchanged`
    );
    return;
  }

  if (result.unchanged) {
    console.log(
      `[alerts] ${country}: source returned not modified, keeping previous active alerts unchanged`
    );
    return;
  }

  const currentCountryMap = buildCurrentSnapshotMap(result.alerts || []);
  markCurrentAlertsAsSeen(currentCountryMap);

  await processCountryChangesForGuilds(
    client,
    previousCountryMap,
    currentCountryMap
  );

  replaceSnapshotForCountry(activeAlertsSnapshot, country, currentCountryMap);
}

async function checkAndSendAlerts(client) {
  if (isCheckingAlerts) {
    console.log("[alerts] skipped: previous check still running");
    return;
  }

  isCheckingAlerts = true;

  try {
    const results = await fetchAllAlerts();

    await applyCountryResult(client, results.israel);
    await applyCountryResult(client, results.ukraine);

    console.log(
      `[alerts] total active snapshot size=${activeAlertsSnapshot.size}`
    );
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

  console.log(
    `[alerts] loop started, interval=${ALERTS_CHECK_INTERVAL_MS}ms`
  );

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

  const israelTestAlerts = [
    {
      type: "Цева Адом",
      areas: ["אשקלון", "אשדוד", "שדרות"],
    },
    {
      type: "Ракетный обстрел",
      areas: ["אשקלון", "אשדוד", "שדרות"],
    },
    {
      type: "Проникновение вражеского БПЛА",
      areas: ["נהריה", "עכו", "קריית שמונה"],
    },
    {
      type: "Проникновение террористов",
      areas: ["מטולה", "שלומי", "זרעית"],
    },
    {
      type: "Опасные материалы",
      areas: ["חיפה", "קריית אתא", "נשר"],
    },
    {
      type: "Землетрясение",
      areas: ["טבריה", "צפת", "קצרין"],
    },
  ];

  const ukraineTestAlerts = [
    {
      type: "Воздушная тревога",
      areas: ["Киев", "Харьков", "Одесса"],
    },
    {
      type: "Ракетная угроза",
      areas: ["Днепр", "Запорожье", "Николаев"],
    },
    {
      type: "Угроза БПЛА",
      areas: ["Сумы", "Чернигов", "Полтава"],
    },
    {
      type: "Угроза баллистики",
      areas: ["Киев", "Кривой Рог", "Харьков"],
    },
  ];

  const pool = isUkraine ? ukraineTestAlerts : israelTestAlerts;
  const randomAlert = pool[Math.floor(Math.random() * pool.length)];

  const embed = buildStartAlertEmbed(
    isUkraine ? "Украина" : "Израиль",
    randomAlert.type,
    randomAlert.areas,
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
