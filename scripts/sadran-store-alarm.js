// sadran-store-alarm.js — алярм по конкретным магазинам, отдельно по каждой компании
// (запрос пользователя 2026-08-11, после находки: последние 3 мес +1.6% vs предыдущие 3 мес
// +13.7% — рост почти остановился на уровне всей компании).
//
// Идея: не просто "кто упал больше всех" (это уже есть в PPTX, topDeclineByCompany), а КТО
// СИЛЬНЕЕ ВСЕХ ОТКЛОНЯЕТСЯ ОТ ОБЩЕЙ ДИНАМИКИ своей компании — магазин, чей темп замедлился
// намного резче среднего по компании, это отдельный сигнал (не просто "маленький магазин",
// а "магазин, ломающий тренд").
//
// Методология (same-store, две последовательные 3-мес окна год-к-году, см.
// computeMomentumPeriods в fetch-sadran-data.js):
//   recentPct(магазин) = % изменение (recent.now / recent.lastYear - 1), только если есть
//     реальная история в recent.lastYear
//   priorPct(магазин)  = аналогично для prior-окна
//   delta(магазин)     = recentPct - priorPct  (собственное ускорение/торможение магазина)
//   companyDelta       = то же самое, но на агрегате ВСЕЙ компании (не среднее по магазинам —
//     иначе один микро-магазин с шумным % перекосил бы "среднее")
//   deviation(магазин) = delta(магазин) - companyDelta  — насколько магазин отклоняется от
//     общего тренда своей компании
//
// Порог по выручке (MIN_REVENUE) — отсекает магазины с несколькими сотнями ₪ в квартал,
// где любое малое движение даёт шумный %.
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const {
  computeMomentumPeriods, fetchCustomerDims, fetchWindowPerCustomer,
} = require('./fetch-sadran-data');
const { fixBiDi, pctChange, fmtPct, fmtILS } = require('./sadran-data');

const MIN_REVENUE = 3000; // ₪, порог по (priorLY + recentLY), отсекает шумные микро-магазины
const TOP_N = 8;

async function main() {
  const { recent, prior } = computeMomentumPeriods();
  console.log('Recent:', recent.now.start, '->', recent.now.endExclusive, '(LY:', recent.lastYear.start, '->', recent.lastYear.endExclusive, ')');
  console.log('Prior: ', prior.now.start, '->', prior.now.endExclusive, '(LY:', prior.lastYear.start, '->', prior.lastYear.endExclusive, ')');

  console.log('Тяну клиентов со сдараном...');
  const custDims = await fetchCustomerDims();

  console.log('Тяну 4 окна (recent now/ly, prior now/ly)...');
  const [recentNow, recentLY, priorNow, priorLY] = await Promise.all([
    fetchWindowPerCustomer(recent.now.start, recent.now.endExclusive, custDims),
    fetchWindowPerCustomer(recent.lastYear.start, recent.lastYear.endExclusive, custDims),
    fetchWindowPerCustomer(prior.now.start, prior.now.endExclusive, custDims),
    fetchWindowPerCustomer(prior.lastYear.start, prior.lastYear.endExclusive, custDims),
  ]);

  // Все ключи вида "keyForData|company", встречавшиеся хоть в одном из 4 окон.
  const allKeys = new Set([...recentNow.keys(), ...recentLY.keys(), ...priorNow.keys(), ...priorLY.keys()]);

  const byCompany = new Map(); // company -> [{keyForData, custname, sadran, sochen, recentPct, priorPct, delta, scale}]
  const companyTotals = new Map(); // company -> {recentNow, recentLY, priorNow, priorLY}

  for (const key of allKeys) {
    const [keyForData, company] = key.split('|');
    const dim = custDims.get(keyForData);
    if (!dim) continue;
    const rN = recentNow.get(key) || 0, rL = recentLY.get(key) || 0;
    const pN = priorNow.get(key) || 0, pL = priorLY.get(key) || 0;

    if (!companyTotals.has(company)) companyTotals.set(company, { recentNow: 0, recentLY: 0, priorNow: 0, priorLY: 0 });
    const ct = companyTotals.get(company);
    ct.recentNow += rN; ct.recentLY += rL; ct.priorNow += pN; ct.priorLY += pL;

    // Порог — на КАЖДУЮ базу отдельно (priorLY, recentLY), не на сумму: иначе магазин с
    // ₪50 в одном из окон и ₪5000 в другом даёт задранный на пустом месте % (+10000%),
    // даже если суммарная выручка формально проходит порог (найдено 2026-08-11 —
    // первый прогон был забит такими артефактами).
    if (pL < MIN_REVENUE || rL < MIN_REVENUE) continue;
    const recentPct = pctChange(rL, rN);
    const priorPct = pctChange(pL, pN);
    if (recentPct === null || priorPct === null) continue; // нужна реальная same-store история в ОБОИХ окнах

    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push({
      custname: fixBiDi(dim.custname), sadran: fixBiDi(dim.sadran), sochen: fixBiDi(dim.sochen),
      recentPct, priorPct, delta: recentPct - priorPct, scale: pL + rL,
    });
  }

  console.log(`\n${'='.repeat(90)}\nАЛЯРМ: магазины, сильнее всех отклоняющиеся от тренда своей компании\n(same-store, recent 3 мес vs prior 3 мес, год-к-году; порог выручки >= ${fmtILS(MIN_REVENUE)})\n${'='.repeat(90)}`);

  for (const [company, stores] of byCompany) {
    const ct = companyTotals.get(company);
    const companyRecentPct = pctChange(ct.recentLY, ct.recentNow);
    const companyPriorPct = pctChange(ct.priorLY, ct.priorNow);
    const companyDelta = (companyRecentPct !== null && companyPriorPct !== null) ? companyRecentPct - companyPriorPct : null;

    console.log(`\n--- ${company} --- (компания целиком: prior ${fmtPct(companyPriorPct)} -> recent ${fmtPct(companyRecentPct)}, тренд ${companyDelta === null ? 'н/д' : (companyDelta >= 0 ? '+' : '') + Math.round(companyDelta * 100) + ' п.п.'})`);
    if (companyDelta === null) { console.log('  (нет базы для сравнения компании целиком)'); continue; }

    const ranked = stores
      .map(s => ({ ...s, deviation: s.delta - companyDelta }))
      .sort((a, b) => a.deviation - b.deviation) // самые отрицательные (хуже тренда) — первые
      .slice(0, TOP_N);

    for (const s of ranked) {
      const devPP = Math.round(s.deviation * 100);
      console.log(`  ${s.custname.padEnd(45)} сдаран ${s.sadran.padEnd(18)} агент ${s.sochen.padEnd(18)} prior ${fmtPct(s.priorPct).padStart(6)} -> recent ${fmtPct(s.recentPct).padStart(6)}  |  отклонение от тренда компании: ${devPP >= 0 ? '+' : ''}${devPP} п.п.`);
    }
  }
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
