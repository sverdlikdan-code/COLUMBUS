const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

fs.mkdirSync(path.join(__dirname, 'portfolio/screenshots'), { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-web-security'] });

  // ── Formula Road: inject unlock + skip maintenance ──────────────────────
  console.log('Shooting Formula Road...');
  const p1 = await browser.newPage();
  await p1.setViewport({ width: 1400, height: 800 });

  await p1.evaluateOnNewDocument(() => {
    // unlock device + set demo manager session
    localStorage.setItem('fr_unlock', '1');
    localStorage.setItem('fr_manager', 'VLAD');
  });

  await p1.goto('file:///c:/Users/d.sverdlik/Desktop/WORKSPACE/COLUMBUS/docs/formula-road.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

  // patch MAINTENANCE_MODE to false and re-render
  await p1.evaluate(() => {
    window.MAINTENANCE_MODE = false;
    // trigger manager screen
    const el = document.querySelector('#app') || document.body;
    el.style.display = 'flex';
  });

  await new Promise(r => setTimeout(r, 3000));
  await p1.screenshot({ path: path.join(__dirname, 'portfolio/screenshots/formula-road.png') });
  console.log('Formula Road saved');
  await p1.close();

  // ── Planogram ────────────────────────────────────────────────────────────
  console.log('Shooting Planogram...');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1400, height: 900 });
  await p2.goto('file:///c:/Users/d.sverdlik/Desktop/WORKSPACE/COLUMBUS/docs/planogram-editor.html', { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));
  await p2.screenshot({ path: path.join(__dirname, 'portfolio/screenshots/planogram.png') });
  console.log('Planogram saved');
  await p2.close();

  await browser.close();
  console.log('Done!');
})().catch(e => { console.error(e); process.exit(1); });
