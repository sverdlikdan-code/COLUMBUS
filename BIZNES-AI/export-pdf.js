const puppeteer = require('puppeteer');
const path = require('path');

const files = [
  { in: 'portfolio/diler-bmd-presentation.html',    out: 'portfolio/diler-bmd-presentation.pdf',    slides: 7 },
  { in: 'portfolio/diler-bmd-presentation-he.html', out: 'portfolio/diler-bmd-presentation-he.pdf', slides: 6 },
  { in: 'portfolio/powerbi-presentation.html',      out: 'portfolio/powerbi-presentation.pdf',      slides: 11 },
];

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-web-security'] });

  for (const f of files) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

    const url = 'file:///' + path.resolve(__dirname, f.in).replace(/\\/g, '/');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500)); // wait for fonts

    // Inject print CSS override: show all slides stacked vertically
    await page.addStyleTag({ content: `
      body   { height: auto !important; overflow: visible !important; }
      .deck  { height: auto !important; position: static !important; }
      .slide {
        opacity: 1 !important;
        pointer-events: auto !important;
        position: relative !important;
        transform: none !important;
        display: flex !important;
        width: 1280px !important;
        height: 720px !important;
        page-break-after: always !important;
        break-after: page !important;
        flex-shrink: 0 !important;
      }
      .progress-bar, .nav, .counter, .btn-pdf { display: none !important; }
    `});

    const outPath = path.resolve(__dirname, f.out);
    await page.pdf({
      path: outPath,
      width:  '1280px',
      height: '720px',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    console.log(`Saved (${f.slides} slides): ${f.out}`);
    await page.close();
  }

  await browser.close();
  console.log('Done.');
})();
