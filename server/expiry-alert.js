// expiry-alert.js — ежедневный алярм "דוח תוקף" (סכנה + STOP SALE) из редактора махсана.
// Карточки не пересобираются на сервере — Puppeteer открывает тот же docs/planogram-editor.html
// (данные — локальные JSON из docs/, их пересобирает planogram-build.yml), включает фильтр סכנה
// в режиме מאוחד и снимает каждую карточку картинкой. Письмо = эти картинки в 2 колонки,
// поэтому выглядит как в аппе в любом почтовике и нормально печатается.
// Пробовали page.pdf() с print-раскладкой 2×2 — в headless она разваливается (2026-09-28).
// Письмо уходит только если есть хотя бы одна карточка סכנה/STOP SALE.
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const { Resend } = require('resend');

const DRY_RUN = process.argv.includes('--dry-run');
// Разовая приписка под приветствием — workflow_dispatch input `note` (напр. при внеплановой рассылке).
const NOTE = (process.env.EXPIRY_ALERT_NOTE || '').replace(/[<>&]/g, '').trim();
const DOCS = path.join(__dirname, '..', 'docs');

const NAVY = '#1C3D6B';
const GOLD = '#B8863B';
const INK = '#2A2620';
const MUTED = '#6B7280';
const PAPER = '#FAF7F2';
const LINE = '#E5E0D8';

const RECIPIENT_NAMES = {
  'lena@dilerbmd.com': 'לנה',
  'polina.k@dilerbmd.com': 'פולינה',
  'yosiel@dilerbmd.com': 'יוסי',
  'dima@dilerbmd.com': 'דימה',
  'maxim@dilerbmd.com': 'מקסים',
  'd.sverdlik@dilerbmd.com': 'דן',
};

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

async function shootCards() {
  const srv = http.createServer((req, res) => {
    const p = path.join(DOCS, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(DOCS) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => srv.listen(0, r));
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    // Обычный Chrome UA — HeadlessChrome внешние сервисы (фото Priority) могут резать.
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36');
    await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${srv.address().port}/planogram-editor.html`, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.evaluate(() => {
      document.getElementById('app-splash')?.remove();
      document.getElementById('mahsan-login-modal')?.remove();
      toggleExpiryPage();
      if (!window._expiryOnlySakana) toggleSakanaFilter();
      document.querySelectorAll('#expiry-grid button').forEach(b => b.remove()); // "×" скрыть карточку
    });
    await page.evaluate(() => new Promise(r => {
      const imgs = [...document.images].filter(i => !i.complete);
      if (!imgs.length) return r();
      let n = imgs.length;
      imgs.forEach(i => { i.onload = i.onerror = () => { if (--n === 0) r(); }; });
      setTimeout(r, 20000);
    }));
    // Спарклайн продаж по неделям в аппе виден только при печати (.spark-only-print) — включить
    // его и в экранном режиме. Print-медиа целиком не эмулируем: она растягивает карточку на всю ширину.
    await page.addStyleTag({ content: '.spark-only-print{display:block!important}' });
    const SEL = '#expiry-grid > div:not(.expiry-sec-hdr):not(.grid-page-break):not(.expiry-haluka-sep)';
    // В письме карточки идут парами (строка из 2) — выровнять высоту пары, иначе низ строки
    // рваный (пользователь 2026-09-28).
    await page.evaluate(sel => {
      const cs = [...document.querySelectorAll(sel)];
      for (let i = 0; i < cs.length; i += 2) {
        const pair = cs.slice(i, i + 2);
        const h = Math.max(...pair.map(c => c.offsetHeight));
        pair.forEach(c => { c.style.boxSizing = 'border-box'; c.style.minHeight = h + 'px'; });
      }
    }, SEL);
    // Имя + "עלות לזריקה" каждой карточки — прямо из DOM, те же числа что на картинке.
    const risks = await page.$$eval(SEL, cs => cs.map(c => {
      const costDiv = [...c.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('עלות לזריקה'));
      const nameDiv = c.querySelector('div[style*="font-size:10px;font-weight:bold"]');
      return { name: nameDiv ? nameDiv.textContent.trim() : '', cost: costDiv ? +costDiv.textContent.replace(/[^\d]/g, '') : 0 };
    }));
    const cards = await page.$$(SEL);
    const shots = [];
    for (const c of cards) shots.push(Buffer.from(await c.screenshot({ type: 'png' })));
    if (shots.length === 0) return { shots, pdf: null, risks };

    // PDF для печати — из тех же картинок, 4 карточки на A4 (2×2). Своя простая вёрстка,
    // не print-CSS редактора: тот в headless разваливается.
    const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
    const pages = [];
    for (let i = 0; i < shots.length; i += 4) {
      const cells = shots.slice(i, i + 4).map(b => `<div><img src="data:image/png;base64,${b.toString('base64')}"></div>`).join('');
      pages.push(`<section><header>דוח תוקף — FORMULA &middot; ${date}</header><main>${cells}</main></section>`);
    }
    await page.emulateMediaType('print');
    await page.setContent(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
      @page{size:A4;margin:8mm} body{margin:0;font-family:Arial,sans-serif}
      section{height:280mm;display:flex;flex-direction:column;page-break-after:always}
      section:last-child{page-break-after:auto}
      header{font-size:11pt;font-weight:bold;color:#1C3D6B;padding-bottom:3mm}
      main{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto auto;align-content:start;gap:6mm;min-height:0}
      img{display:block;width:100%;height:auto}
    </style></head><body>${pages.join('')}</body></html>`, { waitUntil: 'load' });
    const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    return { shots, pdf, risks };
  } finally {
    await browser.close();
    srv.close();
  }
}

