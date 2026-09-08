/* Rebuild sample.json (demo data) from a master plan workbook.
   Usage: node tools/make-sample.js "/path/to/Production Plan.xlsx"
   The output holds real order rows, so it is gitignored on purpose. */
const fs = require('fs');
const P = require('../src/core.js'), U = P.util;
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/make-sample.js <workbook.xlsx>'); process.exit(1); }

(async () => {
  const m = await P.loadWorkbook(fs.readFileSync(SRC), {});
  const F = m.F;
  const cols = m.cols.map(c => [c.name, c.owner || '', c.formula ? 1 : 0]);
  const want = new Set(), byLine = new Map();
  const asOf = U.dayKey(m.asOf);
  for (const o of m.orders) {
    if (!U.isDate(o.v[F.sew1]) || !U.isDate(o.v[F.sew2]) || U.num(o.v[F.qty]) <= 0) continue;
    const ln = U.str(o.v[F.line]); if (!ln) continue;
    if (!byLine.has(ln)) byLine.set(ln, []);
    byLine.get(ln).push(o);
  }
  for (const [ln, arr] of byLine) {
    arr.sort((a, b) => Math.abs(U.dayKey(a.v[F.sew1]) - asOf) - Math.abs(U.dayKey(b.v[F.sew1]) - asOf));
    const take = Math.min(arr.length, ln.startsWith('A2- Line') ? 8 : 4);
    for (let i = 0; i < take; i++) want.add(arr[i]);
  }
  let ship = 0;
  for (const o of m.orders) { if (ship >= 14) break; if (P.orderProgress(m, o).shipped) { want.add(o); ship++; } }

  const skip = new Set([F.preStatus, F.fabIHStatus, F.merchComment, F.desc2].filter(x => x >= 0));
  m.dailyCols.forEach(c => skip.add(c)); m.historyCols.forEach(c => skip.add(c));
  const keep = Object.keys(P.FIELD_DEFS).map(k => F[k]).filter(c => c >= 0 && !skip.has(c));
  const BASE = U.dayKey(new Date(Date.UTC(2026, 0, 1)));
  const rows = [...want].map(o => {
    const cells = [], formulas = [];
    for (const c of keep) {
      let v = o.v[c]; if (v == null) continue;
      if (U.isDate(v)) { const y = v.getUTCFullYear(); if (y < 2000 || y > 2035) continue; v = 'd' + (U.dayKey(v) - BASE); }
      else if (typeof v === 'number') v = Math.round(v * 1000) / 1000;
      else v = String(v).slice(0, c === F.recipe ? 150 : 60);
      cells.push(c, v); if (o.f[c]) formulas.push(c);
    }
    return [o.r, formulas, cells];
  });
  const out = { c: cols, r: rows, base: BASE, asOf: U.ymd(m.asOf), n: m.ncols, hr: m.headerRow, src: SRC.split('/').pop(), total: m.orders.length };
  fs.writeFileSync(__dirname + '/../sample.json', JSON.stringify(out));
  console.log(`sample.json: ${rows.length} of ${m.orders.length} orders, ${Math.round(JSON.stringify(out).length / 1024)} KB`);
})();
