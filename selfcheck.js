/* Self-check for the plan core. Run: node selfcheck.js [path/to/plan.xlsx]
   Fails loudly if the stage chain, the drag maths, undo, or the Excel write-back break. */
const assert = require('assert');
const fs = require('fs');
const P = require('./src/core.js'), U = P.util;
const FILE = process.argv[2] || '/Users/khuongduypham/Downloads/Production Plan 28 Aug.xlsx';

(async () => {
  const m = await P.loadWorkbook(fs.readFileSync(FILE), { fileName: 'plan.xlsx' });
  const F = m.F;
  assert(m.orders.length > 100, 'no orders parsed');
  assert(Object.values(F).every(i => i >= 0), 'a known column header went missing');

  // dates: the derived chain follows the sheet's own rules and never lands on a Sunday
  const o = m.orders.find(x => U.isDate(x.v[F.sew1]) && U.isDate(x.v[F.sew2]) && x.f[F.pcd]);
  P.setCell(m, o, F.sew1, U.keyToDate(U.dayKey(o.v[F.sew1])));   // normalise, forces a recompute
  assert.equal(U.dayKey(o.v[F.pcd]), U.dayKey(U.plusSkip(o.v[F.sew1], -12)), 'cut date is not sewing start − 12');
  for (const k of ['pcd', 'markerRelease', 'washFirstOut', 'finLastOut', 'planExFactory'])
    assert(!U.isDate(o.v[F[k]]) || o.v[F[k]].getUTCDay() !== 0, k + ' fell on a Sunday');

  // one drag = one undo, and it restores every cell it touched
  const before = { s1: U.ymd(o.v[F.sew1]), s2: U.ymd(o.v[F.sew2]), line: o.v[F.line], undo: m.undo.length };
  P.beginGroup(m);
  P.setCell(m, o, F.sew1, U.addDays(o.v[F.sew1], 5));
  P.setCell(m, o, F.sew2, U.addDays(o.v[F.sew2], 5));
  const otherLine = m.lines.find(l => l.name !== before.line).name;
  P.setCell(m, o, F.line, otherLine);
  P.endGroup();
  assert.equal(m.undo.length, before.undo + 3, 'the drag did not record all three cell changes');
  P.undo(m);
  assert.equal(m.undo.length, before.undo, 'one undo must reverse the whole drag, not one cell of it');
  assert.equal(U.ymd(o.v[F.sew1]), before.s1, 'undo did not restore the sewing start');
  assert.equal(U.ymd(o.v[F.sew2]), before.s2, 'undo did not restore the sewing end');
  assert.equal(o.v[F.line], before.line, 'undo did not restore the line');

  // a style with no wash recipe gets no laundry lane and no washing load
  const dry = m.orders.find(x => !U.str(x.v[F.recipe]).trim());
  if (dry) {
    assert(P.isNonWash(m, dry), 'an order with no recipe was still treated as washed');
    const sink = new Map();
    assert.equal(P.spreadLoad(m, dry, P.STAGES[2], 'planned', U.dayKey(m.asOf), sink), false, 'a non-washed order loaded the laundry');
  }

  // capacity: sewing load per day stays near the line target the plan was built from
  const load = new Map();
  for (const x of m.orders) P.spreadLoad(m, x, P.STAGES[1], 'planned', U.dayKey(m.asOf), load);
  assert(load.size > 5, 'no sewing lanes loaded');

  // run state: every bucket must be reachable. A gate that fires on a blank cell
  // silently empties "ready" - that is the bug this guards.
  const runs = { running: 0, ready: 0, clear: 0, waiting: 0, done: 0 };
  for (const x of m.orders) runs[P.runState(m, x)]++;
  for (const k of Object.keys(runs)) assert(runs[k] > 0, `run state "${k}" is unreachable: ` + JSON.stringify(runs));
  assert(runs.ready >= 10, 'almost nothing reads as ready to run - a gate is probably firing on blank cells: ' + JSON.stringify(runs));
  for (const x of m.orders) {
    const st = P.runState(m, x), prog = P.orderProgress(m, x);
    if (st === 'ready' || st === 'waiting' || st === 'clear') assert(!prog.done.some(d => d > 0), st + ' but already producing: row ' + x.r);
    if (st === 'ready') {
      assert(P.openGates(m, x).length === 0, 'ready with an open gate: row ' + x.r);
      const lead = P.leadDays(m, x);
      assert(lead != null && lead <= P.READY_WINDOW_DAYS, 'ready but not about to run: row ' + x.r + ' lead ' + lead);
    }
    if (st === 'clear') assert(P.openGates(m, x).length === 0, 'clear with an open gate: row ' + x.r);
  }
  // an order that is fully packed must not still read as in production
  const stillRunning = m.orders.filter(x => P.runState(m, x) === 'running' && P.productionComplete(m, x));
  assert(stillRunning.length === 0, stillRunning.length + ' finished orders still read as running');
  // a shrinkage of "wt fab" must not be listed as a second reason beside fabric
  const dupReason = m.orders.filter(x => { const g = P.openGates(m, x); return g.includes('fabric') && g.includes('shrinkage') && /^wt fab$/i.test(U.str(x.v[F.shrinkStatus]).trim()); });
  assert(dupReason.length === 0, dupReason.length + ' orders list fabric and "wt fab" shrinkage as two separate blockers');

  // OTD is on-time delivery in days; a minus figure means late
  const bad = m.orders.find(x => P.otdDays(m, x) < 0);
  if (bad) assert(P.isLate(m, bad), 'a negative OTD was not flagged late');

  // write-back: edits land, untouched formulas survive, Excel is told to recalculate
  const NOTE = 'self-check <&>"quoted"';
  P.setCell(m, o, F.delayReason, NOTE);
  P.setCell(m, o, F.qty, 4242);
  // every kind of write the interface can make must survive the export
  const used = new Set([o]);
  const free = pred => { const x = m.orders.find(y => !used.has(y) && pred(y)); if (x) used.add(x); return x; };
  const withLine = free(x => U.isDate(x.v[F.sew1]) && U.str(x.v[F.line]));
  const withLd = free(x => U.str(x.v[F.ldLine]));
  const withFin = free(x => U.str(x.v[F.finLine]));
  const blankRemark = free(x => x.v[F.remark] == null && U.str(x.v[F.po]));
  const formulaCell = free(x => x.f[F.cusFinalDly]);
  const want = [];
  if (withLine) { P.setCell(m, withLine, F.line, null); want.push([withLine.r, F.line, null, 'cleared a lane (stash / take off)']); }
  if (withLd) { P.setCell(m, withLd, F.ldLine, null); want.push([withLd.r, F.ldLine, null, 'cleared a laundry lane']); }
  if (withFin) { P.setCell(m, withFin, F.finLine, 'L9'); want.push([withFin.r, F.finLine, 'L9', 'set a finishing lane']); }
  if (blankRemark) { P.setCell(m, blankRemark, F.remark, 'written into a blank cell'); want.push([blankRemark.r, F.remark, 'written into a blank cell', 'wrote a previously empty cell']); }
  if (formulaCell) { const d = new Date(Date.UTC(2026, 11, 24)); P.setCell(m, formulaCell, F.cusFinalDly, d); want.push([formulaCell.r, F.cusFinalDly, U.ymd(d), 'overwrote a formula cell']); }

  const buf = Buffer.from(await (await P.buildEditedWorkbook(m, {})).arrayBuffer());
  const zip = await require('jszip').loadAsync(buf);
  const xml = await zip.file(m.sheetPath).async('string');
  assert(/<f[ >]/.test(xml), 'every formula was stripped out');
  assert(!zip.file('xl/calcChain.xml'), 'the stale calc chain was left behind');
  assert((await zip.file('xl/workbook.xml').async('string')).includes('fullCalcOnLoad="1"'), 'Excel will not recalculate on open');

  // reopen the exported file: the edits survive a full round trip, the neighbouring row does not move
  const m2 = await P.loadWorkbook(buf, { fileName: 're-read.xlsx' });
  const back = m2;
  const same = P.orderByRow(back, o.r), neighbour = back.orders.find(x => x.r === o.r + 1);
  assert.equal(U.str(same.v[F.delayReason]), NOTE, 'the typed note did not survive the export');
  assert.equal(same.v[F.qty], 4242, 'the edited quantity did not survive the export');
  assert.equal(U.str(same.v[F.line]), before.line, 'an undone edit was exported anyway');
  if (neighbour) assert.equal(U.str(neighbour.v[F.po]), U.str(m.orders[m.orders.indexOf(o) + 1].v[F.po]), 'the next row was disturbed');
  for (const [row, col, expected, how] of want) {
    const back = P.orderByRow(m2, row);
    assert(back, 'row ' + row + ' vanished from the export');
    const got = U.isDate(back.v[col]) ? U.ymd(back.v[col]) : back.v[col];
    assert.equal(got == null ? null : String(got), expected == null ? null : String(expected),
      `${how}: ${U.idxToCol(col)}${row} came back as ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    assert.equal(back.f[col], 0, `${how}: ${U.idxToCol(col)}${row} still carries a formula after being edited`);
  }

  console.log(`OK — ${m.orders.length} orders, ${m.ncols} columns, export ${(buf.length / 1048576).toFixed(1)} MB`);
  console.log('   run states:', JSON.stringify(runs));
})();
