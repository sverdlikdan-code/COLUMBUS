const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const HTML = 'file:///' + path.resolve(__dirname, 'procurement-radar-pitch-he.html').replace(/\\/g, '/');
const OUT  = path.resolve(__dirname, 'slide-screenshots');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(HTML, { waitUntil: 'networkidle0' });

  const totalSlides = await page.evaluate(() => window.totalSlides || document.querySelectorAll('.slide').length);
  console.log(`Total slides: ${totalSlides}`);

  for (let i = 0; i < totalSlides; i++) {
    await page.evaluate(idx => { show(idx); }, i);
    await new Promise(r => setTimeout(r, 600));
    const file = path.join(OUT, `slide-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log(`✅ slide ${i + 1} → ${file}`);
  }

  await browser.close();
  console.log('\nDone. Screenshots in:', OUT);
})();
