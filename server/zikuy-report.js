// zikuy-report.js — ежемесячный отчёт "Списания товаров — частный рынок и небольшие сети"
// (зикуй Formula Road: −50% / השמדה). Запускается 1-го числа из /root/run-alert.sh
// (VPS cron) за прошлый месяц. Структура утверждена пользователем 2026-09-29, формат —
// только письмо (без вложений).
//
// Источники (живые, не из git — в /root/alerts-run их нет, путь через LIVE_DATA_DIR):
//   blank-history.json — сами бланки зикуя (items: sku/name/qty/option), хранится 92 дня
//   events.db          — zikuy_form_started/submitted/abandoned → время заполнения
// Из git (docs/): product-data.json + *-base.json → семья (fam) и срок годности,
//   formula-road-data.json → имена агентов.
//
// Методика времени (подтверждена 2026-09-10/29): пара = последний started для той же
// пары (агент|клиент) → submitted; abandoned сбрасывает. >30 мин — форма висела открытой,
// в статистику времени не входит. Экономия = зикуев × (10 мин − медиана) × 1.10 (+10% админ. ошибок с офисом), только медиана,
// без среднего (пользователь 2026-09-29) — 10 мин это нижняя оценка ручного бланка до приложения.
//
// Usage: node zikuy-report.js [--month=YYYY-MM] [--dry-run] [--to=a@b.com]
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const DATA = process.env.LIVE_DATA_DIR || path.join(__dirname, 'data');
const DOCS = path.join(__dirname, '..', 'docs');
const BASELINE_S = 600, LONG_S = 1800, ADMIN_BONUS = 0.10;

const NAVY = '#1C3D6B', GOLD = '#C9A227', INK = '#1F2937', MUTED = '#6B7280', LINE = '#E5E7EB', PAPER = '#F4F6FA', RED = '#B91C1C', GREEN = '#15803D';
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const ilMonth = iso => new Date(Date.parse(iso)).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);
function prevMonth(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const med = v => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const avg = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const n0 = x => Math.round(x).toLocaleString('en-US');
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── справочники ─────────────────────────────────────────────────────────────
function loadCatalog() {
  const fam = {}, shelf = {};
  const pd = readJson(path.join(DOCS, 'product-data.json'));
  for (const [k, v] of Object.entries(pd.products || pd)) { if (v?.fam) fam[k] = v.fam; if (v?.shelfLife != null) shelf[k] = v.shelfLife; }
  for (const f of ['kapua-base', 'halavi-base', 'dagim-base', 'dagim-yavesh-base']) {
    try {
      const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.makat && o.fam && !fam[o.makat]) fam[o.makat] = o.fam; Object.values(o).forEach(walk); } };
      walk(readJson(path.join(DOCS, f + '.json')));
    } catch (_) { /* файла нет — просто меньше покрытие */ }
  }
  // ICE (502xxx/503xxx) нет в каталоге планограммы FORMULA — это мишпахти (пользователь 2026-09-29)
  const famOf = sku => fam[sku] || (/^50[23]\d{3}$/.test(sku) ? 'ICE מוצרים משפחתיים' : '—');
  return { famOf, shelf };
}
function loadAgentNames() {
  const names = {};
  try { const x = readJson(path.join(DOCS, 'formula-road-data.json')); for (const arr of Object.values((x.data || x).agentsByManager || {})) for (const a of arr) names[a.agentCode] = a.agentName; } catch (_) {}
  try { for (const m of readJson(path.join(DATA, 'managers.json'))) names['M:' + m.id] = m.nameHe || m.name; } catch (_) {}
  return names;
}

