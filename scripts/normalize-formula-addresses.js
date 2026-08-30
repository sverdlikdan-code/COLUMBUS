// Нормализация адресов Formula Road перед геокодингом — "один раз и навсегда".
//
// Идея: 'לקוחות FORM+I+INT' в FORMULA PBI даёт до 3 строк на клиента (FORMULA/ICE/INTER),
// каждая со своим написанием адреса той же физической точки. Сверяем все три написания
// против эталонного гос-справочника МВД (רשות האוכלוסין וההגירה) "רשימת רחובות בישראל"
// (scripts/fetch-il-streets-registry.js) — город+улица+синонимы, официальный код улицы.
// Результат: единая "нормализованная" пара город+улица+дом на клиента + флаг совпадения
// между компаниями (agree/conflict/single-source) — используется как вход для геокодера
// вместо сырых PBI-строк (canonical-адрес почти всегда даёт лучший hit-rate у Google/Azure).
//
// ВАЖНО про BiDi: PBI хранит иврит в "визуальном" порядке под LRO-маркой — это не только
// разворот букв ВНУТРИ слова (как чинит существующая fixBiDiAddress в server/index.js),
// но и разворот порядка самих СЛОВ во фразе. Проверено на реальных данных 2026-08-18:
// "12 ןרוא זכרמ" при развороте только букв даёт "12 אורן מרכז" (бессмысленный порядок),
// а при развороте порядка слов + букв внутри каждого — "מרכז אורן 12" (реальное название
// точки). Здесь используется корректная версия (fixHebrewVisualOrder). Существующая
// fixBiDiAddress в server/index.js вероятно содержит этот баг — см. вывод в конце скрипта,
// решение о фиксе прод-функции — за пользователем (см. project_hebrew_bidi_map memory).
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const { executeDax } = require('../server/powerbi');

// ── BiDi fix (корректная версия — разворот порядка слов + букв внутри каждого) ────────────
const BIDI_MARKS_RE = /[‎‏‪-‮]/g;
const HAS_OVERRIDE_RE = /[‭‮]/;
const HEBREW_RUN_RE = /[֐-׿יִ-ﭏ]+/g;

function fixHebrewVisualOrder(str) {
  if (!str) return str;
  const hadOverride = HAS_OVERRIDE_RE.test(str);
  let clean = str.replace(BIDI_MARKS_RE, '').trim();
  if (!hadOverride) return clean;
  // Визуальное хранилище перевернуло порядок токенов (слов/чисел) — вернуть логический порядок.
  const tokens = clean.split(/\s+/).reverse();
  // Внутри каждого токена развернуть только ивритские буквенные последовательности (числа/латиница не трогаем).
  return tokens.map(t => t.replace(HEBREW_RUN_RE, seg => seg.split('').reverse().join(''))).join(' ');
}

