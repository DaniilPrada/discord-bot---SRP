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

// Small cache helpers for If-Modified-Since
let israelLastModified = null;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(arr) {
  return [...new Set((arr || []).map((v) => normalizeText(v)).filter(Boolean))];
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

function resolveIsraelAlertType(item) {
  return (
    normalizeText(item?.title) ||
    normalizeText(item?.category) ||
    normalizeText(item?.alertType) ||
    normalizeText(item?.type) ||
    normalizeText(item?.threat) ||
    "Цева Адом"
  );
}

// ======================================
// ISRAEL HEBREW -> RUSSIAN TRANSLITERATION
// ======================================

// Exact overrides for common places / better visual quality
const ISRAEL_AREA_EXACT_MAP = {
  "אשקלון": "Ашкелон",
  "אשדוד": "Ашдод",
  "שדרות": "Сдерот",
  "איבים": "Ивим",
  "ניר עם": "Нир-Ам",
  "שדרות, איבים וניר-עם": "Сдерот, Ивим и Нир-Ам",
  "שדרות, איבים, וניר עם": "Сдерот, Ивим и Нир-Ам",
  "תל אביב": "Тель-Авив",
  "תל אביב-יפו": "Тель-Авив-Яффо",
  "תל אביב - יפו": "Тель-Авив - Яффо",
  "ירושלים": "Иерусалим",
  "חיפה": "Хайфа",
  "באר שבע": "Беэр-Шева",
  "פתח תקווה": "Петах-Тиква",
  "ראשון לציון": "Ришон-ле-Цион",
  "כפר סבא": "Кфар-Саба",
  "הרצליה": "Герцлия",
  "רעננה": "Раанана",
  "נתניה": "Нетания",
  "רחובות": "Реховот",
  "אשקלון הדרומית": "Ашкелон ха-Дромит",
  "מודיעין מכבים רעות": "Модиин-Маккабим-Реут",
  "קריית גת": "Кирьят-Гат",
  "קרית גת": "Кирьят-Гат",
  "קריית מלאכי": "Кирьят-Малахи",
  "קרית מלאכי": "Кирьят-Малахи",
  "גן יבנה": "Ган-Явне",
  "כפר עזה": "Кфар-Аза",
  "נחל עוז": "Нахаль-Оз",
  "נתיב העשרה": "Натив ха-Асара",
  "יד מרדכי": "Яд Мордехай",
  "כרם שלום": "Керем-Шалом",
  "ניר יצחק": "Нир-Ицхак",
  "עלומים": "Алюмим",
  "מפלסים": "Мефальсим",
  "זיקים": "Зиким",
  "בארי": "Беэри",
  "רעים": "Реим",
  "אופקים": "Офаким",
  "נתיבות": "Нетивот",
  "לוד": "Лод",
  "רמלה": "Рамла",
  "חולון": "Холон",
  "בת ים": "Бат-Ям",
  "יבנה": "Явне",
  "דובב": "Довев",
  'דוב"ב': "Довев",
};

// Hebrew char -> Cyrillic approximation
const HEBREW_TO_RUSSIAN_CHAR_MAP = {
  "א": "",
  "ב": "б",
  "ג": "г",
  "ד": "д",
  "ה": "а",
  "ו": "в",
  "ז": "з",
  "ח": "х",
  "ט": "т",
  "י": "и",
  "כ": "к",
  "ך": "к",
  "ל": "л",
  "מ": "м",
  "ם": "м",
  "נ": "н",
  "ן": "н",
  "ס": "с",
  "ע": "",
  "פ": "п",
  "ף": "п",
  "צ": "ц",
  "ץ": "ц",
  "ק": "к",
  "ר": "р",
  "ש": "ш",
  "ת": "т",
};

function titleCaseRussianLike(text) {
  return text
    .split(/(\s+|-|,|\/)/)
    .map((part) => {
      if (!part || /^(\s+|-|,|\/)$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

function transliterateHebrewWord(word) {
  const cleanWord = normalizeText(word);
  if (!cleanWord) return cleanWord;

  const exact = ISRAEL_AREA_EXACT_MAP[cleanWord];
  if (exact) return exact;

  let result = "";
  const chars = [...cleanWord];

  for (let i = 0; i < chars.length; i += 1) {
    const current = chars[i];
    const next = chars[i + 1] || "";
    const prev = chars[i - 1] || "";

    if (current === " ") {
      result += " ";
      continue;
    }

    if (current === "-") {
      result += "-";
      continue;
    }

    if (current === '"') {
      continue;
    }

    if (current === "'") {
      continue;
    }

    // Better handling for common Hebrew letter combinations
    if (current === "ש") {
      if (next === "י") {
        result += "ши";
        i += 1;
        continue;
      }
      result += "ш";
      continue;
    }

    if (current === "צ") {
      if (next === "'") {
        result += "ч";
        i += 1;
        continue;
      }
      result += "ц";
      continue;
    }

    if (current === "ז") {
      if (next === "'") {
        result += "ж";
        i += 1;
        continue;
      }
      result += "з";
      continue;
    }

    if (current === "ג") {
      if (next === "'") {
        result += "дж";
        i += 1;
        continue;
      }
      result += "г";
      continue;
    }

    if (current === "ו") {
      // Beginning of word often sounds more like "у"/"о" in names,
      // but for consistency we keep simple approximation.
      if (i === 0 && next === " ") {
        result += "в";
        continue;
      }
      result += "в";
      continue;
    }

    if (current === "י") {
      if (i === 0) {
        result += "й";
      } else if (prev === " ") {
        result += "й";
      } else {
        result += "и";
      }
      continue;
    }

    if (current === "ה") {
      if (i === 0) {
        result += "ха";
      } else {
        result += "а";
      }
      continue;
    }

    if (current === "א") {
      // silent most of the time
      if (i === 0 && next) {
        result += "а";
      }
      continue;
    }

    if (current === "ע") {
      if (i === 0 && next) {
        result += "а";
      }
      continue;
    }

    result += HEBREW_TO_RUSSIAN_CHAR_MAP[current] ?? current;
  }

  result = result
    .replace(/аа+/g, "а")
    .replace(/ии+/g, "и")
    .replace(/вв+/g, "в")
    .replace(/  +/g, " ")
    .trim();

  return titleCaseRussianLike(result || cleanWord);
}

function transliterateHebrewPhrase(text) {
  const cleanText = normalizeText(text);
  if (!cleanText) return cleanText;

  const exact = ISRAEL_AREA_EXACT_MAP[cleanText];
  if (exact) return exact;

  // Handle comma-separated areas
  const commaParts = cleanText.split(",").map((part) => normalizeText(part)).filter(Boolean);
  if (commaParts.length > 1) {
    return commaParts
      .map((part) => transliterateHebrewPhrase(part))
      .join(", ");
  }

  // Handle "ו" connector like "איבים וניר-עם"
  const words = cleanText.split(" ").filter(Boolean);
  const transliteratedWords = words.map((word) => {
    const exactWord = ISRAEL_AREA_EXACT_MAP[word];
    if (exactWord) return exactWord;

    if (word.startsWith("ו") && word.length > 1) {
      const rest = word.slice(1);
      const transliteratedRest = transliterateHebrewWord(rest);
      return `и ${transliteratedRest}`;
    }

    return transliterateHebrewWord(word);
  });

  return transliteratedWords.join(" ").replace(/\s+/g, " ").trim();
}

function translateIsraelAreasToRussian(areas) {
  return uniqueStrings(
    (areas || []).map((area) => {
      const cleanArea = normalizeText(area);
      if (!cleanArea) return cleanArea;

      const exact = ISRAEL_AREA_EXACT_MAP[cleanArea];
      if (exact) return exact;

      return transliterateHebrewPhrase(cleanArea);
    })
  );
}

function buildAlertEmbed(country, alertType, areas) {
  const safeCountry = country || "Неизвестно";
  const safeType = alertType || "Тревога";
  const safeAreas = Array.isArray(areas) ? areas.filter(Boolean) : [];
  const areaCount = safeAreas.length;

  const areasText =
    areaCount > 0
      ? safeAreas.map((area, index) => `${index + 1}. ${area}`).join("\n")
      : "Нет данных";

  const countryFlag =
    safeCountry.toLowerCase() === "израиль"
      ? "🇮🇱"
      : safeCountry.toLowerCase() === "украина"
        ? "🇺🇦"
        : "🌍";

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(`${countryFlag} Alert System`)
    .setDescription(`## ${safeType}`)
    .addFields(
      {
        name: "Страна:",
        value: safeCountry,
        inline: true,
      },
      {
        name: "Количество городов:",
        value: String(areaCount),
        inline: true,
      },
      {
        name:
          areaCount === 1
            ? "Населённый пункт:"
            : areaCount < 5
              ? "Населённые пункты:"
              : "Список населённых пунктов:",
        value: "```" + areasText.slice(0, 1000) + "```",
      },
      {
        name: "Инструкция:",
        value:
          "Немедленно пройдите в защищённое помещение и оставайтесь там до дальнейших указаний.",
      }
    )
    .setFooter({
      text: `Automated Alerts System • ${new Date().toLocaleString("ru-RU")}`,
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
        if (filteredAreas.length === 0) continue;

        const translatedAreas = translateIsraelAreasToRussian(filteredAreas);

        alerts.push({
          id: `israel::red-alert::${filteredAreas.join("|")}`,
          country: "Израиль",
          type: "Цева Адом",
          areas: translatedAreas,
        });

        continue;
      }

      const title = resolveIsraelAlertType(item);

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
      if (filteredAreas.length === 0) continue;

      const translatedAreas = translateIsraelAreasToRussian(filteredAreas);

      const alertId =
        normalizeText(item.id) ||
        [
          "israel",
          title,
          filteredAreas.join("|"),
          normalizeText(item.time || item.timestamp || item.date || ""),
        ].join("::");

      alerts.push({
        id: alertId,
        country: "Израиль",
        type: title,
        areas: translatedAreas,
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
      country: "Украина",
      type: normalizeText(alertType || "Воздушная тревога"),
      areas: [regionName],
      announcedAt,
    });
  }

  const deduped = [];
  const seen = new Set();

  for (const alert of alerts) {
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
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

    const parsedAlerts = parseUkraineAlarmMapHtml(html);

    if (!Array.isArray(parsedAlerts) || parsedAlerts.length === 0) {
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
        country: "Украина",
        type: normalizeText(item.type || "Воздушная тревога"),
        areas: filteredAreas,
      });
    }

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

  return [...israelAlerts, ...ukraineAlerts];
}

async function checkAndSendAlerts(client) {
  const alerts = await fetchAllAlerts();

  if (!Array.isArray(alerts) || alerts.length === 0) {
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    const alertsChannel = getAlertsChannel(guild);
    if (!alertsChannel) continue;

    for (const alert of alerts) {
      if (!alert?.id) continue;
      if (sentAlertIds.has(alert.id)) continue;

      sentAlertIds.add(alert.id);

      const embed = buildAlertEmbed(
        alert.country,
        alert.type,
        alert.areas || []
      );

      const mentionText = getMentionForCountry(alert.country);

      try {
        await alertsChannel.send({
          content: mentionText || undefined,
          embeds: [embed],
        });
      } catch (err) {
        console.error("Failed to send alert message:", err);
      }
    }
  }
}

function startAlertsLoop(client) {
  if (!ENABLE_ALERTS_LOOP) return;

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

  const embed = isUkraine
    ? buildAlertEmbed("Украина", "Воздушная тревога", [
        "Киев",
        "Харьков",
        "Одесса",
      ])
    : buildAlertEmbed("Израиль", "Цева Адом", [
        "Ашкелон",
        "Ашдод",
        "Сдерот, Ивим и Нир-Ам",
      ]);

  await message.channel.send({
    content: isUkraine ? UKRAINE_ALERT_MENTION : ISRAEL_ALERT_MENTION,
    embeds: [embed],
  });
}

module.exports = {
  startAlertsLoop,
  sendTestAlert,
  checkAndSendAlerts,
  fetchIsraelAlerts,
  fetchUkraineAlerts,
  fetchAllAlerts,
  buildAlertEmbed,
};