// ── время заполнения из events.db ───────────────────────────────────────────
function loadTimings(month) {
  const D = require('better-sqlite3');
  const db = new D(path.join(DATA, 'events.db'), { readonly: true });
  const rows = db.prepare(`select ts, event_type e, agent_code a, manager_id m, cust_id c, json_extract(props,'$.itemCount') ic
    from events where event_type in ('zikuy_form_started','zikuy_form_submitted','zikuy_form_abandoned') order by ts`).all();
  db.close();
  const open = {}, pairs = [];
  let submitted = 0, unattributed = 0, unpaired = 0;
  for (const r of rows) {
    const who = r.a || (r.m ? 'M:' + r.m : null);
    const inMonth = ilMonth(r.ts) === month;
    if (!who) { if (inMonth && r.e === 'zikuy_form_submitted') unattributed++; continue; }
    const k = who + '|' + r.c;
    if (r.e === 'zikuy_form_started') open[k] = r.ts;
    else if (r.e === 'zikuy_form_abandoned') delete open[k];
    else {
      if (inMonth) submitted++;
      if (open[k]) { if (inMonth) pairs.push({ who, s: (Date.parse(r.ts) - Date.parse(open[k])) / 1000, items: r.ic }); delete open[k]; }
      else if (inMonth) unpaired++;
    }
  }
  return { pairs, submitted, unattributed, unpaired };
}

// ── агрегация ───────────────────────────────────────────────────────────────
function summarize(blanks, famOf, shelf) {
  const t = { blanks: blanks.length, z: 0, h: 0, lines: 0, skuPerBlank: [], onlyZ: 0, onlyH: 0, mixed: 0 };
  const fam = {}, sku = {}, cust = {}, agent = {};
  for (const e of blanks) {
    let hz = false, hh = false;
    t.skuPerBlank.push(new Set(e.items.map(i => i.sku)).size);
    const a = agent[e.agentCode] = agent[e.agentCode] || { name: e.agentName, blanks: 0, skus: [], qty: 0 };
    a.blanks++; a.skus.push(new Set(e.items.map(i => i.sku)).size);
    const c = cust[e.custId] = cust[e.custId] || { name: e.custName, city: e.city, qty: 0, blanks: 0 };
    c.blanks++;
    for (const it of e.items) {
      const q = Number(it.qty) || 0, isZ = it.option === '-50%';
      if (isZ) { t.z += q; hz = true; } else { t.h += q; hh = true; }
      t.lines++; a.qty += q; c.qty += q;
      const f = fam[famOf(it.sku)] = fam[famOf(it.sku)] || { z: 0, h: 0, custs: new Set() };
      f[isZ ? 'z' : 'h'] += q; f.custs.add(e.custId);
      const s = sku[it.sku] = sku[it.sku] || { name: it.name, fam: famOf(it.sku), shelf: shelf[it.sku], z: 0, h: 0, custs: new Set() };
      s[isZ ? 'z' : 'h'] += q; s.custs.add(e.custId);
    }
    if (hz && hh) t.mixed++; else if (hz) t.onlyZ++; else t.onlyH++;
  }
  t.total = t.z + t.h;
  return { t, fam, sku, cust, agent };
}

// ── HTML ────────────────────────────────────────────────────────────────────
const H = (title, sub = '') => `
  <tr><td style="padding:26px 24px 8px">
    <div style="font-family:Georgia,serif;font-size:17px;color:${NAVY};font-weight:bold;display:inline-block;border-bottom:2px solid ${GOLD};padding-bottom:4px">${title}</div>
    ${sub ? `<div style="font-size:12px;color:${MUTED};padding-top:6px">${sub}</div>` : ''}
  </td></tr>`;