const fmtILS = v => '₪' + Math.round(v).toLocaleString('en-US');

// Общая сумма риска + Парето: топ товаров, дающих первые 70% потерь (товар, пересекающий
// порог, включается). Пользователь 2026-09-28.
function riskSummary(risks) {
  const withCost = risks.filter(r => r.cost > 0).sort((a, b) => b.cost - a.cost);
  const total = withCost.reduce((s, r) => s + r.cost, 0);
  const top = [];
  let acc = 0;
  for (const r of withCost) { if (acc >= total * 0.7) break; top.push(r); acc += r.cost; }
  return { total, top, topSum: acc, noCost: risks.length - withCost.length };
}

// Outlook (Word-движок) игнорирует CSS direction/unicode-bidi — "₪149,458" внутри ивритской
// строки разворачивался в "458₪149,". Явные LRE…PDF вокруг суммы держат порядок везде.
const ltr = s => `&#x202A;${s}&#x202C;`;

// Рамка/фон — на ячейке таблицы, не на div: Outlook рисует фон div только частично
// (список выпадал из розового блока, 2026-09-28).
function buildRiskHtml({ total, top, topSum, noCost }) {
  if (!total) return '';
  const items = top.map((r, i) => `<tr>
      <td style="padding:5px 0;font-size:14px;color:${INK};width:24px;vertical-align:top">${i + 1}.</td>
      <td style="padding:5px 0;font-size:14px;color:${INK}">${r.name}</td>
      <td align="left" style="padding:5px 0 5px 4px;font-size:14px;font-weight:bold;color:#b71c1c;text-align:left;white-space:nowrap">${ltr(fmtILS(r.cost))}</td>
    </tr>`).join('');
  return `<tr><td dir="rtl" style="padding:8px 28px 6px;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td bgcolor="#FFF5F5" style="background-color:#FFF5F5;border:2px solid #c62828;border-radius:10px;padding:14px 18px;text-align:right">
        <div style="font-size:16px;font-weight:900;color:${INK}">סה"כ סיכון (עלות לזריקה צפויה): <span style="color:#b71c1c">${ltr(fmtILS(total))}</span></div>
        <div style="padding-top:8px;font-size:13px;color:${MUTED}">מתוכם ${ltr(Math.round(topSum / total * 100) + '%')} — ${ltr(fmtILS(topSum))} — ב-${top.length} ${top.length === 1 ? 'מוצר' : 'מוצרים'}:</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="margin-top:4px">${items}</table>
        ${noCost ? `<div style="padding-top:6px;font-size:11px;color:${MUTED}">${noCost} מוצרים ללא נתוני עלות — לא נכללו בסכום.</div>` : ''}
      </td>
    </tr></table>
  </td></tr>`;
}

