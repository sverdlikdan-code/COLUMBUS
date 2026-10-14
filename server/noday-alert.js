// noday-alert.js — еженедельный алярм (вс 09:00 Израиль): клиенты без дня визита в Formula Road,
// т.е. корзина «?» приложения — FORMULA + ICE משפחתי, минус клиенты, которых агент перенёс на день в аппе.
// Клиенты и расписание — fetchPbi из route-changes-alert.js, переносы — LIVE_DATA_DIR/route-overrides.json,
// правило дня — lineFor (то же, что /customers). ICE — группа агента FORMULA. Заглушки 920/000 без группы — не шлются.
// Одно письмо всем (пользователь 11.10): сводка по менеджерам, у кого 0 — 🏆 «כל הכבוד» по имени (письмо видят и боссы);
// Excel — все клиенты без дня. Шапка таблиц фиолетовая — не синяя как у остальных алярмов.
// Адресаты (env из run-alert.sh): NODAY_MANAGERS="ALEXEY=a@x;VLAD=b@x" — группы сводки и их менеджеры (To, всегда);
//   NODAY_SUMMARY_TO — ещё To; NODAY_SUMMARY_CC — копия; NODAY_OVERRIDE=<email> — всё на этот адрес (проверка).
// --dry-run: письмо не шлётся, xlsx + html в LIVE_DATA_DIR/noday-preview.
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const ExcelJS = require('exceljs');
const { fetchPbi } = require('./route-changes-alert');
const { lineFor } = require('./coverage');

const DRY_RUN = process.argv.includes('--dry-run');
const LIVE_DATA = process.env.LIVE_DATA_DIR || path.join(__dirname, 'data');
const NO_DAY = 'לא מוגדר';
const PURPLE = '6A1B9A'; // только шапки таблиц (пользователь 11.10: не заливать всё письмо)

// клиенты, которых нет ни в одном дне 1–5 приложения
function noDayClients(map, overrides) {
  const byAgent = new Map();
  for (const c of map.values()) {
    if (!c.agent) continue;
    if (!byAgent.has(c.agent)) byAgent.set(c.agent, []);
    byAgent.get(c.agent).push(c);
  }
  const out = [];
  for (const [agent, clients] of byAgent) {
    const moves = overrides[agent]?.dayMoves || {};
    const scheduled = clients.flatMap(c => c.sched.map(s => ({ custId: c.id, dayNum: s.dayNum })));
    const inDay = new Set();
    for (let d = 1; d <= 5; d++) {
      for (const id of lineFor({ scheduled, dayMoves: moves, dayNum: d, movedInOk: id => map.get(id)?.agent === agent })) inDay.add(id);
    }
    out.push(...clients.filter(c => !inDay.has(c.id)));
  }
  return out;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + argb } });
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const border = { top: thin, bottom: thin, left: thin, right: thin };

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ללא יום ביקור', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: "מס' לקוח", key: 'id', width: 11 },
    { header: 'שם לקוח', key: 'name', width: 40 },
    { header: 'סוכן', key: 'agent', width: 24 },
    { header: 'מנהל', key: 'manager', width: 22 },
    { header: 'יום', key: 'day', width: 11 },
  ];
  ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(PURPLE); c.border = border; c.alignment = { horizontal: 'center' }; });
  for (const r of rows) {
    const row = ws.addRow({ id: Number(r.id) || r.id, name: r.name, agent: r.agentName, manager: MANAGER_HE[r.manager] || r.manager, day: NO_DAY });
    row.eachCell(c => { c.border = border; c.alignment = { horizontal: c.col === 2 || c.col === 3 ? 'right' : 'center' }; });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };
  return wb.xlsx.writeBuffer();
}

