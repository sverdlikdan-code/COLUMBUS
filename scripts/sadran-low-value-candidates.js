// sadran-low-value-candidates.js — кандидаты на снятие сдарана: точки с наименьшим тотал
// продаж (запрос пользователя 2026-08-11: "динамика по сдаранам не нужна — нужны кандидаты
// из клиентов на то, чтоб убрать сдарана и нерентабельные точки для нас ушли, смотрим по
// тотал продаж без ICE BDD естественно").
//
// Источник — тот же кэш, что и весь остальной SADRAN pipeline (fetch-sadran-data.js):
// ICE BDD и תגמולים/ציוד/שאריות уже исключены на этапе выгрузки, בודדים — на этапе агрегации.
// Ранжируем по ТЕКУЩЕМУ (now) обороту клиента ЦЕЛИКОМ (сумма по всем компаниям/департаментам,
// не по одной строке) — сдаран обслуживает физическую точку, а не отдельную компанию.
const { loadRows, fmtILS } = require('./sadran-data');

const TOP_N = 30;

function main() {
  const rows = loadRows();
  const totals = new Map(); // custno -> {custname, sadran, city, custtype, kosher, companies:Set, lastYear, now}
  for (const r of rows) {
    if (!totals.has(r.custno)) {
      totals.set(r.custno, {
        custname: r.custname, sadran: r.sadran, city: r.city, custtype: r.custtype, kosher: r.kosher,
        companies: new Set(), lastYear: 0, now: 0,
      });
    }
    const t = totals.get(r.custno);
    t.companies.add(r.company);
    t.lastYear += r.lastYear;
    t.now += r.now;
  }

  const grandNow = [...totals.values()].reduce((s, v) => s + v.now, 0);
  const list = [...totals.entries()]
    .map(([custno, v]) => ({ custno, ...v }))
    .sort((a, b) => a.now - b.now); // от самых маленьких

  console.log(`Всего клиентов со сдараном: ${list.length}, тотал продаж (now, YTD): ${fmtILS(grandNow)}\n`);
  console.log(`${'='.repeat(100)}\nКАНДИДАТЫ НА СНЯТИЕ СДАРАНА — ${TOP_N} точек с наименьшим тотал продаж\n${'='.repeat(100)}`);

  const bottom = list.slice(0, TOP_N);
  let bottomSum = 0;
  bottom.forEach((c, i) => {
    bottomSum += c.now;
    const companies = [...c.companies].join('+');
    console.log(`${String(i + 1).padStart(2)}. ${c.custname.padEnd(45)} ${c.city.padEnd(15)} сдаран ${c.sadran.padEnd(18)} [${companies}]  было ${fmtILS(c.lastYear).padStart(10)} -> сейчас ${fmtILS(c.now).padStart(10)}`);
  });

  console.log(`\nСумма этих ${TOP_N} точек: ${fmtILS(bottomSum)} (${(bottomSum / grandNow * 100).toFixed(2)}% от общего тотала).`);
  console.log(`Медиана по всей базе (${list.length} точек): ${fmtILS(list[Math.floor(list.length / 2)].now)}.`);
}

main();