function buildEmailHtml(n, greetName, risk) {
  const greeting = greetName ? `שלום ${greetName},` : 'שלום,';
  const rows = [];
  for (let i = 0; i < n; i += 2) {
    const cell = j => j < n
      ? `<td width="50%" valign="top" style="padding:6px"><img src="cid:card-${j}" width="322" alt="" style="display:block;width:100%;max-width:322px;height:auto;border:0"></td>`
      : '<td width="50%"></td>';
    rows.push(`<tr style="page-break-inside:avoid">${cell(i)}${cell(i + 1)}</tr>`);
  }
  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:28px 16px;background:${PAPER};font-family:Arial,sans-serif">
<table role="presentation" align="center" width="700" cellpadding="0" cellspacing="0" style="width:700px;max-width:700px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE}">
  <tr><td dir="rtl" style="background-color:${NAVY};padding:30px 28px 26px;text-align:center">
    <img src="cid:diler-logo-white" width="84" height="84" alt="DILER B.M.D" style="display:block;margin:0 auto 14px" />
    <div style="font-size:24px;font-weight:900;color:#ffffff">התראת תוקף — מחסן FORMULA</div>
    <div style="padding-top:8px;font-size:13px;color:#AFC1DC">${n} ${n === 1 ? 'מוצר בסכנה' : 'מוצרים בסכנה'} / STOP SALE</div>
    <div style="padding-top:10px;font-size:11px;color:${GOLD}">${new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
  </td></tr>
  <tr><td dir="rtl" style="padding:20px 28px 8px;text-align:right;font-size:14px;color:${INK}">${greeting} מצורף דוח תוקף — מוצרים בסכנה ו-STOP SALE, כמו במסך דוח התוקף של המחסן.</td></tr>
  ${NOTE ? `<tr><td dir="rtl" style="padding:4px 28px 8px;text-align:right;font-size:14px;font-weight:bold;color:${NAVY}">${NOTE}</td></tr>` : ''}
  ${buildRiskHtml(risk)}
  <tr><td dir="rtl" style="padding:4px 28px 10px;text-align:right">
    <div style="display:inline-block;padding:9px 16px;border:1.5px solid ${NAVY};border-radius:8px;background:#EEF3FA;font-size:13px;font-weight:bold;color:${NAVY}">🖨 להדפסה — פתחו את קובץ ה-PDF המצורף (4 מוצרים בעמוד A4)</div>
  </td></tr>
  <tr><td style="padding:4px 12px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl">${rows.join('')}</table></td></tr>
  <tr><td dir="rtl" style="padding:16px 28px 24px;text-align:right;border-top:1px solid ${LINE};font-size:12px;color:${MUTED};line-height:1.7">
    הדוח נשלח רק בימים שיש מוצרים בסכנה.<br>הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.
  </td></tr>
</table>
</body></html>`;
}

async function main() {
  const { shots, pdf, risks } = await shootCards();
  const risk = riskSummary(risks);
  if (risk.noCost) console.log('Без суммы:', risks.filter(r => !(r.cost > 0)).map(r => r.name).join(' ; '));
  console.log(`Риск: ${fmtILS(risk.total)}, топ-70%: ${risk.top.map(r => r.name + ' ' + fmtILS(r.cost)).join('; ')}`);
  console.log(`Карточек סכנה/STOP SALE: ${shots.length}`);
  if (shots.length === 0) return;

  if (DRY_RUN) {
    const out = path.join(__dirname, '..', '.scratch');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'expiry-alert-preview.html'),
      buildEmailHtml(shots.length, 'דן', risk).replace(/cid:card-(\d+)/g, (_, i) => `data:image/png;base64,${shots[i].toString('base64')}`)
        .replace('cid:diler-logo-white', 'data:image/png;base64,' + fs.readFileSync(path.join(DOCS, 'logo-diler-bmd-white.png')).toString('base64')));
    fs.writeFileSync(path.join(out, 'expiry-alert-preview.pdf'), pdf);
    console.log('--dry-run — письмо не отправлено, превью в .scratch/expiry-alert-preview.html/.pdf');
    return;
  }

  const recipients = (process.env.EXPIRY_ALERT_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error('EXPIRY_ALERT_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const logoPath = path.join(DOCS, 'logo-diler-bmd-white.png');
  const attachments = shots.map((b, i) => ({ filename: `card-${i}.png`, content: b.toString('base64'), contentId: `card-${i}` }));
  const isoDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  attachments.push({ filename: `expiry-report-${isoDate}.pdf`, content: pdf.toString('base64') });
  if (fs.existsSync(logoPath)) attachments.push({ filename: 'logo-white.png', content: fs.readFileSync(logoPath).toString('base64'), contentId: 'diler-logo-white' });
  const subject = `התראת תוקף — ${shots.length} ${shots.length === 1 ? 'מוצר בסכנה' : 'מוצרים בסכנה'}`;

  // Личное письмо на каждого получателя — как obligo-alert.
  for (const recipient of recipients) {
    const greetName = RECIPIENT_NAMES[recipient.toLowerCase()];
    const res = await resend.emails.send({
      from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to: [recipient],
      subject,
      html: buildEmailHtml(shots.length, greetName, risk),
      text: [
        `${greetName ? `שלום ${greetName},` : 'שלום,'} ${shots.length} מוצרים בסכנה / STOP SALE במחסן FORMULA.`,
        ...(NOTE ? ['', NOTE] : []),
        '',
        `סה"כ סיכון (עלות לזריקה צפויה): ${fmtILS(risk.total)}`,
        `מתוכם ${risk.total ? Math.round(risk.topSum / risk.total * 100) : 0}%:`,
        ...risk.top.map((r, i) => `${i + 1}. ${r.name} — ${fmtILS(r.cost)}`),
        '',
        'להדפסה — קובץ PDF מצורף.',
      ].join('\n'),
      attachments,
    });
    console.log(recipient, JSON.stringify(res));
  }
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
