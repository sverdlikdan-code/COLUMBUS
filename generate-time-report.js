/**
 * COLUMBUS Time Report — генерирует Excel по часам на проект
 */
const path    = require('path');
const ExcelJS = require(path.join(__dirname, 'planogram', 'node_modules', 'exceljs'));

const wb = new ExcelJS.Workbook();
wb.creator = 'COLUMBUS';
wb.created = new Date();

// ─── DATA ──────────────────────────────────────────────────────────────────

const PHASE = {
  APP:  'Columbus App',
  PLAN: 'Планограмма MAHSAN',
};

const rows = [
  // date,        session,          total, work, personal, phase,      notes
  ['29.04.2026', '14:12 – 21:29',  7.0,  3.0,  4.0,  PHASE.APP,  'Initial commit, агенты, routing'],
  ['30.04.2026', '14:19 – 14:19',  1.0,  1.0,  0.0,  PHASE.APP,  'UI overhaul DILLER FORMULA AGENT APP'],
  ['03.05.2026', '13:43 – 19:30',  6.0,  3.5,  2.5,  PHASE.APP,  'GPS Fabric API, AsyncStorage, фильтры'],
  ['07.05.2026', '15:48 – 15:49',  0.5,  0.5,  0.0,  PHASE.APP,  'GPS geocoding pipeline'],
  ['10.05.2026', '00:13 – 00:23',  1.0,  0.0,  1.0,  PHASE.APP,  'fin-agent, skill-creator, CEO dispute mode'],
  ['11.05.2026', '21:11 – 21:30',  1.0,  0.0,  1.0,  PHASE.APP,  'Планограмма GitHub Actions первый запуск'],
  ['12.05.2026', '00:00 – 23:58',  9.0,  3.0,  6.0,  PHASE.PLAN, 'Редактор: фото, drag-drop, דג יבש, дизайн карточек'],
  ['13.05.2026', '00:05 – 15:58',  7.0,  5.0,  2.0,  PHASE.PLAN, 'Статус-фильтр, product name, position table'],
  ['14.05.2026', '10:27 – 23:53', 11.0,  6.5,  4.5,  PHASE.PLAN, 'חלבי/דגים base JSON, layouts, auto-sync'],
  ['15.05.2026', '00:01 – 11:14',  4.0,  2.0,  2.0,  PHASE.PLAN, 'Фото, pakuot, Zafn данные'],
  ['16.05.2026', '10:14 – 22:13',  9.0,  6.5,  2.5,  PHASE.PLAN, 'Expiry cards, STOP SALE, тоקף view'],
  ['17.05.2026', '10:43 – 23:54', 11.0,  6.5,  4.5,  PHASE.PLAN, 'batchCell редизайн, per-warehouse sales'],
  ['18.05.2026', '00:01 – 21:01', 12.0,  7.0,  5.0,  PHASE.PLAN, 'Layouts halavi/dagim/yavesh, reserve cleanup, CSV pipeline'],
  ['19.05.2026', '06:04 – 21:57', 13.0,  8.0,  5.0,  PHASE.PLAN, 'CSV sync, localStorage fix, hash-versioning, workflow auto'],
  ['20.05.2026', '18:05 – 18:16',  1.5,  0.0,  1.5,  PHASE.PLAN, 'Bug-agent, watchdog, hourly schedule'],
];

const totalH    = rows.reduce((s, r) => s + r[2], 0);
const totalWork = rows.reduce((s, r) => s + r[3], 0);
const totalPers = rows.reduce((s, r) => s + r[4], 0);

// ─── COLORS ──────────────────────────────────────────────────────────────
const C = {
  headerBg:   '1F4E79', headerFg: 'FFFFFF',
  appBg:      'D9E8FF', planBg:   'E2EFDA',
  workFg:     '1A5276', persFg:   '78281F',
  totalBg:    'F2F2F2', totalFg:  '000000',
  summBg:     'FFF2CC', summFg:   '7B2D00',
  border:     'BFBFBF',
};

function cell(ws, r, c) { return ws.getCell(r, c); }

function hdr(ws, r, c, txt, bg, fg) {
  const cl = cell(ws, r, c);
  cl.value = txt;
  cl.font  = { bold: true, color: { argb: 'FF' + fg }, name: 'Calibri', size: 11 };
  cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
  cl.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cl.border = {
    top: { style: 'thin', color: { argb: 'FF' + C.border } },
    bottom: { style: 'thin', color: { argb: 'FF' + C.border } },
    left: { style: 'thin', color: { argb: 'FF' + C.border } },
    right: { style: 'thin', color: { argb: 'FF' + C.border } },
  };
}

