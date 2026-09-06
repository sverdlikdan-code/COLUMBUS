// Once-daily snapshot of the FORMULA DASHBORD "יעדים" PBI page, one PNG per
// קבוצה (team) — App-owns-data embed token (same service principal as
// executeDax elsewhere), no interactive login/MFA. Agents in formula-road.html
// see the page "as-is" instead of a rebuilt HTML table, per explicit request
// not to reinvent it. Session 2026-08-20.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { getPowerBIToken } = require('./powerbi.js');

const REPORT_ID = '819fd18b-384d-4a32-a16e-4f392053f5f2';
const DATASET_ID = '457ddbf6-86f3-4d1f-8505-f4fd6ee0fb84';
const PAGE_NAME = 'ReportSectionec329faac320061a8509'; // יעדים
const TEAMS = [
  { name: 'ALEXEY', slug: 'alexey' },
  { name: 'ANATOL', slug: 'anatol' },
  { name: 'NATALYA', slug: 'natalya' },
  { name: 'SADRAN+', slug: 'sadran-plus' },
  { name: 'SVETA', slug: 'sveta' },
  { name: 'VLAD', slug: 'vlad' },
];
const OUT_DIR = path.join(__dirname, 'data');
const VIEWPORT = { width: 1900, height: 1150 };
const TRIAL_BANNER_HEIGHT = 38;

// The "יעדים" page has its own Month/Year slicers (DIMCALENDAR[Month Name] /
// DIMCALENDAR[Year] — confirmed via Report/definition/pages/.../visuals JSON,
// ordinary advancedSlicerVisual bound to real model columns, not a bookmark
// or field parameter) whose selection is just whatever was last saved in the
// report in PBI Service — never today's month. Compute the real current
// month/year on Israel time so every daily run pins the slicer itself,
// instead of relying on someone re-saving the report state by hand.
function currentIsraelMonthYear() {
  const now = new Date();
  const monthName = now.toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Jerusalem' });
  const year = Number(now.toLocaleString('en-US', { year: 'numeric', timeZone: 'Asia/Jerusalem' }));
  return { monthName, year };
}

async function generateEmbedToken(aadToken, workspaceId) {
  const res = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${REPORT_ID}/GenerateToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${aadToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessLevel: 'View', datasets: [{ id: DATASET_ID }] }),
  });
  if (!res.ok) throw new Error(`GenerateToken failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.token;
}

function harnessHtml({ embedUrl, embedToken, reportId, pageName, monthName, year }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden;} #report{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;}</style>
<script src="https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js"></script>
</head><body>
<div id="report"></div>
<script>
window.__ready = false;
window.__error = null;
const models = window['powerbi-client'].models;
function teamFilters(team) {
  return [
    {
      $schema: "http://powerbi.com/product/schema#basic",
      target: { table: "משטח", column: "קבוצה" },
      operator: "In",
      values: [team]
    },
    // These tables' rows are bound to the "מנהל אזור / סוכן" field parameter
    // (the קבוצה/שם סוכן toggle at the top of the page) — it must be pinned
    // to שם סוכן (Order=1). Left on its own default it doesn't correctly
    // resolve for every team (NATALYA/SADRAN+ came back blank without this,
    // even though the underlying sales data is real — confirmed 2026-08-20).
    {
      $schema: "http://powerbi.com/product/schema#basic",
      target: { table: "מנהל אזור / סוכן", column: "מנהל אזור / סוכן Order" },
      operator: "In",
      values: [1]
    }
  ];
}
// Pins the page's own Month/Year slicers (DIMCALENDAR[Month Name] text like
// "September", DIMCALENDAR[Year] numeric like 2026) to today's Israel date —
// see currentIsraelMonthYear() in the Node half of this file for why.
const MONTH_NAME = ${JSON.stringify(monthName)};
const YEAR = ${JSON.stringify(year)};
function monthFilters() {
  return [
    {
      $schema: "http://powerbi.com/product/schema#basic",
      target: { table: "DIMCALENDAR", column: "Month Name" },
      operator: "In",
      values: [MONTH_NAME]
    },
    {
      $schema: "http://powerbi.com/product/schema#basic",
      target: { table: "DIMCALENDAR", column: "Year" },
      operator: "In",
      values: [YEAR]
    }
  ];
}
function allFilters(team) {
  return [...teamFilters(team), ...monthFilters()];
}
const config = {
  type: 'report',
  tokenType: models.TokenType.Embed,
  accessToken: ${JSON.stringify(embedToken)},
  embedUrl: ${JSON.stringify(embedUrl)},
  id: ${JSON.stringify(reportId)},
  pageName: ${JSON.stringify(pageName)},
  settings: {
    panes: { filters: { visible: false }, pageNavigation: { visible: false } },
    navContentPaneEnabled: false,
  }
};
const el = document.getElementById('report');
const report = window.powerbi.embed(el, config);
report.on('rendered', () => { window.__ready = true; });
report.on('error', (e) => { window.__error = JSON.stringify(e.detail); });
// report.setFilters() only touches report-scope filters. A stale filter left
// on the PAGE (Filters pane "This page") or a visual — from someone manually
// filtering this same report open in PBI Service — lives in a different SDK
// scope and silently ANDs with ours, producing an empty intersection for
// every team except whichever one they last filtered to. Confirmed via
// network capture of the actual DAX queries (live bug 2026-09-04): every
// pivot query carried both our team condition AND a leftover
// משטח[קבוצה] IN {team-someone-else-picked}. Clearing/setting at both page
// and report scope, for every team including the first, makes the daily
// render immune to whatever was last left in the Filters pane.
window.__setTeamFilter = async (team) => {
  window.__ready = false;
  const filters = allFilters(team);
  const page = await report.getActivePage();
  await page.setFilters(filters);
  await report.setFilters(filters);
};
</script>
</body></html>`;
}