// ── Очистка для сопоставления (аналог cleanAddressForGeocoding из server/index.js,
//    но поверх fixHebrewVisualOrder вместо исходной fixBiDiAddress) ────────────────────────
const ABBREV_MAP = [
  [/רח[''׳]\s*/g, ''],
  [/(?<![א-ת])רחוב(?![א-ת])\s*/g, ''],
  [/(?<![א-ת])רח(?![א-ת'"׳])\s*/g, ''],
  [/ד[""״]ר\s*/g, 'דוקטור '],
  [/פרופ[''׳]\s*/g, 'פרופסור '],
  [/שד[''׳]\s*/g, 'שדרות '],
  [/(?<![א-ת])שד(?![א-ת'"׳])\s*/g, 'שדרות '],
];
const VENUE_PATTERNS = [
  /מרכז מסחרי[^,]*/gi, /מרכז עסקים[^,]*/gi, /מרכז קניות[^,]*/gi,
  /קניון[^,]*/gi, /מתחם[^,]*/gi, /פארק תעשיי?ה[^,]*/gi,
  /אזור תעשיי?ה[^,]*/gi, /בית קפה[^,]*/gi, /מסעדה[^,]*/gi,
  /סופרמרקט[^,]*/gi, /קומה\s*\d+/gi, /דירה\s*\d+/gi,
  /כניסה\s*[א-ת\d]+/gi, /בניין\s*[א-ת\d]*/gi, /\(.*?\)/g,
  /(?<=[א-ת0-9])\s+פינ[הת]\b.*$/g,
];

function cleanForMatching(rawAddress) {
  let s = fixHebrewVisualOrder(rawAddress);
  for (const [pat, rep] of ABBREV_MAP) s = s.replace(pat, rep);
  s = s.replace(/(\d+)\/\d+/g, '$1'); // "26/1" -> "26" (номер входа/квартиры не нужен)
  for (const pattern of VENUE_PATTERNS) s = s.replace(pattern, '');
  return s.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

function extractHouseNumber(cleaned) {
  const m = cleaned.match(/^(.*?)\s*(\d+)\s*$/);
  if (!m) return { street: cleaned.trim(), houseNumber: null };
  return { street: m[1].trim(), houseNumber: m[2] };
}

// ── Levenshtein similarity (0..1) ──────────────────────────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}
function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ── Нормализация текста для сравнения город/улица (снять диакритику, кавычки, дефисы) ─────
function normText(s) {
  return (s || '')
    .replace(/[֑-ׇ]/g, '') // niqqud/тхама (диакритика)
    .replace(/[''"׳״`]/g, '')
    .replace(/[-־]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function normCity(s) {
  let c = normText(s);
  c = c.replace(/^תל אביב\s*יפו$/, 'תל אביב יפו').replace(/^תל אביב$/, 'תל אביב יפו');
  c = c.replace(/קריית/g, 'קרית');
  return c;
}

// Google formatted_address приходит как "улица дом, город, индекс, ישראל" — для колонки-
// предложения нужен только чистый адрес (город и так есть в отдельной колонке), обрезаем
// хвост (страна / почтовый индекс / город) с конца, по одному компоненту за раз.
function stripCityCountrySuffix(formatted, city) {
  if (!formatted) return formatted;
  const parts = formatted.split(/,\s*/);
  while (parts.length && /^(ישראל|israel)$/i.test(parts[parts.length - 1].trim())) parts.pop();
  while (parts.length && /^\d{5,7}$/.test(parts[parts.length - 1].trim())) parts.pop();
  const cityNorm = normText(city);
  while (parts.length && normText(parts[parts.length - 1]) === cityNorm) parts.pop();
  return parts.join(', ').trim();
}

// ── Загрузка справочника МВД, построение индексов по городу ───────────────────────────────
function loadRegistry() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'il-streets-registry.json'), 'utf8'));
  const cityExact = new Map();      // normCity -> исходное city (для отображения)
  const cityFuzzyList = [];         // [{norm, raw}] для fallback fuzzy
  const streetsByCity = new Map();  // normCity -> [{normStreet, officialCode, isOfficial}]
  const officialNameByCityCode = new Map(); // `${normCity}|${officialCode}` -> official street name

  for (const r of raw) {
    const nCity = normCity(r.city);
    if (!nCity) continue;
    if (!cityExact.has(nCity)) {
      cityExact.set(nCity, r.city.trim());
      cityFuzzyList.push({ norm: nCity, raw: r.city.trim() });
    }
    const nStreet = normText(r.street);
    const isOfficial = r.status.startsWith('official');
    if (!streetsByCity.has(nCity)) streetsByCity.set(nCity, []);
    streetsByCity.get(nCity).push({ normStreet: nStreet, officialCode: r.officialCode, isOfficial, rawStreet: r.street.trim() });
    if (isOfficial) officialNameByCityCode.set(`${nCity}|${r.officialCode}`, r.street.trim());
  }
  return { cityExact, cityFuzzyList, streetsByCity, officialNameByCityCode };
}

function matchCity(rawCity, registry) {
  const n = normCity(rawCity);
  if (!n) return null;
  if (registry.cityExact.has(n)) return { normCity: n, displayCity: registry.cityExact.get(n), score: 1 };
  let best = null;
  for (const c of registry.cityFuzzyList) {
    const s = similarity(n, c.norm);
    if (!best || s > best.score) best = { normCity: c.norm, displayCity: c.raw, score: s };
  }
  return best && best.score >= 0.72 ? best : null;
}

function matchStreet(normCityKey, streetText, registry) {
  const nStreet = normText(streetText);
  const candidates = registry.streetsByCity.get(normCityKey) || [];
  if (!nStreet) {
    // Адрес без улицы (только город/центр/район) — попробовать "город как псевдо-улица"
    // (гос-реестр регистрирует такие записи как street==city, status=official, обычно official_code 9000).
    const cityAsStreet = candidates.find(c => c.isOfficial && c.normStreet === normCityKey);
    if (cityAsStreet) return { officialCode: cityAsStreet.officialCode, officialName: cityAsStreet.rawStreet, score: 1, matchType: 'city-only' };
    return null;
  }
  // exact
  const exact = candidates.find(c => c.normStreet === nStreet);
  if (exact) {
    const officialName = registry.officialNameByCityCode.get(`${normCityKey}|${exact.officialCode}`) || exact.rawStreet;
    return { officialCode: exact.officialCode, officialName, score: 1, matchType: exact.isOfficial ? 'exact' : 'exact-synonym' };
  }
  // fuzzy
  let best = null;
  for (const c of candidates) {
    const s = similarity(nStreet, c.normStreet);
    if (!best || s > best.score) best = { c, score: s };
  }
  if (!best || best.score < 0.72) return null;
  const officialName = registry.officialNameByCityCode.get(`${normCityKey}|${best.c.officialCode}`) || best.c.rawStreet;
  return { officialCode: best.c.officialCode, officialName, score: best.score, matchType: best.c.isOfficial ? 'fuzzy' : 'fuzzy-synonym' };
}

function normalizeOneAddress(rawAddress, rawCity, registry) {
  const cityMatch = matchCity(rawCity, registry);
  if (!cityMatch) return { confidence: 'none', displayCity: fixHebrewVisualOrder(rawCity) || rawCity };
  const cleaned = cleanForMatching(rawAddress);
  const { street, houseNumber } = extractHouseNumber(cleaned);
  const streetMatch = matchStreet(cityMatch.normCity, street, registry);
  if (!streetMatch) {
    return { confidence: 'low', displayCity: cityMatch.displayCity, cityScore: cityMatch.score, normCity: cityMatch.normCity };
  }
  const composite = cityMatch.score * streetMatch.score;
  let confidence;
  if (streetMatch.matchType === 'city-only') confidence = 'medium';
  else if (composite >= 0.95) confidence = 'high';
  else if (composite >= 0.75) confidence = 'medium';
  else confidence = 'low';
  // Только чистый адрес (улица+дом), БЕЗ города — город уже есть в отдельной колонке
  // "עיר (מקור)". Для city-only матча (нет улицы вообще) — предложить нечего, оставить пусто.
  const full = streetMatch.matchType === 'city-only'
    ? ''
    : `${streetMatch.officialName}${houseNumber ? ' ' + houseNumber : ''}`;
  return {
    confidence, displayCity: cityMatch.displayCity, normCity: cityMatch.normCity,
    cityScore: cityMatch.score, streetScore: streetMatch.score, officialCode: streetMatch.officialCode,
    officialStreet: streetMatch.officialName, houseNumber, normalizedFull: full,
  };
}

// ── DAX: клиенты FORM+I+INT с агентом и адресом ────────────────────────────────────────────
async function fetchClients() {
  const rows = await executeDax(`EVALUATE SELECTCOLUMNS('לקוחות FORM+I+INT',
    "custno", 'לקוחות FORM+I+INT'[מס. לקוח],
    "custname", 'לקוחות FORM+I+INT'[שם לקוח],
    "hevra", 'לקוחות FORM+I+INT'[HEVRA],
    "address", 'לקוחות FORM+I+INT'[כתובת],
    "city", 'לקוחות FORM+I+INT'[עיר],
    "sochenName", 'לקוחות FORM+I+INT'[שם סוכן],
    "status", 'לקוחות FORM+I+INT'[סטטוס],
    "lat", 'לקוחות FORM+I+INT'[קו רוחב],
    "lon", 'לקוחות FORM+I+INT'[קו אורך]
  )`);
  return rows
    .map(r => ({
      custno: String(r['[custno]'] || '').trim(),
      custname: fixHebrewVisualOrder(r['[custname]'] || ''),
      hevra: (r['[hevra]'] || '').trim(),
      addressRaw: r['[address]'] || '',
      cityRaw: r['[city]'] || '',
      sochen: (r['[sochenName]'] || '').trim(),
      status: (r['[status]'] || '').trim(),
      lat: r['[lat]'] || 0,
      lon: r['[lon]'] || 0,
    }))
    // Только активные клиенты (סטטוס=פעיל) с назначенным агентом и заполненными адресом+городом.
    .filter(r => r.custno && r.sochen && r.status === 'פעיל' && r.addressRaw.trim() && r.cityRaw.trim());
}

// ── Google Geocoding — фоллбэк ТОЛЬКО для confidence low/none (справочник МВД не даёт
// предложения без покрытия улицы/дома). Платный API — кэш обязателен, инкрементально
// сохраняется на диск, чтобы повторный запуск скрипта не тратил деньги повторно.
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || '';
const GOOGLE_CACHE_PATH = path.join(__dirname, 'google-geocode-cache.json');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function geocodeGoogle(query) {
  return new Promise(resolve => {
    const https = require('https');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=il&language=he&key=${GOOGLE_MAPS_KEY}`;
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const r = data.status === 'OK' ? data.results[0] : null;
          const locality = r ? (r.address_components.find(c => c.types.includes('locality')) || {}).long_name : null;
          resolve(r ? { formatted: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng, accuracy: r.geometry.location_type, locality } : null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function enrichWithGoogle(outRows) {
  if (!GOOGLE_MAPS_KEY) { console.log('GOOGLE_MAPS_KEY не задан — пропускаю Google-фоллбэк.'); return; }
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(GOOGLE_CACHE_PATH, 'utf8')); } catch {}

  const targets = outRows.filter(r => r.confidence === 'low' || r.confidence === 'none');
  console.log(`\nGoogle-фоллбэк для low/none confidence: ${targets.length} клиентов...`);
  let calls = 0;
  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const addr = r.addrFormula || r.addrInter || r.addrIce;
    const city = (r.cities || '').split(' / ')[0];
    if (!addr || !city) continue;
    const query = `${addr}, ${city}, ישראל`;

    let geo;
    if (query in cache) {
      geo = cache[query];
    } else {
      geo = await geocodeGoogle(query);
      cache[query] = geo;
      calls++;
      await sleep(120);
      if (calls % 50 === 0) fs.writeFileSync(GOOGLE_CACHE_PATH, JSON.stringify(cache, null, 2));
    }
    if (geo) {
      r.normalizedFull = stripCityCountrySuffix(geo.formatted, city);
      r.suggestionSource = 'Google';
      r.googleAccuracy = geo.accuracy || '';
      r.googleLat = geo.lat; r.googleLng = geo.lng;
      // Sanity-check: город в ответе Google должен совпадать с городом клиента из PBI.
      // Без этой проверки Google иногда молча подставляет адрес в СОВСЕМ ДРУГОМ городе,
      // когда исходный текст адреса слишком кривой, чтобы найтись в правильном городе
      // (найдено на реальном случае 2026-08-19: "ל"צה 4, חדרה" → Google вернул
      // "המסגר 5, נס ציונה" — Нес-Циона вместо Хадеры, с ROOFTOP-точностью).
      const cityMatchOk = geo.locality ? similarity(normText(geo.locality), normText(city)) >= 0.7 : null;
      r.googleCityMismatch = cityMatchOk === false ? geo.locality : '';
    }
    if (i % 20 === 0) process.stdout.write(`\r  ${i + 1}/${targets.length} (новых запросов: ${calls})`);
  }
  fs.writeFileSync(GOOGLE_CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`\r  ${targets.length}/${targets.length} (новых запросов к Google: ${calls}, из кэша: ${targets.length - calls})`);
}

async function main() {
  console.log('Тяну справочник МВД...');
  const registry = loadRegistry();
  console.log(`  городов: ${registry.cityExact.size}`);

  console.log('Тяну клиентов из FORMULA PBI (לקוחות FORM+I+INT)...');
  const clients = await fetchClients();
  console.log(`  строк (סוכן+כתובת непустые): ${clients.length}`);

  // Группировка по custno — до 3 строк (FORMULA/ICE/INTER) на клиента.
  const byCust = new Map();
  for (const c of clients) {
    if (!byCust.has(c.custno)) byCust.set(c.custno, []);
    byCust.get(c.custno).push(c);
  }
  console.log(`  уникальных клиентов: ${byCust.size}`);

  console.log('Нормализую адреса...');
  const outRows = [];
  let bugSample = null;
  for (const [custno, rows] of byCust) {
    const byHevra = {};
    const normByHevra = {};
    for (const r of rows) {
      byHevra[r.hevra] = fixHebrewVisualOrder(r.addressRaw);
      normByHevra[r.hevra] = normalizeOneAddress(r.addressRaw, r.cityRaw, registry);
      if (!bugSample && /[‭‮]/.test(r.addressRaw) && r.addressRaw.trim().split(/\s+/).length > 1) {
        bugSample = { raw: r.addressRaw, oldStyleGuess: fixHebrewVisualOrder(r.addressRaw) };
      }
    }
    const custname = rows.find(r => r.custname)?.custname || '';
    const sochen = [...new Set(rows.map(r => r.sochen))].join(' / ');
    const cities = [...new Set(rows.map(r => fixHebrewVisualOrder(r.cityRaw)).filter(Boolean))].join(' / ');
    const lat = rows.find(r => r.lat)?.lat || 0;
    const lon = rows.find(r => r.lon)?.lon || 0;

    // Cross-company: сравнить (normCity, officialCode) между компаниями с confidence != none/low
    const usable = Object.values(normByHevra).filter(n => n.officialCode !== undefined);
    const keys = [...new Set(usable.map(n => `${n.normCity}|${n.officialCode}`))];
    let matchStatus;
    if (usable.length === 0) matchStatus = 'unresolved';
    else if (usable.length === 1) matchStatus = 'single-source';
    else if (keys.length === 1) matchStatus = 'agree';
    else matchStatus = 'conflict';

    // Выбор лучшего варианта: при agree/conflict — с максимальным composite score; иначе — единственный/лучший из имеющихся.
    let best = null;
    for (const n of Object.values(normByHevra)) {
      const score = (n.cityScore || 0) * (n.streetScore || (n.confidence === 'medium' ? 0.8 : 0));
      if (!best || score > best.score) best = { ...n, score };
    }

    outRows.push({
      custno, custname, sochen,
      addrFormula: byHevra['FORMULA'] || '', addrInter: byHevra['INTER'] || '', addrIce: byHevra['ICE'] || '',
      cities, lat, lon,
      normalizedFull: best?.normalizedFull || '', officialCode: best?.officialCode ?? '',
      confidence: best?.confidence || 'none', matchStatus,
      suggestionSource: best?.normalizedFull ? 'MVD' : '', googleAccuracy: '', googleCityMismatch: '',
    });
  }

  await enrichWithGoogle(outRows);

  const outPath = path.join(__dirname, 'formula-address-normalized.json');
  fs.writeFileSync(outPath, JSON.stringify(outRows, null, 2));
  console.log(`\nСохранено: ${outPath} (${outRows.length} клиентов)`);

  const stats = {};
  for (const r of outRows) stats[r.confidence] = (stats[r.confidence] || 0) + 1;
  console.log('По confidence:', stats);
  const statusStats = {};
  for (const r of outRows) statusStats[r.matchStatus] = (statusStats[r.matchStatus] || 0) + 1;
  console.log('По matchStatus (между компаниями):', statusStats);

  if (bugSample) {
    console.log('\n⚠ Проверка BiDi-бага в server/index.js fixBiDiAddress (только разворот букв, без разворота порядка слов):');
    console.log('  RAW:', bugSample.raw);
    console.log('  Корректный разворот (эта нормализация):', bugSample.oldStyleGuess);
  }

  await writeExcel(outRows, path.join(__dirname, '..', 'FORMULA ROADS — нормализация адресов.xlsx'));
}

// ── Excel (стандарт excel-smart-reports: real Table + freeze + autofilter + цвет по статусу) ─
async function writeExcel(rows, outPath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Адреса', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  const CONF_COLOR = {
    high:   { bg: 'FFE2EFDA', fg: 'FF006100' },
    medium: { bg: 'FFFFF2CC', fg: 'FF9C6500' },
    low:    { bg: 'FFFCE4D6', fg: 'FF9C0006' },
    none:   { bg: 'FFF2F2F2', fg: 'FF666666' },
  };
  const STATUS_LABEL = {
    agree: '✅ совпадают', conflict: '⚠️ конфликт', 'single-source': '— один источник', unresolved: '❌ не найдено',
  };
  const STATUS_COLOR = {
    agree: { bg: 'FFE2EFDA', fg: 'FF006100' },
    conflict: { bg: 'FFFCE4D6', fg: 'FF9C0006' },
    'single-source': { bg: 'FFF2F2F2', fg: 'FF666666' },
    unresolved: { bg: 'FFFCE4D6', fg: 'FF9C0006' },
  };

  const cols = [
    { n: 'מס. לקוח', w: 12 }, { n: 'שם לקוח', w: 30 }, { n: 'סוכן', w: 22 },
    { n: 'כתובת FORMULA', w: 32 }, { n: 'כתובת INTER', w: 32 }, { n: 'כתובת ICE', w: 32 },
    { n: 'עיר (מקור)', w: 18 }, { n: '💡 כתובת מוצעת (להזנה בפריוריטי)', w: 38 }, { n: 'מקור ההצעה', w: 12 },
    { n: 'דיוק Google', w: 16 }, { n: '⚠️ עיר לא תואמת (Google)', w: 22 }, { n: 'קוד רחוב רשמי', w: 14 },
    { n: 'רמת ביטחון', w: 13 }, { n: 'התאמה בין חברות', w: 16 },
    { n: 'GPS PBI (lat)', w: 12 }, { n: 'GPS PBI (lon)', w: 12 },
  ];

  const ACCURACY_LABEL = {
    ROOFTOP: '🎯 מדויק (בניין)', RANGE_INTERPOLATED: '📏 משוער (טווח)',
    GEOMETRIC_CENTER: '⚪ מרכז גיאומטרי', APPROXIMATE: '🔵 גס',
  };

  const safe = v => {
    const s = String(v ?? '');
    return /^[=+\-@]/.test(s) ? `'${s}` : s; // formula-injection guard (CWE-1236)
  };

  ws.addTable({
    name: 'FormulaAddressNorm', ref: 'A1', headerRow: true, totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: cols.map(c => ({ name: c.n, filterButton: true })),
    rows: rows.map(r => [
      safe(r.custno), safe(r.custname), safe(r.sochen),
      safe(r.addrFormula), safe(r.addrInter), safe(r.addrIce),
      safe(r.cities), safe(r.normalizedFull), safe(r.suggestionSource),
      safe(ACCURACY_LABEL[r.googleAccuracy] || ''), safe(r.googleCityMismatch ? `⚠️ Google: ${r.googleCityMismatch}` : ''),
      safe(r.officialCode),
      r.confidence, STATUS_LABEL[r.matchStatus] || r.matchStatus,
      r.lat || '', r.lon || '',
    ]),
  });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  header.height = 24;

  const SOURCE_COLOR = {
    MVD: { bg: 'FFE2EFDA', fg: 'FF006100' }, Google: { bg: 'FFD9E8FB', fg: 'FF1F4E79' },
  };

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    const srcCell = row.getCell(9);
    const src = SOURCE_COLOR[r.suggestionSource];
    if (src) { srcCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: src.bg } }; srcCell.font = { color: { argb: src.fg }, bold: true }; }
    if (r.googleCityMismatch) {
      const mmCell = row.getCell(11);
      mmCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
      mmCell.font = { color: { argb: 'FF9C0006' }, bold: true };
    }
    const confCell = row.getCell(13);
    const cc = CONF_COLOR[r.confidence] || CONF_COLOR.none;
    confCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cc.bg } };
    confCell.font = { color: { argb: cc.fg }, bold: true };
    const statCell = row.getCell(14);
    const sc = STATUS_COLOR[r.matchStatus] || STATUS_COLOR['single-source'];
    statCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.bg } };
    statCell.font = { color: { argb: sc.fg } };
    row.alignment = { vertical: 'middle' };
  });

  await wb.xlsx.writeFile(outPath);
  console.log('Excel сохранён:', outPath);
}

main().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