function numCell(cl, val, fg, bg, bold) {
  cl.value = val;
  cl.numFmt = '0.0';
  cl.font = { bold: !!bold, color: { argb: 'FF' + fg }, name: 'Calibri', size: 11 };
  if (bg) cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
  cl.alignment = { horizontal: 'center', vertical: 'middle' };
  cl.border = { top:{style:'thin',color:{argb:'FFD0D0D0'}}, bottom:{style:'thin',color:{argb:'FFD0D0D0'}}, left:{style:'thin',color:{argb:'FFD0D0D0'}}, right:{style:'thin',color:{argb:'FFD0D0D0'}} };
}

function txtCell(cl, val, fg, bg, bold, wrap) {
  cl.value = val;
  cl.font = { bold: !!bold, color: { argb: 'FF' + fg }, name: 'Calibri', size: 11 };
  if (bg) cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
  cl.alignment = { horizontal: 'left', vertical: 'middle', wrapText: !!wrap };
  cl.border = { top:{style:'thin',color:{argb:'FFD0D0D0'}}, bottom:{style:'thin',color:{argb:'FFD0D0D0'}}, left:{style:'thin',color:{argb:'FFD0D0D0'}}, right:{style:'thin',color:{argb:'FFD0D0D0'}} };
}

// ═══════════════════════════════════════════════════════════════════════════
// SHEET 1 — Daily Detail
// ═══════════════════════════════════════════════════════════════════════════
const ws1 = wb.addWorksheet('По дням', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });

ws1.columns = [
  { key: 'date',    width: 13 },
  { key: 'session', width: 17 },
  { key: 'total',   width: 9  },
  { key: 'work',    width: 11 },
  { key: 'pers',    width: 11 },
  { key: 'phase',   width: 22 },
  { key: 'notes',   width: 50 },
];

// Header row
hdr(ws1, 1, 1, 'Дата',               C.headerBg, C.headerFg);
hdr(ws1, 1, 2, 'Сессия',             C.headerBg, C.headerFg);
hdr(ws1, 1, 3, 'Всего ч',            C.headerBg, C.headerFg);
hdr(ws1, 1, 4, '🏢 Раб 9-17',        C.headerBg, C.headerFg);
hdr(ws1, 1, 5, '🏠 Личное',          C.headerBg, C.headerFg);
hdr(ws1, 1, 6, 'Проект',             C.headerBg, C.headerFg);
hdr(ws1, 1, 7, 'Что делали',         C.headerBg, C.headerFg);
ws1.getRow(1).height = 30;

// Data rows
rows.forEach((r, i) => {
  const [date, session, total, work, pers, phase, notes] = r;
  const rowNum = i + 2;
  const bg = phase === PHASE.APP ? C.appBg : C.planBg;

  txtCell(ws1.getCell(rowNum, 1), date,    '000000', bg, false);
  txtCell(ws1.getCell(rowNum, 2), session, '000000', bg, false);
  numCell(ws1.getCell(rowNum, 3), total,   '000000', bg, true);
  numCell(ws1.getCell(rowNum, 4), work,    C.workFg, bg, false);
  numCell(ws1.getCell(rowNum, 5), pers,    C.persFg, bg, false);
  txtCell(ws1.getCell(rowNum, 6), phase,   '333333', bg, true);
  txtCell(ws1.getCell(rowNum, 7), notes,   '555555', null, false, true);
  ws1.getRow(rowNum).height = 20;
});

// Total row
const totRow = rows.length + 2;
hdr(ws1, totRow, 1, 'ИТОГО',                    C.headerBg, C.headerFg);
hdr(ws1, totRow, 2, `${rows.length} дней`,       C.headerBg, C.headerFg);
const tc = ws1.getCell(totRow, 3);
tc.value = totalH; tc.numFmt = '0.0';
tc.font = { bold:true, color:{argb:'FFFFFFFF'}, name:'Calibri', size:12 };
tc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1F4E79'} };
tc.alignment = { horizontal:'center', vertical:'middle' };
const wc = ws1.getCell(totRow, 4);
wc.value = totalWork; wc.numFmt = '0.0';
wc.font = { bold:true, color:{argb:'FFFFFFFF'}, name:'Calibri', size:12 };
wc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1A5276'} };
wc.alignment = { horizontal:'center', vertical:'middle' };
const pc = ws1.getCell(totRow, 5);
pc.value = totalPers; pc.numFmt = '0.0';
pc.font = { bold:true, color:{argb:'FFFFFFFF'}, name:'Calibri', size:12 };
pc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF78281F'} };
pc.alignment = { horizontal:'center', vertical:'middle' };
ws1.getRow(totRow).height = 28;

ws1.autoFilter = { from: 'A1', to: 'G1' };

// ═══════════════════════════════════════════════════════════════════════════
// SHEET 2 — Summary
// ═══════════════════════════════════════════════════════════════════════════
const ws2 = wb.addWorksheet('Итоги');

