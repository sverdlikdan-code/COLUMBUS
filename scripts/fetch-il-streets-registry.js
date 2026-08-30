// Скачивает справочник МВД (רשות האוכלוסין וההגירה) "רשימת רחובות בישראל - קובץ עם
// סינונימיים" — эталон город+улица+синонимы для нормализации адресов Formula Road
// (см. normalize-formula-addresses.js). Источник: data.gov.il, датасет "israel-streets-synom",
// обновляется гос-стороной еженедельно. Прямой .csv/.xml download-эндпоинт закрыт
// JS-anti-bot челленджем — используем чистый CKAN JSON API (datastore_search) с пагинацией.
//
// Перезапускать вручную раз в несколько месяцев (или когда нормализация начинает мазать) —
// не в CI, справочник улиц не меняется настолько часто, чтобы гонять это на каждый билд.
const https = require('https');
const fs = require('fs');
const path = require('path');

const RESOURCE_ID = 'bf185c7f-1a4e-4662-88c5-fa118a244bda';
const PAGE = 5000;
const OUT = path.join(__dirname, 'il-streets-registry.json');

function fetchPage(offset) {
  return new Promise((resolve, reject) => {
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=${PAGE}&offset=${offset}`;
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  let offset = 0, all = [], total = null;
  while (true) {
    const page = await fetchPage(offset);
    if (!page.success) throw new Error('CKAN API error: ' + JSON.stringify(page).slice(0, 300));
    const records = page.result.records;
    total = page.result.total;
    all = all.concat(records);
    process.stdout.write(`\r  ${all.length}/${total}`);
    offset += PAGE;
    if (records.length === 0 || all.length >= total) break;
  }
  console.log();

  // Только поля, нужные для normalize-formula-addresses.js — region_code/street_code/_id
  // не используются, отбрасываем (сокращает файл в разы).
  const trimmed = all.map(r => ({
    city: (r.city_name || '').trim(),
    street: (r.street_name || '').trim(),
    status: (r.street_name_status || '').trim(), // 'official' | 'synonym of <code>'
    officialCode: r.official_code,
  }));

  fs.writeFileSync(OUT, JSON.stringify(trimmed));
  console.log(`Сохранено: ${OUT} (${trimmed.length} строк, обновляется еженедельно на data.gov.il — перекачать вручную при необходимости)`);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