function table(head, rows, alignRight = []) {
  const th = head.map((h, i) => `<th style="padding:7px 4px;background:${NAVY};color:#fff;font-size:10px;font-weight:bold;text-align:${alignRight.includes(i) ? 'right' : 'left'}">${h}</th>`).join('');
  const tr = rows.map((r, ri) => `<tr>${r.map((c, i) => `<td ${i === 0 ? 'dir="auto"' : ''} style="padding:6px 4px;border-bottom:1px solid ${LINE};background:${ri % 2 ? '#FAFBFD' : '#fff'};font-size:11px;color:${INK};text-align:${alignRight.includes(i) ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('');
  return `<tr><td style="padding:0 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE};border-radius:8px;overflow:hidden;font-family:Arial,sans-serif">${th}${tr}</table></td></tr>`;
}
const P = html => `<tr><td style="padding:4px 24px;font-size:13px;color:${INK};line-height:1.6">${html}</td></tr>`;
const kpi = (label, value, sub = '') => `<td style="padding:12px 8px;text-align:center;border:1px solid ${LINE};background:#fff;width:25%">
  <div style="font-size:11px;color:${MUTED}">${label}</div><div style="font-size:20px;font-weight:900;color:${NAVY};padding-top:4px">${value}</div>${sub ? `<div style="font-size:11px;color:${MUTED};padding-top:2px">${sub}</div>` : ''}</td>`;
const delta = (cur, prev) => { if (!prev) return ''; const d = Math.round(100 * (cur - prev) / prev); return `<span style="color:${d > 0 ? RED : GREEN}">${d > 0 ? '+' : ''}${d}% к пр. месяцу</span>`; };

function buildHtml(month, cur, prev, tm, names) {
  const { t, fam, sku, cust, agent } = cur;
  const [y, m] = month.split('-').map(Number);
  const title = `${MONTHS_RU[m - 1]} ${y}`;

  // 1. итог
  let html = H('1. Итог месяца') + `<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif"><tr>
    ${kpi('Бланков зикуя', n0(t.blanks), delta(t.blanks, prev?.t.blanks))}
    ${kpi('Штук всего', n0(t.total), delta(t.total, prev?.t.total))}
    ${kpi('−50%', n0(t.z), `${pct(t.z, t.total)}%`)}
    ${kpi('השמדה', n0(t.h), `${pct(t.h, t.total)}%`)}
  </tr></table></td></tr>`;
  html += P(`В среднем <b>${avg(t.skuPerBlank).toFixed(1)}</b> артикула на бланк (медиана ${med(t.skuPerBlank)}), ${avg(blanksQty(cur)).toFixed(0)} шт. на бланк. Состав бланков: только −50% — ${t.onlyZ}, только השמדה — ${t.onlyH}, смешанные — ${t.mixed}.`
    + (prev ? ` Прошлый месяц: ${n0(prev.t.total)} шт., השמדה ${pct(prev.t.h, prev.t.total)}%.` : ''));

  // 2. семьи
  const fams = Object.entries(fam).sort((a, b) => (b[1].z + b[1].h) - (a[1].z + a[1].h));
  html += H('2. Семьи товаров', 'по штукам; доля השמדה ≥ 70% — красным (уценка не спасает)');
  html += table(['Семья', 'Штук', 'Доля', '−50%', 'השמדה', '% השמדה', 'Клиентов'],
    fams.slice(0, 15).map(([k, f]) => { const tot = f.z + f.h, hp = pct(f.h, tot); return [esc(k), n0(tot), pct(tot, t.total) + '%', n0(f.z), n0(f.h), `<b style="color:${hp >= 70 ? RED : INK}">${hp}%</b>`, f.custs.size]; }), [1, 2, 3, 4, 5, 6]);

  // 3. SKU
  const skus = Object.entries(sku).sort((a, b) => (b[1].z + b[1].h) - (a[1].z + a[1].h));
  const top10 = skus.slice(0, 10), top10q = top10.reduce((a, [, s]) => a + s.z + s.h, 0);
  html += H('3. Топ-10 артикулов', `вместе — ${pct(top10q, t.total)}% всех штук`);
  html += table(['Артикул', 'Семья', 'Штук', '% השמדה', 'Срок, дн', 'Клиентов'],
    top10.map(([k, s]) => [`${k} · ${esc(s.name.slice(0, 32))}`, esc(s.fam), n0(s.z + s.h), pct(s.h, s.z + s.h) + '%', s.shelf ?? '—', s.custs.size]), [2, 3, 4, 5]);

  // 4. закономерности
  const bucket = {}; for (const [, s] of skus) { const k = s.shelf == null ? 'нет данных' : s.shelf <= 30 ? 'до 30 дн' : s.shelf <= 60 ? '31–60 дн' : 'больше 60 дн'; const b = bucket[k] = bucket[k] || { z: 0, h: 0, n: 0 }; b.z += s.z; b.h += s.h; b.n++; }
  // иврит внутри русской фразы переставляет слова (BiDi) — каждая семья отдельной строкой в <bdi>
  const famLines = list => list.length ? list.map(([k, f]) => `<br>• <bdi>${esc(k)}</bdi> — ${pct(f.h, f.z + f.h)}% в уничтожение, ${n0(f.z + f.h)} шт.`).join('') : '<br>• нет';
  html += H('4. Закономерности');
  html += P(`<b>Уценка не спасает</b> — больше 70% уходит в уничтожение (от 20 шт.):${famLines(fams.filter(([, f]) => f.z + f.h >= 20 && pct(f.h, f.z + f.h) >= 70))}`);
  html += P(`<b>Уценка работает</b> — не больше 30% в уничтожение (от 100 шт.):${famLines(fams.filter(([, f]) => f.z + f.h >= 100 && pct(f.h, f.z + f.h) <= 30))}`);
  html += table(['Срок годности', 'Артикулов', 'Штук', '% השמדה'],
    ['до 30 дн', '31–60 дн', 'больше 60 дн', 'нет данных'].filter(k => bucket[k]).map(k => [k, bucket[k].n, n0(bucket[k].z + bucket[k].h), pct(bucket[k].h, bucket[k].z + bucket[k].h) + '%']), [1, 2, 3]);

  // 5. клиенты
  const cs = Object.values(cust).sort((a, b) => b.qty - a.qty);
  const share = k => pct(cs.slice(0, k).reduce((a, c) => a + c.qty, 0), t.total);
  html += H('5. Клиенты', `всего ${cs.length} клиентов · топ-10 = ${share(10)}% штук · топ-50 = ${share(50)}%`);
  html += table(['Клиент', 'Штук', 'Бланков'], cs.slice(0, 10).map(c => [esc(c.name), n0(c.qty), c.blanks]), [1, 2]);

  // 6. агенты + время
  const short = tm.pairs.filter(p => p.s <= LONG_S), long = tm.pairs.length - short.length;
  // Экономия только по медиане (решение пользователя 2026-09-29): зикуев × (10 мин − медиана).
  const byWho = {}; for (const p of short) (byWho[p.who] = byWho[p.who] || []).push(p.s);
  // +10% — администрирование ошибок/неточностей с офисом, которых с приложением на порядок меньше (пользователь 2026-09-29)
  const savedS = v => v.length * Math.max(0, BASELINE_S - med(v)) * (1 + ADMIN_BONUS);
  const savedH = savedS(short.map(p => p.s)) / 3600;
  html += H('6. Агенты и время', `экономия = зикуев × (10 мин на ручной бланк − медиана) + ${ADMIN_BONUS * 100}% на администрирование ошибок и неточностей с офисом (из них ${(savedH - savedH / (1 + ADMIN_BONUS)).toFixed(1)} ч); ${long} зикуев дольше 30 мин (форма висела открытой) не учтены`);
  html += `<tr><td style="padding:0 24px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif"><tr>
    ${kpi('Сэкономлено', savedH.toFixed(1) + ' ч')}
    ${kpi('Медиана зикуя', mmss(med(short.map(p => p.s))))}
    ${kpi('Зикуев со временем', short.length)}
    ${kpi('Агентов', Object.keys(agent).length)}
  </tr></table></td></tr>`;
  html += table(['Агент', 'Бланков', 'Артикулов ⌀', 'Штук', 'Медиана', 'Сэкономлено'],
    Object.entries(agent).sort((a, b) => b[1].blanks - a[1].blanks).map(([code, a]) => [esc(a.name || names[code] || code), a.blanks, avg(a.skus).toFixed(1), n0(a.qty), byWho[code] ? mmss(med(byWho[code])) : '—', byWho[code] ? (savedS(byWho[code]) / 3600).toFixed(1) + ' ч' : '—']), [1, 2, 3, 4, 5]);
  const buckets = [[1, 1], [2, 3], [4, 6], [7, 10], [11, 999]].map(([a, b]) => { const s = short.filter(p => p.items >= a && p.items <= b).map(p => p.s); return s.length ? [b === 999 ? `${a}+` : a === b ? `${a}` : `${a}–${b}`, s.length, mmss(med(s))] : null; }).filter(Boolean);
  html += P('<span style="font-size:12px;color:' + MUTED + '">Время по размеру бланка:</span>');
  html += table(['Артикулов в бланке', 'Зикуев', 'Медиана времени'], buckets, [1, 2]);

  // 7. качество данных
  html += H('7. Качество данных');
  html += P(`<span style="font-size:12px;color:${MUTED}">Отправлено по журналу событий: ${tm.submitted}; со временем: ${tm.pairs.length}; без записи об открытии формы: ${tm.unpaired}; без привязки к агенту: ${tm.unattributed}. Бланков в истории: ${t.blanks}, из них без времени заполнения: ${Math.max(0, t.blanks - tm.pairs.length)} (время пишется с 07.09.2026). Семья не найдена: ${n0((fam['—']?.z || 0) + (fam['—']?.h || 0))} шт.</span>`);

  return { subject: `Списания товаров — частный рынок и небольшие сети · ${title}`, html: `<!doctype html>
<html lang="ru"><body style="margin:0;padding:24px 12px;background:${PAPER};font-family:Arial,sans-serif">
<table role="presentation" align="center" width="720" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${LINE}">
  <tr><td style="background:${NAVY};padding:30px 24px 24px;text-align:center">
    <img src="cid:diler-logo-white" width="72" height="72" alt="DILER B.M.D" style="display:block;margin:0 auto 14px" />
    <div style="font-size:22px;font-weight:900;color:#fff">Списания товаров</div>
    <div style="padding-top:6px;font-size:13px;color:#AFC1DC">частный рынок и небольшие сети · зикуй Formula Road</div>
    <div style="padding-top:10px;font-size:12px;color:${GOLD};letter-spacing:.5px">ежемесячный отчёт · ${title}</div>
  </td></tr>
  ${html}
  <tr><td style="padding:20px 24px 24px;font-size:11px;color:${MUTED};border-top:1px solid ${LINE}">Автоотчёт COLUMBUS · 1-го числа каждого месяца за прошлый месяц.</td></tr>
</table></body></html>` };
}
function blanksQty(cur) { return cur._blanks.map(e => e.items.reduce((a, i) => a + (Number(i.qty) || 0), 0)); }

async function main() {
  const month = arg('month') || prevMonth(ilMonth(new Date().toISOString()));
  const { famOf, shelf } = loadCatalog();
  const names = loadAgentNames();
  const all = readJson(path.join(DATA, 'blank-history.json'));
  const pick = ym => all.filter(e => ilMonth(e.ts) === ym);
  const curBlanks = pick(month), prevBlanks = pick(prevMonth(month));
  if (!curBlanks.length) { console.log(`Нет бланков за ${month} — письмо не отправлено.`); return; }
  const cur = Object.assign(summarize(curBlanks, famOf, shelf), { _blanks: curBlanks });
  // blank-history хранит 92 дня — прошлый месяц сравниваем, только если он в истории целиком
  const prev = prevBlanks.length && all[0] && ilMonth(all[0].ts) < prevMonth(month) ? summarize(prevBlanks, famOf, shelf) : null;
  const tm = loadTimings(month);
  const { subject, html } = buildHtml(month, cur, prev, tm, names);
  console.log(`${subject}: бланков ${cur.t.blanks}, штук ${Math.round(cur.t.total)}, пар со временем ${tm.pairs.length}`);

  if (DRY_RUN) {
    const out = path.join(__dirname, '..', '.scratch', `zikuy-report-${month}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html.replace('cid:diler-logo-white', path.join(DOCS, 'logo-diler-bmd-white.png')));
    console.log('--dry-run — письмо не отправлено, превью:', out);
    return;
  }
  const to = (arg('to') || process.env.ZIKUY_REPORT_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) throw new Error('ZIKUY_REPORT_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const { Resend } = require('resend');
  const logo = path.join(DOCS, 'logo-diler-bmd-white.png');
  const res = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to, subject, html,
    attachments: fs.existsSync(logo) ? [{ filename: 'logo-white.png', content: fs.readFileSync(logo).toString('base64'), contentId: 'diler-logo-white' }] : [],
  });
  console.log('Отправлено:', JSON.stringify(res));
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
