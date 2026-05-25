/**
 * COLUMBUS — генератор единого документа сдачи проекта
 * Листы: Обзор | FR Фичи | FR Часы | MAHSAN Фичи | MAHSAN Часы
 */
const path    = require('path');
const ExcelJS = require(path.join(__dirname, 'planogram', 'node_modules', 'exceljs'));

const BORDER = ['top','bottom','left','right'].reduce((o,s)=>{
  o[s]={style:'thin',color:{argb:'FFD0D0D0'}}; return o; },{});

function applyB(c){ c.border=BORDER; }

function hdrCell(c, txt, bg, fg='FFFFFF', sz=11, align='center') {
  c.value=txt;
  c.font={bold:true,color:{argb:'FF'+fg},name:'Calibri',size:sz};
  c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+bg}};
  c.alignment={horizontal:align,vertical:'middle',wrapText:true};
  applyB(c);
}
function txtCell(c, txt, fg='333333', bg=null, bold=false, align='right', wrap=false) {
  c.value=txt;
  c.font={bold,color:{argb:'FF'+fg},name:'Calibri',size:11};
  if(bg) c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+bg}};
  c.alignment={horizontal:align,vertical:'middle',wrapText:wrap};
  applyB(c);
}
function numCell(c, val, fg='000000', bg=null, bold=false) {
  c.value=val; c.numFmt='0.0';
  c.font={bold,color:{argb:'FF'+fg},name:'Calibri',size:11};
  if(bg) c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+bg}};
  c.alignment={horizontal:'center',vertical:'middle'};
  applyB(c);
}

// ─── FORMULA ROAD ─────────────────────────────────────────────────────────────
const FR = {
  hdr:'1565C0', hdrFg:'FFFFFF', row1:'E3F2FD', row2:'FFFFFF', accent:'0D47A1', light:'BBDEFB',
  problems: [
    ['❌ Проблема до', '✅ Решение Formula Road'],
    ['מנהלים בזבזו 2-3 שעות ביום על שיגור תכניות ביקור ידנית לסוכנים',
     'המערכת שולחת את התכנית אוטומטית — כולל מסלול אופטימלי. 0 דקות עבודה ידנית'],
    ['GPS שגויים ב-Priority — לקוחות מופיעים בעיר הלא נכונה',
     'Geocoding אוטומטי 3 שלבים: Nominatim → Azure Maps → מרכז עיר. תיקון ידני GPS מהשטח'],
    ['סוכנים לא ידעו מה קרה עם לקוח — אחרון הזמנה, יעד, ביצוע',
     'כרטיסית לקוח: % ביצוע, יעד חודשי, תאריך הזמנה אחרונה + ימים שעברו'],
    ['שינוי יום ביקור לקוח דרש התערבות משרד + עדכון ב-Priority',
     'הסוכן שינוי יום ישירות באפליקציה → נשמר GitHub → ייצוא CSV → ייבוא Priority ERP'],
    ['מסלול ידני = עצירות לא הגיוניות, ק"מ מיותרים, עלויות דלק',
     'AI מיון Nearest-Neighbor — חיסכון ממוצע 30-40 ק"מ ליום לסוכן'],
  ],
  features: [
    ['פיצ\'ר', 'מה זה עושה', 'סטטוס'],
    ['בחירת מנהל / סוכן / יום',    'מסך כניסה — בחירה היררכית מנהל → סוכן → יום ביקור',               '✅'],
    ['מפה + מסלול',                 'Leaflet.js, clustering, polyline מסלול ויזואלי',                   '✅'],
    ['AI מיון לפי',                 'Nearest-Neighbor + Azure Maps road distance — קו"מ מינימלי',       '✅'],
    ['GPS Geocoding 3 שלבים',      'Nominatim → Azure Maps → bbox מרכז עיר. 97.7% כיסוי',              '✅'],
    ['GPS תיקון מהמפה',            'מרקר → "תקן מיקום" → שמירה גלובלית ב-GitHub לכל הסוכנים',          '✅'],
    ['GPS תיקון מהכרטיס',          'עמידה ליד חנות → GPS טלפון → עדכון מיידי ב-GitHub',                '✅'],
    ['שינוי יום ביקור',             '📅 על כרטיסית → בחירת יום → GitHub + CSV לייבוא Priority',         '✅'],
    ['ביצוע % + יעד',              'מכירות חודשיות / יעד × 100 + הזמנה אחרונה + ימים',                 '✅'],
    ['KM חיסכון שורת',             'km ביקור / km AI / חיסכון → מוטיבציה להשתמש ב-AI',                 '✅'],
    ['XL ייצוא Excel',             'כפתור ירוק XL → CSV של המסלול הפעיל',                              '✅'],
    ['פילטר ערים',                  'כפתורי עיר — סינון רשימה + מפה בו-זמנית',                         '✅'],
    ['Token לסוכנים',              'URL ?token= → localStorage → תיקוני GPS/יום ללא קוד בסורס',        '✅'],
    ['GitHub Actions אוטומציה',    'Build + deploy כל שעה. נתונים תמיד מעודכנים',                       '✅'],
    ['מרקר אפור — עיר מרכז',       'לקוחות ללא GPS מדויק — סמל ~N + אזהרה "מיקום משוער"',              '✅'],
    ['תאריך עדכון בheader',        'הצגת זמן הbuild האחרון — שקיפות לסוכן',                             '✅'],
  ],
  hours: [
    ['תאריך',     'שעות',      'סה"כ','🏢 9–17','🌙 אחרי 17:00','מה עשינו'],
    ['29.04.2026','14:12–21:29', 7.0,  3.0, 4.0, 'Initial commit, agents, routing pipeline'],
    ['30.04.2026','14:19–15:00', 1.0,  1.0, 0.0, 'UI overhaul DILLER FORMULA AGENT APP'],
    ['03.05.2026','13:43–19:30', 6.0,  3.5, 2.5, 'GPS Fabric API, city filters, AsyncStorage'],
    ['07.05.2026','15:48–16:30', 0.5,  0.5, 0.0, 'GPS geocoding pipeline'],
    ['10.05.2026','00:13–01:13', 1.0,  0.0, 1.0, 'fin-agent, skill-creator, CEO routing'],
    ['23.05.2026','10:00–22:00', 8.0,  5.0, 3.0, 'Power BI DAX refactor, % ביצוע, km-bar redesign'],
    ['24.05.2026','09:00–23:00',10.0,  6.0, 4.0, 'GPS+day corrections, token URL flow, GitHub commit'],
    ['25.05.2026','08:00–22:30', 7.5,  4.5, 3.0, 'Azure Maps geocoding, bbox fix, RTL names, city-center markers'],
  ],
};

