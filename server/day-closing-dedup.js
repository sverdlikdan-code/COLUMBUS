// SQLite log of ICE order numbers already counted in a previous day's
// "סגירת יום" — see priority-db.js's dayClosingIceOrdersRaw comment for why
// this exists: an ICE order left open by a logistics delay stays in
// Priority's ORDERS table with its CURDATE bumped forward each day, so
// filtering by CURDATE=today alone re-counts it on every day it's still
// open. Populated once daily near 22:30 Israel time (see
// scheduleDailyIceOrderSnapshot in index.js) with every order number still
// open at that hour. The day-closing read path (filterUncounted) excludes
// any order recorded on an EARLIER date than today — an order first seen
// today still counts today, so same-day "close day" reruns are unaffected.
const { db } = require('./events-db.js');

db.exec(`
  CREATE TABLE IF NOT EXISTS ice_counted_orders (
    ord TEXT PRIMARY KEY,
    first_counted_date TEXT NOT NULL
  );
`);

const getStmt = db.prepare(`SELECT first_counted_date FROM ice_counted_orders WHERE ord = ?`);
const insertStmt = db.prepare(`INSERT OR IGNORE INTO ice_counted_orders (ord, first_counted_date) VALUES (?, ?)`);
const insertMany = db.transaction((ordIds, todayIL) => {
  for (const ord of ordIds) insertStmt.run(ord, todayIL);
});

// orders: raw rows with an `ord` field (see dayClosingIceOrdersRaw). Keeps
// only orders never recorded before, or recorded today (same-day reruns).
function filterUncounted(orders, todayIL) {
  return orders.filter(o => {
    const row = getStmt.get(o.ord);
    return !row || row.first_counted_date === todayIL;
  });
}

function recordCounted(ordIds, todayIL) {
  insertMany(ordIds, todayIL);
}

module.exports = { filterUncounted, recordCounted };