async function waitReady(page, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => ({ ready: window.__ready, error: window.__error }));
    if (state.error) throw new Error(`PBI embed error: ${state.error}`);
    if (state.ready) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for report render');
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const aadToken = await getPowerBIToken();
  const workspaceId = process.env.POWERBI_WORKSPACE_ID;
  const embedToken = await generateEmbedToken(aadToken, workspaceId);
  const embedUrl = `https://app.powerbi.com/reportEmbed?reportId=${REPORT_ID}&groupId=${workspaceId}`;

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  const { monthName, year } = currentIsraelMonthYear();
  console.log(`Pinning month/year slicer to ${monthName} ${year} (Asia/Jerusalem).`);
  const html = harnessHtml({ embedUrl, embedToken, reportId: REPORT_ID, pageName: PAGE_NAME, monthName, year });
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('Waiting for initial render...');
  await waitReady(page, 60000);
  await new Promise(r => setTimeout(r, 1500)); // let final chart animations settle

  for (const team of TEAMS) {
    // Every team, including the first, goes through __setTeamFilter (page+report
    // scope) — the initial embed's own default filter state is whatever was last
    // left in the Filters pane (see __setTeamFilter's comment above) and can't be
    // trusted even for TEAMS[0].
    await page.evaluate((t) => window.__setTeamFilter(t), team.name);
    // A single 'rendered' event isn't reliably the *final* one after a filter
    // change — caught screenshots mid-transition. The extra settle delay below
    // confirms it actually landed before saving.
    await waitReady(page);
    await new Promise(r => setTimeout(r, 3000));
    const el = await page.$('#report');
    const box = await el.boundingBox();
    const outPath = path.join(OUT_DIR, `yedaim-${team.slug}.png`);
    // Trial-capacity banner ("This is a free trial version...") renders inside
    // the embedded iframe's own pixels — not a separate DOM node we can hide,
    // so it's cropped off the top of the capture instead.
    await page.screenshot({
      path: outPath,
      clip: { x: box.x, y: box.y + TRIAL_BANNER_HEIGHT, width: box.width, height: box.height - TRIAL_BANNER_HEIGHT },
    });
    console.log(`Saved ${outPath}`);
  }

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error('BUILD FAILED:', e.message); process.exit(1); });