function sumHdr(r, c, txt) { hdr(ws2, r, c, txt, C.headerBg, C.headerFg); }

ws2.columns = [
  { width: 28 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 18 },
];

// Title
ws2.mergeCells('A1:E1');
const title = ws2.getCell('A1');
title.value = 'COLUMBUS — Отчёт по затраченному времени';
title.font = { bold: true, size: 16, color: { argb: 'FF1F4E79' }, name: 'Calibri' };
title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDEEAF1' } };
title.alignment = { horizontal: 'center', vertical: 'middle' };
ws2.getRow(1).height = 36;

ws2.mergeCells('A2:E2');
const sub = ws2.getCell('A2');
sub.value = '29 апреля – 20 мая 2026';
sub.font = { italic: true, size: 12, color: { argb: 'FF555555' }, name: 'Calibri' };
sub.alignment = { horizontal: 'center' };
ws2.getRow(2).height = 22;

// By project
sumHdr(4, 1, 'Проект');
sumHdr(4, 2, 'Дней');
sumHdr(4, 3, 'Всего ч');
sumHdr(4, 4, '🏢 Раб ч');
sumHdr(4, 5, '🏠 Личн ч');
ws2.getRow(4).height = 26;

const phases = {};
rows.forEach(r => {
  const p = r[5];
  if (!phases[p]) phases[p] = { days: 0, total: 0, work: 0, pers: 0 };
  phases[p].days++;
  phases[p].total += r[2];
  phases[p].work  += r[3];
  phases[p].pers  += r[4];
});

let pr = 5;
for (const [name, v] of Object.entries(phases)) {
  const bg = name === PHASE.APP ? C.appBg : C.planBg;
  txtCell(ws2.getCell(pr, 1), name,    '000000', bg, true);
  numCell(ws2.getCell(pr, 2), v.days,  '000000', bg, false);
  numCell(ws2.getCell(pr, 3), v.total, '000000', bg, true);
  numCell(ws2.getCell(pr, 4), v.work,  C.workFg, bg, false);
  numCell(ws2.getCell(pr, 5), v.pers,  C.persFg, bg, false);
  ws2.getRow(pr).height = 22;
  pr++;
}
// Total
hdr(ws2, pr, 1, 'ИТОГО', C.headerBg, C.headerFg);
const t2 = ws2.getCell(pr, 3); t2.value = totalH;  t2.numFmt='0.0'; t2.font={bold:true,name:'Calibri',size:12,color:{argb:'FF1F4E79'}}; t2.alignment={horizontal:'center'};
const w2 = ws2.getCell(pr, 4); w2.value = totalWork;w2.numFmt='0.0'; w2.font={bold:true,name:'Calibri',size:12,color:{argb:'FF1A5276'}}; w2.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD6EAF8'}}; w2.alignment={horizontal:'center'};
const p2 = ws2.getCell(pr, 5); p2.value = totalPers;p2.numFmt='0.0'; p2.font={bold:true,name:'Calibri',size:12,color:{argb:'FF78281F'}}; p2.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFDE8E8'}}; p2.alignment={horizontal:'center'};
ws2.getRow(pr).height = 26;
pr += 2;

// Legend / stats block
sumHdr(pr, 1, 'Статистика');
sumHdr(pr, 2, 'Значение');
ws2.getRow(pr).height = 24;
pr++;

const stats = [
  ['Всего часов',                `${totalH.toFixed(1)} ч`],
  ['Рабочих часов (9-17)',       `${totalWork.toFixed(1)} ч  (${Math.round(totalWork/totalH*100)}%)`],
  ['Личного времени',            `${totalPers.toFixed(1)} ч  (${Math.round(totalPers/totalH*100)}%)`],
  ['Самый интенсивный день',     '19 мая — 13 ч'],
  ['Самая поздняя сессия',       '12-13 мая — до 01:15 ночи'],
  ['Дней активной работы',       `${rows.length}`],
  ['Доля планограммы от всего',  `${Math.round(rows.filter(r=>r[5]===PHASE.PLAN).reduce((s,r)=>s+r[2],0)/totalH*100)}%`],
];

for (const [k, v] of stats) {
  txtCell(ws2.getCell(pr, 1), k, '333333', 'FAFAFA', false);
  txtCell(ws2.getCell(pr, 2), v, '1F4E79', 'FAFAFA', true);
  ws2.getRow(pr).height = 20;
  pr++;
}

// ─── Save ─────────────────────────────────────────────────────────────────
const OUT = path.join(__dirname, 'COLUMBUS — Время по проекту.xlsx');
wb.xlsx.writeFile(OUT).then(() => {
  console.log('✅ Сохранено:', OUT);
});
