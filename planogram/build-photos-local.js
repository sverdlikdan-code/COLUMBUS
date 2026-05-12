/**
 * build-photos-local.js
 * Resizes product photos (EAN-named) to 250px wide thumbnails.
 * Input:  PHOTO_SRC folder (default: next to this script or as CLI arg)
 * Output: ../docs/photos/   + ../docs/photo-map.json
 *
 * Run: node build-photos-local.js [/path/to/photos]
 * Default source: C:\Users\d.sverdlik\Desktop\WORKSPACE\PLANOGRAM MAHSAN FORMULA\photo-extract\מגוון פורמולה מאגר תמונות
 */
const sharp  = require('sharp');
const fs     = require('fs');
const path   = require('path');

const SRC_DEFAULT = path.join(
  'C:', 'Users', 'd.sverdlik', 'Desktop', 'WORKSPACE',
  'PLANOGRAM MAHSAN FORMULA', 'photo-extract',
  'מגוון פורמולה מאגר תמונות'
);

const SRC_DIR  = process.argv[2] || SRC_DEFAULT;
const OUT_DIR  = path.join(__dirname, '..', 'docs', 'photos');
const MAP_FILE = path.join(__dirname, '..', 'docs', 'photo-map.json');
const MAX_W    = 250;  // px — enough for a planogram card

async function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`❌  Source folder not found: ${SRC_DIR}`);
    console.error('   Pass custom path as argument: node build-photos-local.js /path/to/photos');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(SRC_DIR)
    .filter(f => /\.(jpg|jpeg|png|PNG|JPG|JPEG)$/.test(f));

  console.log(`Found ${files.length} images in ${SRC_DIR}`);

  const map = {};
  let ok = 0, skip = 0, err = 0;

  for (const file of files) {
    // EAN = filename without " (N)" suffix + extension
    const ean = file
      .replace(/\s*\(\d+\)(\.[^.]+)?$/, '')
      .replace(/\.[^.]+$/, '')
      .trim();

    // Always prefer .jpg output for smallest size
    const outName = `${ean}.jpg`;
    const outPath = path.join(OUT_DIR, outName);

    // Skip duplicates — keep first (usually without (1) suffix)
    if (map[ean]) {
      skip++;
      console.log(`  SKIP duplicate: ${file}`);
      continue;
    }

    const srcPath = path.join(SRC_DIR, file);
    try {
      await sharp(srcPath)
        .resize(MAX_W, null, { withoutEnlargement: true })   // max width 250px, keep ratio
        .jpeg({ quality: 80 })
        .toFile(outPath);

      const stat = fs.statSync(outPath);
      map[ean] = { url: `photos/${outName}` };
      ok++;
      console.log(`  ✓ ${ean} → ${Math.round(stat.size / 1024)}KB`);
    } catch(e) {
      err++;
      console.error(`  ✗ ${file}: ${e.message}`);
    }
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), 'utf8');

  console.log(`\n✅  Done: ${ok} resized | ${skip} duplicates skipped | ${err} errors`);
  console.log(`   photo-map.json: ${Object.keys(map).length} EANs`);
  console.log(`   Output: ${OUT_DIR}`);

  // Check total size
  let totalKB = 0;
  for (const f of fs.readdirSync(OUT_DIR)) totalKB += fs.statSync(path.join(OUT_DIR, f)).size / 1024;
  console.log(`   Total photos size: ${Math.round(totalKB)}KB (${Math.round(totalKB/1024*10)/10}MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