// Сводка: строка на менеджера. Ноль — похвала: менеджер планирует линии агентов
// и следит за покрытием (пользователь 11.10). Имя менеджера — nameHe из managers.json по team.
const MANAGER_HE = Object.fromEntries(require('./data/managers.json').filter(m => m.team).map(m => [m.team, m.nameHe || m.name]));
// «לאלכסי ברילוב», «לX ולY», «לX, לY ולZ»
const praiseNames = names => {
  const n = names.map(x => `<span style="white-space:nowrap">ל${esc(x)}</span>`);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} ו${n[n.length - 1]}` : n[0];
};
function buildSummaryHtml(teams, dateStr) {
  const th = `style="background:#${PURPLE};color:#fff;padding:6px 10px;text-align:center"`;
  const cell = 'padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top';
  const total = teams.reduce((n, t) => n + t.rows.length, 0);
  const sorted = [...teams].sort((a, b) => b.rows.length - a.rows.length);
  const stars = teams.filter(t => !t.rows.length).map(t => MANAGER_HE[t.groups] || t.groups);
  // плашка 🏆 — только если хоть у одной команды не ноль: при нуле у всех похвала всем обесценивается (пользователь 11.10)
  const showStars = stars.length > 0 && stars.length < teams.length;
  const detail = t => {
    if (!t.rows.length) return '<span style="font-size:22px">🏆</span> <span style="color:#2e7d32;font-weight:bold;font-size:15px">כל הלקוחות משובצים ליום ביקור</span><br><span style="color:#2e7d32;font-size:13px">כל הכבוד על תכנון הקווים וביצוע הפיזור</span>';
    const by = new Map();
    for (const r of t.rows) by.set(r.agentName, (by.get(r.agentName) || 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${esc(n)} — ${k}`).join('<br>');
  };
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0"><div dir="rtl" style="font-family:Arial,sans-serif;color:#111;max-width:700px;margin:0 auto;padding:16px;box-sizing:border-box">
<h2 style="margin:0 0 8px">📅 לקוחות ללא יום ביקור — ${dateStr}</h2>
${showStars ? `<div style="background:#e8f5e9;border:2px solid #2e7d32;border-radius:10px;padding:14px 16px;margin:0 0 16px;text-align:center">
<div style="font-size:34px;line-height:1.2">🏆</div>
<div style="font-size:20px;font-weight:bold;color:#1b5e20;margin:4px 0 6px">כל הכבוד ${praiseNames(stars)}!</div>
<div style="font-size:14px;color:#2e7d32">כל הלקוחות ${stars.length > 1 ? 'בקבוצות' : 'בקבוצה'} משובצים ליום ביקור — תכנון קווי הסוכנים וביצוע פיזור מלא.</div>
</div>` : ''}
<p style="margin:0 0 12px">סיכום לפי מנהלים: לקוחות שאין להם יום ביקור באפליקציה <bdi>Formula Road</bdi> (<bdi>FORMULA</bdi> ו-<bdi>ICE</bdi> משפחתי). הרשימה המלאה (מס' לקוח, שם, סוכן, מנהל) — בקובץ האקסל המצורף.</p>
<table style="border-collapse:collapse;font-size:13px;width:100%">
<tr><th ${th}>מנהל</th><th ${th}>ללא יום</th><th ${th}>פירוט לפי סוכן</th></tr>
${sorted.map(t => `<tr${t.rows.length ? '' : ' style="background:#f1f8e9"'}><td style="${cell};text-align:right;white-space:nowrap"><b>${esc(MANAGER_HE[t.groups] || t.groups)}</b></td><td style="${cell};text-align:center;font-size:15px"><b>${t.rows.length}</b></td><td style="${cell};text-align:right">${detail(t)}</td></tr>`).join('\n')}
<tr><td style="${cell};text-align:right"><b>סה"כ</b></td><td style="${cell};text-align:center"><b>${total}</b></td><td style="${cell}"></td></tr>
</table>
<p style="color:#777;font-size:12px;margin-top:24px">דוח שבועי אוטומטי. הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.</p>
</div></body></html>`;
}

async function main() {
  const overrides = JSON.parse(fs.readFileSync(path.join(LIVE_DATA, 'route-overrides.json'), 'utf8'));
  const { formula, ice } = await fetchPbi();
  const group = new Map(), names = new Map();
  for (const c of formula.values()) {
    if (c.manager && !group.has(c.agent)) group.set(c.agent, c.manager);
    if (!names.has(c.agent)) names.set(c.agent, c.agentName);
  }
  const rows = [...noDayClients(formula, overrides), ...noDayClients(ice, overrides)]
    .map(c => ({ id: c.id, name: c.name, agent: c.agent, agentName: names.get(c.agent) || c.agent, manager: c.manager || group.get(c.agent) || '' }))
    .sort((a, b) => a.manager.localeCompare(b.manager) || a.agentName.localeCompare(b.agentName, 'he') || a.id.localeCompare(b.id));
  const stat = {};
  for (const r of rows) stat[r.manager || '(без группы)'] = (stat[r.manager || '(без группы)'] || 0) + 1;
  console.log('без дня по группам:', JSON.stringify(stat));

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const dateStr = today.split('-').reverse().join('.');
  const list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
  const subject = `📅 לקוחות ללא יום ביקור — ${dateStr}`;

  // одно письмо всем (пользователь 11.10): все менеджеры групп (даже с нулём) + NODAY_SUMMARY_TO, копия NODAY_SUMMARY_CC
  const teams = [], managerEmails = [];
  for (const part of (process.env.NODAY_MANAGERS || '').split(';').filter(Boolean)) {
    const [groups, email] = part.split('=').map(s => s.trim());
    const gs = new Set(groups.split(',').map(s => s.trim()));
    teams.push({ groups, rows: rows.filter(r => gs.has(r.manager)) });
    if (email) managerEmails.push(email);
  }
  const mails = [{ tag: 'summary', to: [...managerEmails, ...list(process.env.NODAY_SUMMARY_TO)], cc: list(process.env.NODAY_SUMMARY_CC),
    rows: teams.flatMap(t => t.rows), html: buildSummaryHtml(teams, dateStr) }];

  const override = (process.env.NODAY_OVERRIDE || '').trim();
  if (!DRY_RUN && !process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = DRY_RUN ? null : new Resend(process.env.RESEND_API_KEY);
  let failed = 0, sent = 0;
  for (const m of mails) {
    const xlsx = Buffer.from(await buildXlsx(m.rows));
    if (DRY_RUN) {
      const dir = path.join(LIVE_DATA, 'noday-preview');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `noday-${m.tag}.xlsx`), xlsx);
      fs.writeFileSync(path.join(dir, `noday-${m.tag}.html`), m.html);
      console.log(`  [dry] ${m.tag}: ${m.rows.length} -> ${m.to.join(',')} cc ${m.cc.join(',')}`);
      continue;
    }
    let { to, cc } = m, subj = subject;
    if (override) { console.log(`  OVERRIDE ${m.tag}: шло бы -> ${[...to, ...cc].join(', ')}`); subj = `[בדיקה ${m.tag}] ${subj}`; to = [override]; cc = []; }
    const res = await resend.emails.send({
      from: `Diler Intelligence <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to, ...(cc.length ? { cc } : {}), subject: subj, html: m.html,
      attachments: [{ filename: `lakochot-lelo-yom-${today}.xlsx`, content: xlsx.toString('base64') }],
    });
    if (res.error) { failed++; console.error(`  FAIL ${m.tag}:`, JSON.stringify(res.error)); }
    else { sent++; console.log(`  OK id=${res.data?.id} ${m.tag}: ${m.rows.length} -> ${to.join(',')}${cc.length ? ' cc ' + cc.join(',') : ''}`); }
    await new Promise(r => setTimeout(r, 600)); // Resend: 2 req/s
  }
  if (DRY_RUN) console.log('--dry-run — письма не отправлены');
  if (failed) throw new Error(`${failed} писем не ушли (ушло ${sent})`);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