// ─── MAHSAN ───────────────────────────────────────────────────────────────────
const MS = {
  hdr:'1B5E20', hdrFg:'FFFFFF', row1:'E8F5E9', row2:'FFFFFF', accent:'2E7D32', light:'C8E6C9',
  problems: [
    ['❌ Проблема до', '✅ Решение MAHSAN Editor'],
    ['הצוות לא ידע מה ממוקם היכן במחסן — ספירה ידנית',
     'עורך ויזואלי — מפה מלאה של כל bay-ים, גרירה, צבעים, מצב מלאי'],
    ['מוצרים פגי תוקף גילינו רק בספירה פיזית',
     'STOP SALE אוטומטי — כרטיסיות אדומות, התראה, כפתור הפסקת מכירה'],
    ['לא ידענו אילו bay-ים מוכרים טוב ואילו "מתים"',
     'Per-bay sales מ-Power BI — כל bay מציג מכירות חודשיות בזמן אמת'],
    ['עדכון פלנוגרמה = אקסל ידני + emails + confusion',
     'drag & drop → שמירה → GitHub → deploy אוטומטי. כל הצוות רואה עדכון מיידי'],
    ['Priority ERP לא ידע שינויים במחסן',
     'CSV export אוטומטי של כל שינוי → ייבוא Priority → סנכרון מלאי'],
  ],
  features: [
    ['פיצ\'ר', 'מה זה עושה', 'סטטוס'],
    ['עורך פלנוגרמה ויזואלי',       'ממשק web — bay-ים, גרירה, שמירה אוטומטית',                         '✅'],
    ['4 חדרי מחסן',                'קפוא / חלבי / דגים / דג יבש — תצוגה ועריכה נפרדת',                '✅'],
    ['Drag & Drop מוצרים',          'גרירה חופשית + reorder בתוך bay + בין bay-ים',                     '✅'],
    ['תמונות מוצרים',              'הורדה אוטומטית מ-Power BI + cache ב-localStorage',                 '✅'],
    ['Fabric Power BI סנכרון',     'DAX query → JSON → GitHub Actions → deploy כל שעה',                '✅'],
    ['STOP SALE + תוקף',           'הדגשת מוצרים פגי תוקף, כפתור STOP SALE + אישור',                  '✅'],
    ['מכירות Per-Bay',             'סך מכירות חודשי לכל bay, השוואה לתקופה קודמת',                    '✅'],
    ['Priority ERP ייצוא CSV',     'יצוא שינויי מיקום/STOP SALE לייבוא אוטומטי Priority',              '✅'],
    ['Reserve Bays',               'bay-ים לרזרבה — נפרד מהפלנוגרמה הפעילה',                          '✅'],
    ['GitHub Actions אוטומציה',    'Build → commit → deploy. ללא שרת. ללא תשלום',                      '✅'],
    ['Watchdog תהליך',             'שמירה על תהליך הbuild, הפעלה מחדש אוטומטית',                       '✅'],
    ['Mobile-First UI',            'RTL, כפתורים גדולים, מגע — שימוש בשטח',                            '✅'],
    ['Layout Schemas',             'JSON לכל חדר — מיקום, שמות, סדר bay-ים',                           '✅'],
  ],
  hours: [
    ['תאריך',     'שעות',      'סה"כ','🏢 9–17','🌙 אחרי 17:00','מה עשינו'],
    ['11.05.2026','21:11–21:30', 1.0,  0.0, 1.0, 'GitHub Actions — first run'],
    ['12.05.2026','00:00–23:58', 9.0,  3.0, 6.0, 'Editor: photos, drag-drop, דג יבש, card design'],
    ['13.05.2026','00:05–15:58', 7.0,  5.0, 2.0, 'Status filter, product name, position table'],
    ['14.05.2026','10:27–23:53',11.0,  6.5, 4.5, 'חלבי/דגים base JSON, layouts, auto-sync'],
    ['15.05.2026','00:01–11:14', 4.0,  2.0, 2.0, 'Photos, pakuot, Zafn data'],
    ['16.05.2026','10:14–22:13', 9.0,  6.5, 2.5, 'Expiry cards, STOP SALE, תוקף view'],
    ['17.05.2026','10:43–23:54',11.0,  6.5, 4.5, 'batchCell redesign, per-warehouse sales'],
    ['18.05.2026','00:01–21:01',12.0,  7.0, 5.0, 'Layouts halavi/dagim/yavesh, reserve, CSV pipeline'],
    ['19.05.2026','06:04–21:57',13.0,  8.0, 5.0, 'CSV sync, localStorage, hash-versioning, auto workflow'],
    ['20.05.2026','18:05–18:16', 1.5,  0.0, 1.5, 'Bug-agent, watchdog, hourly schedule'],
  ],
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function buildProblems(wb, sheetName, data, theme) {
  const ws = wb.addWorksheet(sheetName, { views:[{state:'frozen',xSplit:0,ySplit:2}] });
  ws.columns = [{ width:50 },{ width:60 }];

  ws.mergeCells('A1:B1');
  const banner = ws.getCell('A1');
  banner.value = sheetName.replace(/^[^ ]+ /,'');
  banner.font  = { bold:true, size:15, color:{argb:'FF'+theme.hdrFg}, name:'Calibri' };
  banner.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+theme.hdr} };
  banner.alignment = { horizontal:'center', vertical:'middle' };
  ws.getRow(1).height = 38;

  data.forEach(([a,b], i) => {
    if (i===0) {
      hdrCell(ws.getCell(2,1), a, theme.accent);
      hdrCell(ws.getCell(2,2), b, theme.accent);
      ws.getRow(2).height = 26;
    } else {
      const bg = i%2===0 ? theme.row1 : theme.row2;
      const fgA = 'B71C1C', fgB = '1B5E20';
      txtCell(ws.getCell(i+2,1), a, fgA, bg, false, 'right', true);
      txtCell(ws.getCell(i+2,2), b, fgB, bg, false, 'right', true);
      ws.getRow(i+2).height = 40;
    }
  });
  return ws;
}

