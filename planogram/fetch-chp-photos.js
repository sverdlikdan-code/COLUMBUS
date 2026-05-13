/**
 * Fetches missing product photos from CHP.co.il.
 * Uses compare_results endpoint - works without auth for most products.
 * Saves PNG files to docs/photos/{EAN}.png and updates photo-map.json.
 * Run: node fetch-chp-photos.js
 */
const fs   = require('fs');
const path = require('path');

const DOCS      = path.join(__dirname, '..', 'docs');
const PHOTOS    = path.join(DOCS, 'photos');
const makatEan  = JSON.parse(fs.readFileSync(path.join(DOCS, 'makat-ean.json'),  'utf8'));
const photoMap  = JSON.parse(fs.readFileSync(path.join(DOCS, 'photo-map.json'),  'utf8'));

if (!fs.existsSync(PHOTOS)) fs.mkdirSync(PHOTOS, { recursive: true });

// Only EANs that don't have a photo yet (by EAN key)
const missing = Object.entries(makatEan).filter(([, ean]) => !photoMap[String(ean)]);
console.log(`Checking ${missing.length} products without photos…`);

const BATCH = 3;    // concurrent requests (be gentle with CHP)
const DELAY = 600;  // ms between batches

const CHP_HEADERS = {
  'User-Agent':        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
  'Accept':            'text/html,application/xhtml+xml,*/*',
  'Accept-Language':   'he-IL,he;q=0.9,en;q=0.8',
  'X-Requested-With':  'XMLHttpRequest',
  'Referer':           'https://chp.co.il/',
};

async function fetchCHP(ean) {
  try {
    const url = `https://chp.co.il/main_page/compare_results?product_barcode=${ean}&product_name_or_barcode=${ean}&from=0&num_results=1`;
    const res = await fetch(url, { headers: CHP_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract full base64 image (may be very long)
    const match = html.match(/data:image\/([a-z]+);base64,([A-Za-z0-9+/=]+)/);
    if (!match) return null;

    const ext    = match[1] === 'jpeg' ? 'jpg' : match[1]; // png/jpg
    const b64    = match[2];
    const fname  = `${ean}.${ext}`;
    const fpath  = path.join(PHOTOS, fname);

    fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
    return `photos/${fname}`;
  } catch (e) {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let found = 0, notFound = 0;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch   = missing.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(([, ean]) => fetchCHP(ean)));

    for (let j = 0; j < batch.length; j++) {
      const [makat, ean] = batch[j];
      const url = results[j];
      if (url) {
        photoMap[String(ean)] = { url, source: 'chp' };
        found++;
        process.stdout.write(`✓ ${makat} (${ean}) → ${url}\n`);
      } else {
        notFound++;
        process.stdout.write(`✗ ${makat} (${ean})\n`);
      }
    }

    const done = i + batch.length;
    const pct  = Math.round(done / missing.length * 100);
    console.log(`--- ${done}/${missing.length} (${pct}%) | ✓ ${found} | ✗ ${notFound} ---`);

    // Save progress every 30 products in case of interruption
    if (done % 30 === 0 || done === missing.length) {
      fs.writeFileSync(path.join(DOCS, 'photo-map.json'), JSON.stringify(photoMap, null, 2), 'utf8');
      console.log(`  [saved photo-map.json — ${Object.keys(photoMap).length} total entries]`);
    }

    if (i + BATCH < missing.length) await sleep(DELAY);
  }

  fs.writeFileSync(path.join(DOCS, 'photo-map.json'), JSON.stringify(photoMap, null, 2), 'utf8');
  console.log(`\nDone. Found: ${found} | Not found: ${notFound}`);
  console.log(`photo-map.json: ${Object.keys(photoMap).length} total entries`);
  console.log(`photos/ folder: check docs/photos/ for new files`);
})();
