require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { executeDax, getDatasetRefreshTime } = require('./powerbi');

const _BIDI_TEST  = /[‎‏‪-‮]/;
const _BIDI_STRIP = /[‎‏‪-‮]/g;

function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = _BIDI_TEST.test(raw);
  const s = raw.replace(_BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  const fixed = s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
  return fixed.replace(/\(/g, '\x01').replace(/\)/g, '(').replace(/\x01/g, ')');
}

function fixGimel(s) {
  if (!s) return s;
  s = s.replace(/['‘’׳ʼ´`]\s*ג\s*(\d+)['’׳]?/g, ' $1 ג');
  s = s.replace(/(\d+)ג['''׳ʼ´`]/g, '$1 ג ');
  return s.trim();
}

async function build() {
  const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;
  if (!MMD_DS) { console.error('POWERBI_MMD_DATASET_ID not set — check PBI_MMD_DATASET GitHub secret'); process.exit(1); }
  console.log('Dataset ID:', MMD_DS.slice(0,8) + '...' + MMD_DS.slice(-4)); // partial for security

  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const lastDay2 = new Date(curY, curM, 0).getDate();
  // Start = 6 full weeks back from start of current week (Sunday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // rewind to Sunday
  const sixWeeksBack = new Date(startOfWeek);
  sixWeeksBack.setDate(startOfWeek.getDate() - 42);
  const twelveWeeksBack = new Date(startOfWeek);
  twelveWeeksBack.setDate(startOfWeek.getDate() - 84);
  const y1 = sixWeeksBack.getFullYear(), m1 = sixWeeksBack.getMonth() + 1, d1 = sixWeeksBack.getDate();
  const yp = twelveWeeksBack.getFullYear(), mp = twelveWeeksBack.getMonth() + 1, dp = twelveWeeksBack.getDate();
  // sixWeeksBack - 1 day = last day of prev6 window
  const prevEnd = new Date(sixWeeksBack); prevEnd.setDate(prevEnd.getDate() - 1);
  const ye = prevEnd.getFullYear(), me = prevEnd.getMonth() + 1, de = prevEnd.getDate();
  const y2 = curY, m2 = curM;
  const df      = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},${d1}), DATE(${y2},${m2},${lastDay2}))`;
  const df_prev = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${yp},${mp},${dp}), DATE(${ye},${me},${de}))`;

  console.log(`Building MMD ORDERS: ${y1}-${String(m1).padStart(2,'0')}-${String(d1).padStart(2,'0')} → ${y2}-${String(m2).padStart(2,'0')}-${lastDay2}`);

  const rows = await executeDax(`
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[תאור],
        'KARTIS PARIT'[תאור משפחה],
        'KARTIS PARIT'[תאור פרמטר 2 למוצר],
        'KARTIS PARIT'[HEVRA.חברה],
        'KARTIS PARIT'[תכולת האריזה למוצר],
        'KARTIS PARIT'[URL תמונה],
        'KARTIS PARIT'[ASHDOD KAARTON],
        'KARTIS PARIT'[MMD KARTON],
        "eilat_k",    [מלאי בקרטון EILAT],
        "maavar",     [מחסן מעבר],
        "mkr_shvua",  CALCULATE([מכר ממוצע בשבוע קרטון], ${df}),
        "mkr_prev6",  CALCULATE([מכר ממוצע בשבוע קרטון], ${df_prev}),
        "mkr_tk",     CALCULATE([מכר קרטון],              ${df}),
        "shavuot",    CALCULATE([לכמה שבועות יספיק המלאי], ${df}),
        "weeks_nf",   [WEEKS נפח הזמנה],
        "yamim_haya", CALCULATE([ימים שהיה בהם מלאי],    ${df}),
        "pct_mkr",    CALCULATE([ימי מכר מכלל ימי עבודה %], ${df}),
        "hamlatza_k", CALCULATE([המלצה להזמנה קרטון],     ${df}),
        "mkr_shach",  CALCULATE([ מכר brutto],             ${df}),
        "zikuy_shach",CALCULATE([זיכויים סך הכול],         ${df}),
        "pct_zikuy",  CALCULATE([% זיכויים סך הכול],       ${df}),
        "pizur",      CALCULATE([% לקוחות], NOT 'לקוחות'[תאור סוג לקוח] IN { "סיטונאים", "מלונות", "פתאל מוסדי" }, ${df}),
        "tukuf",      [List of ת. תפוגת תוקף values],
        "yamim",      MIN('תוקף FORM'[כמה ימים נשארו]),
        "eilat_yamim", MIN('EILATתוקף'[כמה ימים נשארו]),
        "eilat_tukuf_dt", MIN('EILATתוקף'[ת. תפוגת תוקף]),
        "dist_active", CALCULATE([לקוחות פעילים], NOT 'לקוחות'[תאור סוג לקוח] IN { "סיטונאים", "מלונות", "פתאל מוסדי" }, ${df}),
        "cust_bought", CALCULATE([כמות לקוחות], NOT 'לקוחות'[תאור סוג לקוח] IN { "סיטונאים", "מלונות", "פתאל מוסדי" }, ${df}),
        "eilat_batches", CONCATENATEX('EILATתוקף', 'EILATתוקף'[מנה/פק'ע] & "|" & FORMAT('EILATתוקף'[ת. תפוגת תוקף],"DD/MM/YYYY") & "|" & [קרטון מלאי תוקף] & "|" & 'EILATתוקף'[כמה ימים נשארו], ";", 'EILATתוקף'[ת. תפוגת תוקף], ASC)
      ),
      OR(OR('KARTIS PARIT'[ASHDOD KAARTON] > 0, 'KARTIS PARIT'[MMD KARTON] > 0), [מחסן מעבר] > 0)
    )
    ORDER BY 'KARTIS PARIT'[תאור משפחה] ASC, 'KARTIS PARIT'[מק"ט] ASC
  `, MMD_DS);

  const data = rows.map(r => ({
    mkt:        r['KARTIS PARIT[מק"ט]'],
    taur:       fixGimel(fixBiDi(r['KARTIS PARIT[תאור]'] || '')),
    mishpacha:  fixBiDi(r['KARTIS PARIT[תאור משפחה]'] || ''),
    param2:     r['KARTIS PARIT[תאור פרמטר 2 למוצר]'] || null,
    hevra:      r['KARTIS PARIT[HEVRA.חברה]'] || '',
    krat:       r['KARTIS PARIT[תכולת האריזה למוצר]'] ?? null,
    img:        r['KARTIS PARIT[URL תמונה]'] || null,
    ashdod_k:   r['KARTIS PARIT[ASHDOD KAARTON]'] ?? null,
    mmd_k:      r['KARTIS PARIT[MMD KARTON]'] ?? null,
    eilat_k:    r['[eilat_k]'] ?? null,
    maavar:     r['[maavar]'] ?? null,
    mkr_shvua:  r['[mkr_shvua]']  != null ? Math.round(r['[mkr_shvua]']  * 10) / 10 : null,
    mkr_prev6:  r['[mkr_prev6]']  != null ? Math.round(r['[mkr_prev6]']  * 10) / 10 : null,
    mkr_tk:     r['[mkr_tk]']     != null ? Math.round(r['[mkr_tk]'])              : null,
    shavuot:    r['[shavuot]']    != null ? Math.round(r['[shavuot]']  * 10) / 10 : null,
    weeks_nf:   r['[weeks_nf]']   != null ? Math.round(r['[weeks_nf]'])            : null,
    yamim_haya: r['[yamim_haya]'] != null ? Math.round(r['[yamim_haya]'])          : null,
    pct_mkr:    r['[pct_mkr]']    != null ? Math.round(r['[pct_mkr]']  * 100)      : null,
    hamlatza:    r['[hamlatza_k]'] != null ? Math.round(r['[hamlatza_k]'] * 10) / 10 : null,
    mkr_shach:   r['[mkr_shach]']  != null ? Math.round(r['[mkr_shach]'])              : null,
    zikuy_shach: r['[zikuy_shach]']!= null ? Math.round(r['[zikuy_shach]'])            : null,
    pct_zikuy:   r['[pct_zikuy]']  != null ? Math.round(r['[pct_zikuy]']  * 100)      : null,
    pizur:       r['[pizur]']      != null ? Math.round(r['[pizur]']      * 100)      : null,
    tukuf:          r['[tukuf]']         || null,
    yamim:          r['[yamim]']         != null ? Math.round(r['[yamim]'])       : null,
    eilat_yamim:    r['[eilat_yamim]']   != null ? Math.round(r['[eilat_yamim]']) : null,
    eilat_tukuf_dt: r['[eilat_tukuf_dt]'] != null
      ? new Date(r['[eilat_tukuf_dt]']).toISOString().slice(0, 10) : null,
    dist_active:    r['[dist_active]']  != null ? Math.round(r['[dist_active]'])  : null,
    cust_bought:    r['[cust_bought]']  != null ? Math.round(r['[cust_bought]'])  : null,
    eilat_batches:  r['[eilat_batches]'] || null,
  }));

  // Merge shelfLife from product-data.json (7/21/45 days per SKU — Mahsan Editor source)
  const pdPath = path.join(__dirname, '..', 'docs', 'product-data.json');
  const productData = fs.existsSync(pdPath) ? JSON.parse(fs.readFileSync(pdPath, 'utf8')) : {};
  data.forEach(r => { r.shelfLife = productData[String(r.mkt)]?.shelfLife ?? null; });

  const refreshedAt = await getDatasetRefreshTime(MMD_DS);
  const out = { ok: true, data, ts: Date.now(), refreshedAt, period: { y1, m1, y2, m2 } };

  const outPath = path.join(__dirname, '..', 'docs', 'mmd-orders.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`✓ Saved ${data.length} products → docs/mmd-orders.json`);

  const htmlPath = path.join(__dirname, '..', 'docs', 'mmd-orders.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  fs.writeFileSync(htmlPath, html.replace(/1782304580563/g, String(out.ts)));
  console.log(`✓ Cache-busted mmd-orders.html → ?v=${out.ts}`);
}

build().catch(err => { console.error(err); process.exit(1); });
