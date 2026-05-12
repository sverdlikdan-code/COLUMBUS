/**
 * build-photo-map.js
 * Lists Google Drive folder → builds EAN → {id, url} JSON map.
 * Run: node build-photo-map.js
 * Requires env: GOOGLE_DRIVE_KEY (Drive API v3 key, read-only)
 * Output: ../docs/photo-map.json
 *
 * To get GOOGLE_DRIVE_KEY:
 *   1. console.cloud.google.com → APIs → Enable "Google Drive API"
 *   2. Credentials → Create API Key → restrict to Drive API
 *   3. Add to .env: GOOGLE_DRIVE_KEY=AIza...
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const FOLDER_ID = '1hDwzH-6XShSfIkfzlhsKGYNq7UpdanQf';
const API_KEY   = process.env.GOOGLE_DRIVE_KEY;

async function listFolder(folderId, apiKey, pageToken = '') {
  const params = new URLSearchParams({
    q:          `'${folderId}' in parents and trashed = false`,
    fields:     'nextPageToken,files(id,name)',
    pageSize:   '1000',
    key:        apiKey,
    ...(pageToken ? { pageToken } : {}),
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive API ${res.status}: ${err}`);
  }
  return res.json();
}

async function main() {
  if (!API_KEY) {
    console.error('❌  Missing GOOGLE_DRIVE_KEY in .env');
    console.error('   See instructions at top of this file.');
    process.exit(1);
  }

  let files = [];
  let pageToken = '';
  do {
    const page = await listFolder(FOLDER_ID, API_KEY, pageToken);
    files = files.concat(page.files || []);
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  console.log(`Drive folder: ${files.length} files found`);

  // Build map: EAN (filename without extension, without " (N)" duplicates) → {id, url}
  const map = {};
  for (const f of files) {
    // Strip " (1)", " (2)" suffixes, then strip extension
    const ean = f.name
      .replace(/\s*\(\d+\)(\.[^.]+)?$/, '')
      .replace(/\.[^.]+$/, '')
      .trim();
    if (!map[ean]) {
      map[ean] = {
        id:  f.id,
        // sz=w300 gives ~300px wide thumbnail — enough for a planogram card
        url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w300`,
      };
      console.log(`  ${ean} → ${f.id.slice(0, 12)}...`);
    } else {
      console.log(`  SKIP duplicate: ${f.name}`);
    }
  }

  const outPath = path.join(__dirname, '..', 'docs', 'photo-map.json');
  fs.writeFileSync(outPath, JSON.stringify(map, null, 2), 'utf8');
  console.log(`\n✅  photo-map.json: ${Object.keys(map).length} unique EANs → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
