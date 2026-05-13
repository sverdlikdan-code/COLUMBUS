/**
 * Fetches missing product photos from Open Food Facts API.
 * Reads makat-ean.json, checks which EANs are missing from photo-map.json,
 * queries OFF API for each, and updates photo-map.json with found URLs.
 * Run: node fetch-off-photos.js
 */
const fs   = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const makatEan = JSON.parse(fs.readFileSync(path.join(DOCS, 'makat-ean.json'), 'utf8'));
const photoMap = JSON.parse(fs.readFileSync(path.join(DOCS, 'photo-map.json'), 'utf8'));

const missing = Object.entries(makatEan).filter(([, e]) => !photoMap[String(e)]);
console.log(`Checking ${missing.length} products without photos...`);

const BATCH = 5;   // concurrent requests
const DELAY = 300; // ms between batches

async function fetchOFF(ean) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${ean}.json`);
    if (!res.ok) return null;
    const j = await res.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    // Prefer front image, fall back to first available image
    const url = p.image_front_display_url || p.image_front_url
             || p.image_front_small_url
             || p.selected_images?.front?.display?.he
             || p.selected_images?.front?.display?.en
             || p.selected_images?.front?.display?.['']
             || null;
    return url || null;
  } catch (e) {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let found = 0, notFound = 0;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(([, ean]) => fetchOFF(ean)));

    for (let j = 0; j < batch.length; j++) {
      const [makat, ean] = batch[j];
      const url = results[j];
      if (url) {
        photoMap[String(ean)] = { url, source: 'off' };
        found++;
        process.stdout.write(`✓ ${makat} (${ean})\n`);
      } else {
        notFound++;
        process.stdout.write(`✗ ${makat} (${ean})\n`);
      }
    }

    const pct = Math.round((i + batch.length) / missing.length * 100);
    console.log(`--- ${i + batch.length}/${missing.length} (${pct}%) | found: ${found} | not found: ${notFound} ---`);

    if (i + BATCH < missing.length) await sleep(DELAY);
  }

  fs.writeFileSync(path.join(DOCS, 'photo-map.json'), JSON.stringify(photoMap, null, 2), 'utf8');
  console.log(`\nDone. Found: ${found} | Not found: ${notFound}`);
  console.log(`photo-map.json updated: ${Object.keys(photoMap).length} total entries`);
})();
