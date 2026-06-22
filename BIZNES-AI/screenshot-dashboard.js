const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  const url = 'file:///' + path.resolve(__dirname, 'audit/dashboard-mockup.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.resolve(__dirname, 'audit/dashboard-screenshot.png') });
  await browser.close();
  console.log('Saved: audit/dashboard-screenshot.png');
})();
