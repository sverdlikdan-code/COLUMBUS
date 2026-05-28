const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const API = 'http://localhost:3000';

const SKIP_MANAGERS = ['SADRAN+'];
const SKIP_AGENTS   = [];

async function getAgents() {
  const mgrs = await fetch(`${API}/managers`).then(r => r.json());
  const agentSet = new Map();
  for (const mgr of mgrs) {
    const code = mgr.managerCode || mgr.manager;
    if (SKIP_MANAGERS.includes(code)) { console.log(`  ⏭ דילוג על מנהל ${code}`); continue; }
    try {
      const agents = await fetch(`${API}/manager-agents?manager=${encodeURIComponent(code)}`).then(r => r.json());
      for (const a of agents) {
        if (SKIP_AGENTS.includes(String(a.agentCode))) continue;
        agentSet.set(a.agentCode, a.agentName || a.agentCode);
      }
    } catch (_) {}
  }
  return agentSet;
}

async function getCustomersForAgent(agentCode) {
  try {
    const r = await fetch(`${API}/customers?agent=${encodeURIComponent(agentCode)}`);
    return await r.json();
  } catch (_) { return []; }
}

(async () => {
  console.log('📡 Загружаю агентов...');
  const agents = await getAgents();
  console.log(`👥 Найдено ${agents.size} агентов`);

  // Load existing GPS corrections
  const corrFile = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
  let corrections = {};
  try { corrections = JSON.parse(fs.readFileSync(corrFile, 'utf8')); } catch (_) {}

  const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
  function hasGps(c) {
    // Check DB coordinates
    if (c.lat && c.lng && c.lat >= IL.minLat && c.lat <= IL.maxLat) return true;
    // Check corrections file
    const fix = corrections[String(c.custId)];
    if (fix && fix.lat && fix.lat >= IL.minLat) return true;
    return false;
  }

  const noGpsList = [];
  const seen = new Set();

  for (const [agentCode, agentName] of agents) {
    process.stdout.write(`  סוכן ${agentCode}...`);
    const customers = await getCustomersForAgent(agentCode);
    const bad = customers.filter(c => !hasGps(c));
    for (const c of bad) {
      if (seen.has(c.custId)) continue;
      seen.add(c.custId);
      noGpsList.push({ ...c, agentCode, agentName });
    }
    console.log(` ${customers.length} לקוחות, ${bad.length} ללא GPS`);
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n📋 סה"כ ${noGpsList.length} לקוחות ללא GPS`);

  // Sort by city then custId
  noGpsList.sort((a, b) => (a.city || '').localeCompare(b.city || '', 'he') || a.custId - b.custId);

  // ── Build Excel ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('NO GPS');

  ws.columns = [
    { key: 'num',     width: 5  },
    { key: 'custId',  width: 12 },
    { key: 'name',    width: 38 },
    { key: 'city',    width: 16 },
    { key: 'address', width: 36 },
    { key: 'agent',   width: 18 },
    { key: 'status',  width: 12 },
  ];

  // Header
  const hRow = ws.addRow(['#', 'מס. לקוח', 'שם לקוח', 'עיר', 'כתובת', 'סוכן', 'סטטוס']);
  hRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFC9A84C' } } };
  });
  hRow.height = 26;
  ws.autoFilter = { from: 'A1', to: 'G1' };
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  noGpsList.forEach((c, i) => {
    const row = ws.addRow([
      i + 1,
      c.custId,
      c.custName,
      c.city || '',
      c.address || '',
      `${c.agentCode} ${c.agentName || ''}`.trim(),
      c.status || '',
    ]);
    row.height = 20;
    const bg = i % 2 === 0 ? 'FFEBF2FC' : 'FFFFFFFF';
    row.eachCell((cell, cn) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { size: 11, name: 'Calibri' };
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: cn <= 2 ? 'center' : 'right' };
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFD0D9E8' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D9E8' } },
        left:   { style: 'thin', color: { argb: 'FFD0D9E8' } },
        right:  { style: 'thin', color: { argb: 'FFD0D9E8' } },
      };
    });
    // Status color
    const sc = row.getCell(7);
    if (c.status === 'פעיל') {
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
      sc.font = { size: 11, name: 'Calibri', color: { argb: 'FF155724' } };
    }
  });

  // Summary row
  const sumRow = ws.addRow(['', '', `סה"כ: ${noGpsList.length} לקוחות ללא GPS`, '', '', '', '']);
  sumRow.getCell(3).font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF1A3F7C' } };
  sumRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
  sumRow.height = 22;

  const outPath = path.join(__dirname, '..', 'NO GPS — לקוחות ללא קואורדינטות.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('✅ קובץ נשמר:', outPath);
})();