function buildFeatures(wb, sheetName, data, theme) {
  const ws = wb.addWorksheet(sheetName, { views:[{state:'frozen',xSplit:0,ySplit:2}] });
  ws.columns = [{ width:26 },{ width:55 },{ width:8 }];

  ws.mergeCells('A1:C1');
  const banner = ws.getCell('A1');
  banner.value = sheetName.replace(/^[^ ]+ /,'');
  banner.font  = { bold:true, size:15, color:{argb:'FF'+theme.hdrFg}, name:'Calibri' };
  banner.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+theme.hdr} };
  banner.alignment = { horizontal:'center', vertical:'middle' };
  ws.getRow(1).height = 36;

  data.forEach(([a,b,c], i) => {
    if (i===0) {
      hdrCell(ws.getCell(2,1), a, theme.accent);
      hdrCell(ws.getCell(2,2), b, theme.accent);
      hdrCell(ws.getCell(2,3), c, theme.accent);
      ws.getRow(2).height = 24;
    } else {
      const bg = i%2===0 ? theme.row1 : theme.row2;
      txtCell(ws.getCell(i+2,1), a, '000000', bg, true,  'right');
      txtCell(ws.getCell(i+2,2), b, '444444', bg, false, 'right', true);
      txtCell(ws.getCell(i+2,3), c, '1B5E20', bg, true,  'center');
      ws.getRow(i+2).height = 22;
    }
  });
  ws.autoFilter = { from:'A2', to:'C2' };
  return ws;
}

