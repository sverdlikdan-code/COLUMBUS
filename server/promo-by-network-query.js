// Акции ("מבצעים") по сети/клиенту — источник для будущей фичи Formula Road (агент видит,
// какие акции идут в сети клиента). Проверено вживую 2026-09-06:
//   - SOF_PRICEREC — кастомная таблица акций/спец.цен, есть во всех 4 базах (form/diller/icecrea/mmdint)
//   - "Сеть" в этой системе = CUSTOMERS.CUSTDES (каждый CUST в form — это реальная сеть/точка:
//     יוחננוף, ויקטורי, היפר כהן, מחסני השוק, סופר קופיקס и т.п.) — отдельного поля "chain name"
//     в CUSTOMERS/CUSTSPEC нет (CUSTSPEC.SPEC3 — это категория клиента: מכולת/רשת שיווק/רשת פרטית,
//     не бренд сети)
//   - PRICEDESID -> SOF_PRICEDESC.PRICEDESCDESC = тип акции: מבצע, מועדון, קופון, 1+1, 2+2, פרסום, תצוגה...
//   - QUANTPRICE хранится ×1000 (как обычный QUANT) — делить на 1000.0
//   - FROMDATE/TODATE — минуты с 01.01.1988, конвертация DATEADD(MINUTE, x, '19880101')
//   - PRICEREC=0/NULL — акция реальна, но цену ставит сама сеть на кассе (не Priority);
//     не фильтровать эти строки (живой фикс 2026-09-06 в server/priority-db.js)
//   - ВАЖНО: акция часто заведена не на каждый филиал, а один раз на CUSTOMERS.MCUST
//     ("לקוח מרכז" — центральный/головной клиент сети). Этот скрипт ищет по CUSTDES
//     напрямую (СУ.CUST), так что при поиске по имени конкретного филиала (не хаба)
//     можно ничего не найти, хотя у сети реально есть акции — искать нужно по имени
//     хаба, либо резолвить MCUST филиала отдельно (см. clientPromosByCustId в
//     server/priority-db.js для per-client резолва CUST+MCUST).
// Запуск: node server/promo-by-network-query.js "יוחננוף" [form|diller|icecrea|mmdint]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sql = require('mssql');

const networkFilter = process.argv[2] || '';
const company = process.argv[3] || 'form';

const cfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: company,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 15000,
  requestTimeout: 30000,
};

// Акции по сети (частичное совпадение по имени клиента), окно (живой запрос
// пользователя 2026-09-06, заменил более широкое "весь месяц+след.месяц"):
// TODAY внутри [FROMDATE,TODATE] (идёт прямо сейчас) ИЛИ FROMDATE в пределах
// ближайших 18 дней (скоро начнётся). Без фильтра по @network — все сети компании.
const QUERY = `
SELECT
  C.CUSTNAME                                             AS cust_code,
  C.CUSTDES                                              AS network_name,
  PD.PRICEDESCDESC                                       AS promo_type,
  P.PARTNAME                                             AS sku,
  P.PARTDES                                              AS product_name,
  SP.PRICEREC                                            AS promo_price,
  SP.QUANTPRICE / 1000.0                                 AS promo_qty,
  CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) AS valid_from,
  CAST(DATEADD(MINUTE, SP.TODATE,   '19880101') AS date) AS valid_to
FROM SOF_PRICEREC SP
JOIN CUSTOMERS C        ON C.CUST = SP.CUST
JOIN PART P             ON P.PART = SP.PART
LEFT JOIN SOF_PRICEDESC PD ON PD.PRICEDESID = SP.PRICEDESID
WHERE (@network = '' OR C.CUSTDES LIKE '%' + @network + '%')
  AND YEAR(CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date)) = YEAR(GETDATE())
  AND (
    (CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) <= CAST(GETDATE() AS date)
     AND CAST(DATEADD(MINUTE, SP.TODATE, '19880101') AS date) >= CAST(GETDATE() AS date))
    OR
    (CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) > CAST(GETDATE() AS date)
     AND CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) <= DATEADD(DAY, 18, CAST(GETDATE() AS date)))
  )
ORDER BY C.CUSTDES, P.PARTDES
`;

async function run() {
  const pool = await new sql.ConnectionPool(cfg).connect();
  const result = await pool.request()
    .input('network', sql.NVarChar, networkFilter)
    .query(QUERY);
  console.log(`Компания: ${company} | Сеть: "${networkFilter || '(все)'}" | Акций (идут сейчас или стартуют в ближайшие 18 дней): ${result.recordset.length}`);
  console.table(result.recordset);
  await pool.close();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