function buildHours(wb, sheetName, data, theme) {
  const ws = wb.addWorksheet(sheetName, { views:[{state:'frozen',xSplit:0,ySplit:2}] });
  ws.columns = [{ width:13 },{ width:13 },{ width:8 },{ width:10 },{ width:14 },{ width:52 }];

  ws.mergeCells('A1:F1');
  const banner = ws.getCell('A1');
  banner.value = sheetName.replace(/^[^ ]+ /,'');
  banner.font  = { bold:true, size:15, color:{argb:'FF'+theme.hdrFg}, name:'Calibri' };
  banner.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+theme.hdr} };
  banner.alignment = { horizontal:'center', vertical:'middle' };
  ws.getRow(1).height = 36;

  let totalH=0, totalWork=0, totalEve=0;
  data.forEach((row, i) => {
    if (i===0) {
      row.forEach((h,j) => { hdrCell(ws.getCell(2,j+1), h, theme.accent); });
      ws.getRow(2).height = 26;
    } else {
      const [date,sess,tot,work,eve,notes] = row;
      totalH+=tot; totalWork+=work; totalEve+=eve;
      const bg = i%2===0 ? theme.row1 : theme.row2;
      txtCell(ws.getCell(i+2,1), date,  '000000', bg, false, 'center');
      txtCell(ws.getCell(i+2,2), sess,  '555555', bg, false, 'center');
      numCell(ws.getCell(i+2,3), tot,   '000000', bg, true);
      numCell(ws.getCell(i+2,4), work,  '1A5276', bg);
      numCell(ws.getCell(i+2,5), eve,   '6A1B9A', bg);
      txtCell(ws.getCell(i+2,6), notes, '444444', bg, false, 'right', true);
      ws.getRow(i+2).height = 20;
    }
  });

  const tr = data.length + 2;
  ['ИТОГО','',totalH,totalWork,totalEve,''].forEach((v,j) => {
    const c = ws.getCell(tr,j+1);
    if(j>=2&&j<=4){ c.value=v; c.numFmt='0.0'; }
    else c.value=v;
    c.font={bold:true,name:'Calibri',size:12,color:{argb:'FF'+theme.hdrFg}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+theme.hdr}};
    c.alignment={horizontal:'center',vertical:'middle'};
    applyB(c);
  });
  ws.getRow(tr).height = 28;

  // Summary box
  const sr = tr + 2;
  [
    [`סה"כ שעות`,           `${totalH.toFixed(1)} ש'`],
    [`שעות 9–17`,           `${totalWork.toFixed(1)} ש'  (${Math.round(totalWork/totalH*100)}%)`],
    [`שעות אחרי 17:00`,    `${totalEve.toFixed(1)} ש'  (${Math.round(totalEve/totalH*100)}%)`],
    [`ימי עבודה`,           `${data.length-1}`],
  ].forEach(([k,v],i) => {
    txtCell(ws.getCell(sr+i,1), k, '333333', theme.light, true,  'right');
    txtCell(ws.getCell(sr+i,2), v, theme.accent, theme.light, true, 'center');
    ws.getRow(sr+i).height = 22;
  });

  ws.autoFilter = { from:'A2', to:'F2' };
  return ws;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'COLUMBUS';

  buildProblems(wb, 'FR 🗺 בעיות ופתרונות',     FR.problems, FR);
  buildFeatures(wb, 'FR 📋 מה נמסר',             FR.features, FR);
  buildHours   (wb, 'FR ⏱ שעות',                FR.hours,    FR);
  buildProblems(wb, 'MAHSAN 🧊 בעיות ופתרונות',  MS.problems, MS);
  buildFeatures(wb, 'MAHSAN 📋 מה נמסר',         MS.features, MS);
  buildHours   (wb, 'MAHSAN ⏱ שעות',            MS.hours,    MS);

  const outFile = path.join(__dirname, 'COLUMBUS — Сдача проекта FINAL.xlsx');
  await wb.xlsx.writeFile(outFile);
  console.log('✅ Сохранено:', outFile);
})();
