/* ui.js — Saitex Line Board */
(function () {
'use strict';
const PC = window.PlanCore, U = PC.util;
const { isDate, dayKey, keyToDate, addDays, ymd, fmtDate, fmtDateShort, num, str, parseYmd, monthKey, idxToCol, MON } = U;
const $ = id => document.getElementById(id);
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (k.startsWith('aria-')) { if (v != null) e.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(3)) { if (k == null || k === false) continue; e.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k))); }
  return e;
};
const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
const fmt = n => !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
const fmtK = n => !isFinite(n) ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 10000 ? Math.round(n / 1000) + 'k' : fmt(n);
const pct = n => !isFinite(n) ? '—' : Math.round(n * 100) + '%';
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const k of kids.flat(2)) if (k) e.appendChild(k); return e; };
const STAGES = PC.STAGES;
const stageColor = i => `var(--st${i + 1})`;
const RUN_LABEL = { running: 'Running', ready: 'Ready to run', clear: 'Cleared, not due yet', waiting: 'Waiting', done: 'Finished' };

const stageInk = i => `var(--st${i + 1}-ink)`;

/* ================= state ================= */
const S = {
  model: null, sample: false, view: 'overview',
  filters: { search: '', facets: {}, ranges: {}, custom: [], quick: {} },
  filtered: [], sel: null,
  board: { stage: 'sew', dayW: 30, from: null, days: 119, refitOnDrop: false, others: true, collapsed: new Set() },
  cap: { stage: 'all', grain: 'week', weeks: 14 },
  table: { preset: 'planner', sort: null, dir: 1 },
  caps: {}, storeKey: null, savedViews: [], railHidden: false,
  stash: new Map(), stashOpen: false,   // orders parked off the board, row -> where it came from
};
const VIEWS = [['overview', 'Overview'], ['board', 'Line board'], ['capacity', 'Capacity'], ['orders', 'Orders'], ['changes', 'Changes']];

/* ================= boot ================= */
function boot() {
  const t = localStorage.getItem('sxplan:theme'); if (t) document.documentElement.setAttribute('data-theme', t);
  $('themebtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nxt = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nxt); localStorage.setItem('sxplan:theme', nxt);
    if (S.view === 'overview' || S.view === 'capacity') render();
  };
  const tabs = $('tabs');
  for (const [id, label] of VIEWS) tabs.appendChild(h('button', { role: 'tab', 'data-v': id, 'aria-selected': id === S.view, onclick: () => setView(id) }, label));
  $('search').addEventListener('input', debounce(e => { S.filters.search = e.target.value.trim(); applyFilters(); }, 160));
  $('undo').onclick = () => { const u = PC.undo(S.model); if (u) afterEdit('Undo · ' + S.model.cols[u.c].name); };
  $('redo').onclick = () => { const u = PC.redo(S.model); if (u) afterEdit('Redo · ' + S.model.cols[u.c].name); };
  $('exportbtn').onclick = doExport;
  const openPicker = () => $('drop').classList.remove('hide');
  $('filechip').onclick = openPicker;
  $('openbtn').onclick = openPicker;
  $('pick').onclick = () => $('file').click();
  $('file').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); };
  const hasSample = !!window.SAMPLE;
  $('usesample').classList.toggle('hidden', !hasSample);
  $('usesample').onclick = () => { $('drop').classList.add('hide'); loadSample(); };
  $('scrim').onclick = () => closeDrawer();
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.remove('hide'); drop.classList.add('over'); } }));
  drop.addEventListener('dragleave', e => { if (e.target === drop) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); else if (S.model) drop.classList.add('hide'); });
  document.addEventListener('keydown', onKey);
  if (hasSample) loadSample(); else $('drop').classList.remove('hide');
}
function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (e.key === 'Escape') { if (document.querySelector('.pop')) closePop(); else if ($('drawer').classList.contains('on')) closeDrawer(); else if (!$('drop').classList.contains('hide') && S.model) $('drop').classList.add('hide'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('redo') : $('undo')).click(); return; }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); $('search').focus(); return; }
  const n = parseInt(e.key, 10); if (n >= 1 && n <= VIEWS.length) setView(VIEWS[n - 1][0]);
}
function setView(v) {
  S.view = v;
  for (const b of $('tabs').children) b.setAttribute('aria-selected', b.dataset.v === v);
  render();
}
function toast(msg, actionLabel, action) {
  const t = $('toast'); clear(t); t.appendChild(document.createTextNode(msg));
  if (actionLabel) t.appendChild(h('button', { onclick: () => { t.classList.remove('on'); action(); } }, actionLabel));
  t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 5200);
}

/* ================= loading ================= */
function setProgress(label, frac) {
  $('prog').classList.remove('hidden'); $('prog').firstElementChild.style.width = Math.round(frac * 100) + '%';
  $('progtext').textContent = label;
}
async function loadFile(f) {
  $('drop').classList.remove('hide'); setProgress('Reading file', 0.01);
  try {
    const buf = await f.arrayBuffer();
    const model = await PC.loadWorkbook(buf, { fileName: f.name, onProgress: setProgress });
    S.sample = false; adopt(model, f.name + ' · ' + f.size);
    $('drop').classList.add('hide'); $('prog').classList.add('hidden'); $('progtext').textContent = '';
  } catch (err) {
    console.error(err);
    $('progtext').textContent = 'Could not read that workbook: ' + (err.message || err) + '. Check it is an .xlsx saved from Excel.';
    $('prog').classList.add('hidden');
  }
}
function loadSample() {
  const D = window.SAMPLE;
  const cols = D.c.map((c, i) => ({ i, letter: idxToCol(i), name: c[0], nkey: U.normKey(c[0]), owner: c[1], formulaCount: c[2] ? 999 : 0, formula: !!c[2], isDaily: false, type: 'text', dateStyle: undefined }));
  const model = { fileName: D.src, sheetName: 'MASTER PLAN ', sheetPath: null, headerRow: D.hr, cols, ncols: D.n, orders: [], edits: new Map(), undo: [], redo: [], buffer: null, dailyCols: [], historyCols: [] };
  model.F = (function () { const f = {}; for (const k in PC.FIELD_DEFS) { const [letter, name] = PC.FIELD_DEFS[k]; const want = U.normKey(name); const at = cols[U.colToIdx(letter)]; f[k] = at && (at.nkey === want || at.nkey.indexOf(want) >= 0) ? U.colToIdx(letter) : (cols.find(c => c.nkey.indexOf(want) >= 0) || { i: -1 }).i; } return f; })();
  D.r.forEach((row, idx) => {
    const v = new Array(D.n).fill(null); const fl = new Uint8Array(D.n);
    const cells = row[2];
    for (let i = 0; i < cells.length; i += 2) {
      let val = cells[i + 1];
      if (typeof val === 'string' && /^d-?\d+$/.test(val)) val = keyToDate(D.base + parseInt(val.slice(1), 10));
      v[cells[i]] = val;
    }
    for (const c of row[1]) fl[c] = 1;
    model.orders.push({ r: row[0], v, f: fl, idx, dirty: false });
  });
  for (const col of model.cols) {
    let d = 0, n = 0, s = 0;
    for (const o of model.orders) { const val = o.v[col.i]; if (val == null) continue; if (isDate(val)) d++; else if (typeof val === 'number') n++; else s++; }
    const tot = d + n + s; col.nonEmpty = tot;
    col.type = tot === 0 ? 'text' : (d >= n && d >= s ? 'date' : (n >= s ? 'number' : 'text'));
  }
  model.asOf = parseYmd(D.asOf);
  PC.buildLines(model);
  S.sample = true; adopt(model, 'sample:' + D.src);
}
function adopt(model, key) {
  S.model = model; S.storeKey = 'sxplan:v2:' + key;
  S.filters = { search: $('search').value.trim(), facets: {}, ranges: {}, custom: [], quick: {} };
  S.caps = {}; S.sel = null; S.stash = new Map(); S.stashOpen = false;
  S.board.from = dayKey(model.asOf) - 7;
  restore();
  const chip = $('filechip'); clear(chip);
  chip.classList.toggle('sample', S.sample);
  chip.appendChild(h('span', { class: 'fname' }, model.fileName));
  chip.appendChild(h('span', { class: 'sm muted' }, S.sample ? `sample ${model.orders.length}` : `${fmt(model.orders.length)} MO`));
  chip.title = S.sample
    ? `Sample: ${model.orders.length} real orders from ${model.fileName}. Load the workbook to plan all of it and to export.`
    : `${model.fileName} — ${fmt(model.orders.length)} manufacturing orders, ${model.ncols} columns. Click to load a different workbook.`;
  applyFilters();
}
/* ---- persistence ---- */
function persist() {
  if (!S.storeKey) return;
  try {
    localStorage.setItem(S.storeKey, JSON.stringify({ edits: PC.exportEdits(S.model), caps: S.caps, views: S.savedViews,
      stash: [...S.stash.entries()], t: Date.now() }));
  } catch (e) { /* quota */ }
}
function restore() {
  S.savedViews = [];
  try {
    const raw = localStorage.getItem(S.storeKey); if (!raw) return;
    const d = JSON.parse(raw);
    S.caps = d.caps || {}; S.savedViews = d.views || [];
    S.stash = new Map((d.stash || []).filter(e => PC.orderByRow(S.model, e[0])));
    const n = PC.importEdits(S.model, d.edits);
    if (n) toast(`Restored ${n} unsaved edit${n > 1 ? 's' : ''} from your last session.`, 'Discard', discardAll);
  } catch (e) { }
}

/* ================= filters ================= */
const FACETS = [
  { key: 'customer', label: 'Buyer' }, { key: 'site', label: 'Factory site' }, { key: 'lineUnit', label: 'Sewing line' },
  { key: 'stage', label: 'Current stage' }, { key: 'late', label: 'Delivery risk' }, { key: 'inout', label: 'In-house / subcon' },
  { key: 'ldLine', label: 'Laundry line' }, { key: 'finLine', label: 'Finishing line' },
  { key: 'sewMonthKey', label: 'Sewing month' }, { key: 'dlyMonthKey', label: 'Delivery month' }, { key: 'pcdMonthKey', label: 'Cut month' },
  { key: 'productType', label: 'Product type' }, { key: 'groupProduct', label: 'Product group' }, { key: 'season', label: 'Season' },
  { key: 'status', label: 'Order status' }, { key: 'fitStatus', label: 'Fit approval' }, { key: 'ppStatus', label: 'PP approval' },
  { key: 'washAppStatus', label: 'Wash approval' }, { key: 'shrinkStatus', label: 'Shrinkage' }, { key: 'trimStatus', label: 'Trims' },
  { key: 'mill', label: 'Mill' }, { key: 'fabric', label: 'Fabric' }, { key: 'wash', label: 'Wash' }, { key: 'repeatNew', label: 'Repeat / new' },
];
const RANGES = [
  { key: 'pcd', label: 'Cut date' }, { key: 'sew1', label: 'Sewing start' }, { key: 'sew2', label: 'Sewing end' },
  { key: 'washLastOut', label: 'Wash out' }, { key: 'finLastOut', label: 'Finishing out' },
  { key: 'planExFactory', label: 'Ex-factory' }, { key: 'cusFinalDly', label: 'Customer delivery' }, { key: 'fabReqIH', label: 'Fabric needed' },
];
const QUICKS = [
  ['late', 'At risk / late'], ['wip', 'In production'], ['unassigned', 'No line yet'],
  ['fabricPending', 'Fabric not in-house'], ['approvalPending', 'Approval pending'],
  ['unconfirmed', 'Un-confirmed order'], ['dirty', 'Edited by me'], ['stashed', 'Stashed'],
];
function activeCount() {
  const f = S.filters; let n = 0;
  if (f.search) n++;
  for (const k in f.facets) if (f.facets[k] && f.facets[k].size) n++;
  for (const k in f.ranges) if (f.ranges[k] && (f.ranges[k][0] || f.ranges[k][1])) n++;
  n += f.custom.filter(c => c && c.col >= 0).length;
  for (const k in f.quick) if (f.quick[k]) n++;
  return n;
}
function applyFilters() {
  if (!S.model) return;
  const hit = PC.applyFilter(S.model, S.filters);
  S.filtered = S.filters.quick.stashed ? hit.filter(o => S.stash.has(o.r)) : hit.filter(o => !S.stash.has(o.r));
  renderRail(); render();
}
function toggleFacet(key, val) {
  const f = S.filters.facets; if (!f[key]) f[key] = new Set();
  if (f[key].has(val)) f[key].delete(val); else f[key].add(val);
  if (!f[key].size) delete f[key];
  applyFilters();
}
function setOnlyFacet(key, val) { S.filters.facets[key] = new Set([val]); applyFilters(); }
function clearFilters() { S.filters = { search: '', facets: {}, ranges: {}, custom: [], quick: {} }; $('search').value = ''; applyFilters(); }

function renderRail() {
  const rail = $('rail'); const openState = new Set([...rail.querySelectorAll('details[open]')].map(d => d.dataset.k));
  const firstRender = !rail.firstChild;
  const scroll = rail.scrollTop;
  clear(rail);
  const n = activeCount();
  rail.appendChild(h('div', { class: 'railhead' },
    h('span', { class: 'count' }, fmt(S.filtered.length), h('small', {}, ' / ' + fmt(S.model.orders.length))),
    h('span', { class: 'sm muted' }, fmtK(S.filtered.reduce((a, o) => a + num(o.v[S.model.F.qty]), 0)) + ' pcs'),
    n ? h('button', { class: 'clearall', onclick: clearFilters }, 'Clear ' + n) : null));

  // quick filters
  const qs = h('div', { class: 'qgrid' });
  for (const [k, label] of QUICKS) qs.appendChild(h('button', { class: 'chip', 'aria-pressed': !!S.filters.quick[k], onclick: () => { S.filters.quick[k] = !S.filters.quick[k]; if (!S.filters.quick[k]) delete S.filters.quick[k]; applyFilters(); } }, label));
  rail.appendChild(sec('quick', 'Quick filters', qs, true));

  // facets
  for (const F of FACETS) {
    const isOpen = firstRender ? ['customer', 'site', 'stage'].includes(F.key) : openState.has('f:' + F.key);
    const sel = S.filters.facets[F.key];
    const body = h('div');
    if (isOpen) {
      const counts = PC.facetCounts(S.model, S.model.orders, S.filters, F.key);
      let entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
      if (F.key === 'stage') entries.sort((a, b) => PC.STAGE_NAMES.indexOf(a[0]) - PC.STAGE_NAMES.indexOf(b[0]));
      if (/Month|month/.test(F.key)) entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      if (sel) for (const v of sel) if (!counts.has(v)) entries.unshift([v, 0]);
      const list = h('div', { class: 'facet' });
      if (entries.length > 12) body.appendChild(h('input', {
        class: 'fsearch', type: 'search', placeholder: 'Filter ' + F.label.toLowerCase(),
        oninput: e => { const q = e.target.value.toLowerCase(); for (const r of list.children) r.classList.toggle('hidden', q && !r.dataset.v.toLowerCase().includes(q)); }
      }));
      for (const [val, cnt] of entries.slice(0, 400)) {
        const on = sel && sel.has(val);
        list.appendChild(h('button', { class: 'frow', role: 'checkbox', 'aria-checked': !!on, 'data-v': String(val), onclick: () => toggleFacet(F.key, val) },
          h('i', { class: 'box' }),
          F.key === 'stage' ? h('i', { class: 'swatch', style: 'background:' + stageSwatch(val) }) : null,
          F.key === 'late' ? h('i', { class: 'swatch', style: 'background:' + (val === 'On plan' ? 'var(--sx-intent-success)' : 'var(--sx-intent-danger)') }) : null,
          h('span', { class: 'lbl' }, prettyFacet(F.key, val)), h('span', { class: 'cnt' }, fmt(cnt))));
      }
      body.appendChild(list);
    }
    rail.appendChild(sec('f:' + F.key, F.label, body, isOpen, sel ? sel.size : 0));
  }

  // date ranges
  const rOpen = firstRender ? false : openState.has('ranges');
  const rb = h('div');
  for (const R of RANGES) {
    const cur = S.filters.ranges[R.key] || ['', ''];
    rb.appendChild(h('div', { class: 'daterow' }, h('label', {}, R.label),
      h('input', { class: 'inp', type: 'date', value: cur[0], 'aria-label': R.label + ' from', onchange: e => { S.filters.ranges[R.key] = [e.target.value, (S.filters.ranges[R.key] || [])[1] || '']; applyFilters(); } }),
      h('input', { class: 'inp', type: 'date', value: cur[1], 'aria-label': R.label + ' to', onchange: e => { S.filters.ranges[R.key] = [(S.filters.ranges[R.key] || [])[0] || '', e.target.value]; applyFilters(); } })));
  }
  rail.appendChild(sec('ranges', 'Date ranges', rb, rOpen, Object.values(S.filters.ranges).filter(v => v && (v[0] || v[1])).length));

  // column rules
  const cOpen = firstRender ? false : openState.has('rules');
  const cb = h('div');
  if (cOpen) {
    S.filters.custom.forEach((rule, i) => {
      const col = S.model.cols[rule.col];
      const colSel = h('select', { onchange: e => { rule.col = +e.target.value; applyFilters(); } },
        ...S.model.cols.map(c => h('option', { value: c.i, selected: c.i === rule.col }, c.letter + ' · ' + c.name.slice(0, 40))));
      const ops = [['contains', 'contains'], ['notContains', 'does not contain'], ['eq', 'is'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['between', 'between'], ['empty', 'is blank'], ['notEmpty', 'is not blank']];
      const opSel = h('select', { onchange: e => { rule.op = e.target.value; renderRail(); applyFilters(); } }, ...ops.map(([v, l]) => h('option', { value: v, selected: v === rule.op }, l)));
      const needs2 = rule.op === 'between'; const needsV = !['empty', 'notEmpty'].includes(rule.op);
      const type = col && col.type === 'date' && !['contains', 'notContains'].includes(rule.op) ? 'date' : 'text';
      const row2 = h('div', { class: 'row2' },
        needsV ? h('input', { type, value: rule.value || '', placeholder: 'value', oninput: debounce(e => { rule.value = e.target.value; applyFilters(); }, 250) }) : null,
        needs2 ? h('input', { type, value: rule.value2 || '', placeholder: 'and', oninput: debounce(e => { rule.value2 = e.target.value; applyFilters(); }, 250) }) : null);
      cb.appendChild(h('div', { class: 'rule' }, colSel, h('button', { class: 'x', title: 'Remove rule', onclick: () => { S.filters.custom.splice(i, 1); renderRail(); applyFilters(); } }, '×'), opSel, h('span'), row2));
    });
    cb.appendChild(h('button', { class: 'btn', onclick: () => { S.filters.custom.push({ col: S.model.F.qty, op: 'gte', value: '' }); renderRail(); } }, '+ Add rule on any column'));
  }
  rail.appendChild(sec('rules', 'Column rules', cb, cOpen, S.filters.custom.length));

  // saved views
  const vOpen = openState.has('views');
  const vb = h('div');
  if (vOpen) {
    const g = h('div', { class: 'qgrid' });
    S.savedViews.forEach((v, i) => g.appendChild(h('button', { class: 'chip', title: 'Apply saved view', onclick: () => { applySaved(v); } }, v.name,
      h('span', { class: 'cn', onclick: e => { e.stopPropagation(); S.savedViews.splice(i, 1); persist(); renderRail(); } }, '×'))));
    vb.appendChild(g);
    vb.appendChild(h('button', { class: 'btn', style: 'margin-top:6px', onclick: saveCurrentView }, 'Save current filters'));
  }
  rail.appendChild(sec('views', 'Saved views', vb, vOpen, S.savedViews.length));
  rail.scrollTop = scroll;
}
function sec(key, label, body, open, badge) {
  const d = h('details', { class: 'fsec', 'data-k': key, open: !!open },
    h('summary', { onclick: () => setTimeout(renderRail, 0) }, label, badge ? h('span', { class: 'n' }, badge) : null),
    h('div', { class: 'fbody' }, body));
  return d;
}
function prettyFacet(key, val) {
  if (/MonthKey$/.test(key) && /^\d{4}-\d{2}$/.test(val)) return MON[+val.slice(5) - 1] + " '" + val.slice(2, 4);
  return String(val);
}
function stageSwatch(label) { const i = PC.STAGE_NAMES.indexOf(label); if (i <= 0) return 'var(--sx-border-strong)'; if (i > 6) return 'var(--sx-intent-success)'; return stageColor(i - 1); }
function saveCurrentView() {
  const name = prompt('Name this view'); if (!name) return;
  S.savedViews.push({
    name, view: S.view, boardStage: S.board.stage, search: S.filters.search,
    facets: Object.fromEntries(Object.entries(S.filters.facets).map(([k, v]) => [k, [...v]])),
    ranges: JSON.parse(JSON.stringify(S.filters.ranges)), custom: JSON.parse(JSON.stringify(S.filters.custom)), quick: { ...S.filters.quick },
  });
  persist(); renderRail();
}
function applySaved(v) {
  S.filters.search = v.search || ''; $('search').value = v.search || '';
  S.filters.facets = Object.fromEntries(Object.entries(v.facets || {}).map(([k, a]) => [k, new Set(a)]));
  S.filters.ranges = v.ranges || {}; S.filters.custom = v.custom || []; S.filters.quick = v.quick || {};
  if (v.boardStage) S.board.stage = v.boardStage;
  setView(v.view || S.view); applyFilters();
}

/* ================= capacity model ================= */
function stageByKey(k) { return STAGES.find(s => s.key === k); }
function laneList(stageKey) {
  const m = S.model;
  if (stageKey === 'sew') {
    const groups = [];
    for (const site of m.sites) groups.push({ group: site.site + (site.inout === 'Inside' ? ' · in-house' : ' · subcontract'), lines: site.lines.map(l => ({ name: l.name, label: l.label })) });
    return groups;
  }
  if (stageKey === 'wash') return [{ group: 'Laundry lines', lines: m.ldLines.filter(l => !/^non/i.test(l.name)).map(l => ({ name: l.name, label: 'LD ' + l.name })) }];
  if (stageKey === 'fin' || stageKey === 'pack') return [{ group: 'Finishing lines', lines: m.finLines.map(l => ({ name: l.name, label: l.name })) }];
  return [{ group: 'Factory sites', lines: m.sites.map(s => ({ name: s.site, label: s.site })) }];
}
function buildLoad(stageKey, orders, mode) {
  const stage = stageByKey(stageKey); const out = new Map(); const meta = new Map();
  const asOfKey = dayKey(S.model.asOf);
  for (const o of orders) PC.spreadLoad(S.model, o, stage, mode || 'planned', asOfKey, out, meta);
  return { load: out, meta };
}
function capFor(stageKey, res, loadMap) {
  const ov = S.caps[stageKey] && S.caps[stageKey][res];
  if (typeof ov === 'number' && ov > 0) return { cap: ov, est: false };
  if (stageKey === 'sew') { const L = S.model.lineMap.get(res); if (L && L.target) return { cap: L.target, est: false }; }
  if (loadMap) { const a = PC.autoCapacity(loadMap, 0.85); if (a > 0) return { cap: a, est: true }; }
  return { cap: 0, est: true };
}
function setCap(stageKey, res, val) { if (!S.caps[stageKey]) S.caps[stageKey] = {}; if (val > 0) S.caps[stageKey][res] = val; else delete S.caps[stageKey][res]; persist(); }
function ratioClass(r) { return r > 1.001 ? 'over' : r > 0.85 ? 'near' : 'under'; }
function heatStyle(r) {
  if (!isFinite(r) || r <= 0) return '';
  if (r > 1.0) { const t = Math.min(1, (r - 1) / 0.8); return `background:color-mix(in srgb, var(--sx-intent-danger) ${Math.round(24 + t * 58)}%, transparent);color:var(--sx-text-primary)`; }
  if (r > 0.85) return 'background:var(--sx-tint-warning);color:var(--sx-text-primary)';
  const t = r / 0.85; return `background:color-mix(in srgb, var(--st3) ${Math.round(8 + t * 40)}%, transparent)`;
}

/* ================= render dispatch ================= */
function render() {
  if (!S.model) return;
  const view = $('view'), bar = $('viewbar');
  clear(view); clear(bar);
  bar.appendChild(h('button', { class: 'btn icon', title: S.railHidden ? 'Show filters' : 'Hide filters', onclick: () => { S.railHidden = !S.railHidden; $('rail').classList.toggle('collapsed', S.railHidden); render(); } }, S.railHidden ? '»' : '«'));
  if (S.view === 'overview') renderOverview(view, bar);
  else if (S.view === 'board') renderBoard(view, bar);
  else if (S.view === 'capacity') renderCapacity(view, bar);
  else if (S.view === 'orders') renderOrders(view, bar);
  else renderChanges(view, bar);
  syncEditUI();
}
function syncEditUI() {
  const n = S.model ? S.model.edits.size : 0;
  const ec = $('editcount'); ec.textContent = n; ec.classList.toggle('hidden', !n);
  $('undo').disabled = !S.model || !S.model.undo.length;
  $('redo').disabled = !S.model || !S.model.redo.length;
  $('exportbtn').classList.toggle('primary', n > 0);
}
function afterEdit(msg, undoable) {
  persist(); applyFilters();
  if (msg) toast(msg, undoable ? 'Undo' : null, undoable ? () => { $('undo').click(); } : null);
  if ($('drawer').classList.contains('on') && S.sel) openDrawer(S.sel, true);
  syncEditUI();
}

/* ================= view: overview ================= */
function renderOverview(view, bar) {
  const m = S.model, F = m.F, rows = S.filtered;
  bar.appendChild(h('span', { class: 'vlabel' }, 'Plan as of ' + fmtDate(m.asOf)));
  bar.appendChild(h('span', { class: 'sm muted' }, `${fmt(rows.length)} orders in view`));
  bar.appendChild(h('div', { class: 'spacer', style: 'flex:1' }));
  if (S.sample) bar.appendChild(h('button', { class: 'tag warn', onclick: () => $('drop').classList.remove('hide') },
    `Sample: ${m.orders.length} of ${fmt(window.SAMPLE.total)} orders — open your workbook`));

  const wrap = h('div', { class: 'ov' });
  // ---- KPIs
  let qty = 0, open = 0, openQty = 0, late = 0, lateQty = 0, wip = 0, shipped = 0, shippedOnTime = 0, exWeek = 0, exWeekQty = 0, blocked = 0;
  const asOfK = dayKey(m.asOf), weekEnd = asOfK + 7;
  const stagePcs = new Array(6).fill(0), stageDone = new Array(6).fill(0);
  for (const o of rows) {
    const p = PC.orderProgress(m, o); qty += p.qty;
    if (p.shipped) { shipped++; const otd = PC.otdDays(m, o); if (otd == null || otd >= 0) shippedOnTime++; }
    else { open++; openQty += p.qty; }
    if (p.stage >= 0 && p.stage <= 5) wip++;
    for (let i = 0; i < 6; i++) { stagePcs[i] += p.qty; stageDone[i] += Math.min(p.done[i], p.qty); }
    if (PC.isLate(m, o)) { late++; lateQty += p.qty; }
    const ex = o.v[F.planExFactory];
    if (isDate(ex) && dayKey(ex) >= asOfK && dayKey(ex) <= weekEnd) { exWeek++; exWeekQty += p.qty; }
    if (!p.shipped && PC.approvalPending(m, o)) blocked++;
  }
  const kpis = h('div', { class: 'kpis' });
  const kpi = (k, v, s, cls, act) => kpis.appendChild(h('button', { class: 'kpi ' + (cls || ''), onclick: act || null, title: act ? 'Filter to these orders' : '' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), h('span', { class: 's' }, s)));
  kpi('Open orders', fmt(open), fmtK(openQty) + ' pcs to make', '', () => { S.filters.quick.wip = false; setOnlyFacet('late', 'On plan'); });
  kpi('Planned quantity', fmtK(qty), fmt(rows.length) + ' manufacturing orders');
  kpi('At risk or late', fmt(late), fmtK(lateQty) + ' pcs · ex-factory after delivery', late ? 'alert' : 'good', () => { S.filters.quick.late = true; applyFilters(); });
  kpi('In production', fmt(wip), 'cut through packing', '', () => { S.filters.quick.wip = true; applyFilters(); });
  kpi('Ex-factory this week', fmt(exWeek), fmtK(exWeekQty) + ' pcs by ' + fmtDateShort(keyToDate(weekEnd)), '', () => { S.filters.ranges.planExFactory = [ymd(m.asOf), ymd(keyToDate(weekEnd))]; applyFilters(); });
  kpi('Approvals pending', fmt(blocked), 'fit, PP or wash not signed off', blocked ? 'warn' : '', () => { S.filters.quick.approvalPending = true; applyFilters(); });
  kpi('Shipped', fmt(shipped), shipped ? pct(shippedOnTime / shipped) + ' on time' : 'none yet', 'good', () => setOnlyFacet('stage', 'Shipped'));
  wrap.appendChild(kpis);

  const bandTop = h('div'), cards = h('div', { class: 'masonry' }), bandBottom = h('div');
  // ---- stage funnel
  {
    const p = panel('Where the quantity sits', 'plan vs done, all filtered orders');
    const body = h('div', { class: 'funnel' });
    const maxQ = Math.max(...stagePcs, 1);
    STAGES.forEach((st, i) => {
      const done = stageDone[i], total = stagePcs[i], bal = Math.max(0, total - done);
      body.appendChild(h('button', { class: 'frow2', onclick: () => setOnlyFacet('stage', st.name), title: 'Filter to orders now in ' + st.name },
        h('span', { class: 'nm' }, h('i', { class: 'dot', style: 'background:' + stageColor(i) }), st.name),
        h('span', { class: 'bar' },
          h('i', { style: `width:${(done / maxQ) * 100}%;background:${stageColor(i)}` }),
          h('i', { style: `width:${(bal / maxQ) * 100}%;background:${stageColor(i)};opacity:.22` })),
        h('span', { class: 'fig' }, h('b', {}, fmtK(done)), ' done · ', fmtK(bal), ' left')));
    });
    body.appendChild(h('div', { class: 'legend' },
      h('span', {}, h('i', { style: 'background:var(--st4)' }), 'completed'),
      h('span', {}, h('i', { style: 'background:var(--st4);opacity:.22' }), 'balance to do'),
      h('span', { class: 'muted' }, 'Click a stage to filter every view.')));
    p.querySelector('.body').appendChild(body); cards.appendChild(p);
  }
  // ---- sewing load vs capacity by week
  {
    const p = panel('Sewing load against line capacity', 'pieces per week across every sewing line in this filter');
    p.querySelector('.body').appendChild(loadVsCapacityChart('sew'));
    bandTop.appendChild(p);
  }
  // ---- late by buyer
  {
    const p = panel('At-risk quantity by buyer', 'ex-factory later than the confirmed delivery');
    const byC = new Map();
    for (const o of rows) if (PC.isLate(m, o)) { const c = str(o.v[F.customer]) || '(none)'; byC.set(c, (byC.get(c) || 0) + num(o.v[F.qty])); }
    const top = [...byC.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9);
    const body = h('div', { class: 'funnel' });
    if (!top.length) body.appendChild(h('div', { class: 'empty' }, 'No order in this view is forecast to miss its delivery.'));
    const mx = top.length ? top[0][1] : 1;
    for (const [c, q] of top) body.appendChild(h('button', { class: 'frow2', onclick: () => { setOnlyFacet('customer', c); S.filters.quick.late = true; applyFilters(); } },
      h('span', { class: 'nm' }, c), h('span', { class: 'bar' }, h('i', { style: `width:${(q / mx) * 100}%;background:var(--sx-intent-danger)` })),
      h('span', { class: 'fig' }, h('b', {}, fmtK(q)), ' pcs')));
    p.querySelector('.body').appendChild(body); cards.appendChild(p);
  }
  // ---- most overloaded line-weeks
  {
    const p = panel('Sewing lines over capacity', 'next 8 weeks, remaining quantity only');
    const { load } = buildLoad('sew', rows, 'remaining');
    const rowsOut = [];
    for (const [res, days] of load) {
      const { cap } = capFor('sew', res, days); if (!cap) continue;
      const byWeek = new Map();
      for (const [k, v] of days) { if (k < asOfK || k > asOfK + 56) continue; const wk = U.weekKey(keyToDate(k)); byWeek.set(wk, (byWeek.get(wk) || 0) + v); }
      for (const [wk, v] of byWeek) { const days2 = PC.workdayCount(wk - 6, wk); const c = cap * days2; if (v > c) rowsOut.push({ res, wk, v, c, r: v / c }); }
    }
    rowsOut.sort((a, b) => b.r - a.r);
    const body = h('div', { class: 'list' });
    if (!rowsOut.length) body.appendChild(h('div', { class: 'empty' }, 'Every sewing line fits its remaining load for the next 8 weeks.'));
    for (const r of rowsOut.slice(0, 10)) {
      const L = m.lineMap.get(r.res);
      body.appendChild(h('button', { class: 'lrow', style: 'grid-template-columns:1fr auto auto', onclick: () => { setOnlyFacet('lineUnit', L ? L.label : r.res); S.board.stage = 'sew'; S.board.from = r.wk - 20; setView('board'); } },
        h('span', { class: 't' }, r.res, h('span', { class: 'm' }, '  week to ' + fmtDateShort(keyToDate(r.wk)))),
        h('span', { class: 'm mono' }, fmt(r.v) + ' / ' + fmt(r.c) + ' pcs'),
        h('span', { class: 'tag bad' }, '+' + fmt(r.v - r.c))));
    }
    p.querySelector('.body').appendChild(body); cards.appendChild(p);
  }
  // ---- what is blocking the next cuts
  {
    const p = panel('Blocked before the cut date', 'planned to cut within 14 days, still waiting on something');
    const soon = [];
    for (const o of rows) {
      const cut = o.v[F.pcd];
      if (!isDate(cut) || dayKey(cut) < asOfK || dayKey(cut) > asOfK + 14) continue;
      if (num(o.v[F.cutQty]) > 0) continue;
      const gates = PC.openGates(m, o);
      if (gates.length) soon.push({ o, cut, gates });
    }
    soon.sort((a, b) => dayKey(a.cut) - dayKey(b.cut));
    const body = h('div', { class: 'list' });
    if (!soon.length) body.appendChild(h('div', { class: 'empty' }, 'Nothing due to cut in the next 14 days is waiting on fabric, approvals, trims or shrinkage.'));
    for (const s of soon.slice(0, 12)) body.appendChild(h('button', { class: 'lrow', style: 'grid-template-columns:112px 1fr auto', onclick: () => openDrawer(s.o) },
      h('span', { class: 't mono' }, fmtDate(s.cut)),
      h('span', { class: 'm' }, str(s.o.v[F.customer]) + ' · ' + str(s.o.v[F.style]) + ' · ' + fmt(num(s.o.v[F.qty])) + ' pcs'),
      h('span', { style: 'display:flex;gap:3px' }, ...s.gates.map(g => h('span', { class: 'tag warn' }, g)))));
    if (soon.length > 12) body.appendChild(h('button', { class: 'lrow', style: 'grid-template-columns:1fr', onclick: () => { S.filters.ranges.pcd = [ymd(m.asOf), ymd(keyToDate(asOfK + 14))]; setView('orders'); applyFilters(); } },
      h('span', { class: 'm' }, `${soon.length - 12} more — open them in the table`)));
    p.querySelector('.body').appendChild(body); cards.appendChild(p);
  }
  // ---- idle capacity: where work could still go
  {
    const p = panel('Room on the lines', 'next 14 days, sewing lines under 70% of their daily target');
    const { load } = buildLoad('sew', S.filtered, 'remaining');
    const spare = [];
    for (const L of m.lines) {
      if (!L.target) continue;
      const days = load.get(L.name) || new Map();
      let used = 0, cap = 0;
      for (let k = asOfK; k <= asOfK + 13; k++) { if (keyToDate(k).getUTCDay() === 0) continue; used += days.get(k) || 0; cap += L.target; }
      if (!cap) continue;
      const r = used / cap;
      if (r < 0.7) spare.push({ L, r, free: cap - used });
    }
    spare.sort((a, b) => b.free - a.free);
    const body = h('div', { class: 'funnel' });
    if (!spare.length) body.appendChild(h('div', { class: 'empty' }, 'Every sewing line is at least 70% committed for the next two weeks.'));
    for (const s of spare.slice(0, 8)) body.appendChild(h('button', { class: 'frow2', title: 'Show this line on the board', onclick: () => { setOnlyFacet('lineUnit', s.L.label); S.board.stage = 'sew'; setView('board'); } },
      h('span', { class: 'nm' }, s.L.label, h('span', { class: 'muted' }, ' ' + s.L.site)),
      h('span', { class: 'bar' }, h('i', { style: `width:${Math.min(100, s.r * 100)}%;background:var(--st3)` })),
      h('span', { class: 'fig' }, h('b', {}, fmtK(s.free)), ' pcs free · ', pct(s.r))));
    p.querySelector('.body').appendChild(body); cards.appendChild(p);
  }
  // ---- ex-factory outlook
  {
    const p = panel('Ex-factory outlook', 'pieces leaving the factory each week, and how much of it is already late');
    const weeks = []; for (let i = 0; i < 9; i++) weeks.push(U.weekKey(keyToDate(asOfK + i * 7)));
    const uniq = [...new Set(weeks)];
    const ok = new Map(uniq.map(w => [w, 0])), bad = new Map(uniq.map(w => [w, 0]));
    for (const o of rows) {
      const ex = o.v[F.planExFactory]; if (!isDate(ex) || ex.getUTCFullYear() < 2000) continue;
      const w = U.weekKey(ex); if (!ok.has(w)) continue;
      const q = num(o.v[F.qty]);
      (PC.isLate(m, o) ? bad : ok).set(w, (PC.isLate(m, o) ? bad : ok).get(w) + q);
    }
    const W = 640, H = 190, PAD = { l: 46, r: 8, t: 12, b: 28 };
    const maxV = Math.max(1, ...uniq.map(w => ok.get(w) + bad.get(w)));
    const bw = (W - PAD.l - PAD.r) / uniq.length;
    const x = i => PAD.l + i * bw, y = v => PAD.t + (1 - v / maxV) * (H - PAD.t - PAD.b);
    const g = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Pieces leaving the factory each week' });
    for (let i = 0; i <= 4; i++) { const v = maxV * i / 4; g.appendChild(sv('line', { class: 'gridline', x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v) })); g.appendChild(sv('text', { x: PAD.l - 6, y: y(v) + 3, 'text-anchor': 'end', text: fmtK(v) })); }
    uniq.forEach((w, i) => {
      const a = ok.get(w), b = bad.get(w), tot = a + b;
      if (b) g.appendChild(sv('rect', { x: x(i) + 4, y: y(tot), width: Math.max(2, bw - 8), height: Math.max(1, y(a) - y(tot) - 2), fill: 'var(--sx-intent-danger)', rx: 1 }));
      if (a) g.appendChild(sv('rect', { x: x(i) + 4, y: y(a), width: Math.max(2, bw - 8), height: Math.max(1, H - PAD.b - y(a)), fill: 'var(--st4)', rx: 1 }));
      if (tot) g.appendChild(sv('text', { class: 'val', x: x(i) + bw / 2, y: y(tot) - 4, 'text-anchor': 'middle', text: fmtK(tot) }));
      g.appendChild(sv('text', { x: x(i) + bw / 2, y: H - 10, 'text-anchor': 'middle', text: fmtDateShort(keyToDate(w)) }));
    });
    g.appendChild(sv('line', { class: 'axis', x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b }));
    const body = p.querySelector('.body');
    body.appendChild(g);
    body.appendChild(h('div', { class: 'legend' },
      h('span', {}, h('i', { style: 'background:var(--st4)' }), 'on plan'),
      h('span', {}, h('i', { style: 'background:var(--sx-intent-danger)' }), 'already late'),
      h('span', { class: 'muted' }, 'week ending Saturday')));
    cards.appendChild(p);
  }
  // ---- at risk list
  {
    const p = panel('Orders to act on first', 'sorted by how late ex-factory runs');
    const risky = rows.filter(o => PC.isLate(m, o)).map(o => {
      const ex = o.v[F.planExFactory], dly = o.v[F.cusFinalDly];
      const slip = isDate(ex) && isDate(dly) ? dayKey(ex) - dayKey(dly) : 999;
      return { o, slip };
    }).sort((a, b) => b.slip - a.slip).slice(0, 40);
    const body = h('div', { class: 'list' });
    if (!risky.length) body.appendChild(h('div', { class: 'empty' }, 'Nothing at risk in this view.'));
    for (const { o, slip } of risky) {
      const p2 = PC.orderProgress(m, o);
      body.appendChild(h('button', { class: 'lrow', style: 'grid-template-columns:150px 1fr 78px 62px', onclick: () => openDrawer(o) },
        h('span', { class: 't mono' }, str(o.v[F.po])),
        h('span', { class: 'm' }, [str(o.v[F.customer]), str(o.v[F.style]), str(o.v[F.line])].filter(Boolean).join(' · ')),
        h('span', { class: 'm mono' }, fmt(num(o.v[F.qty])) + ' pcs'),
        h('span', { class: 'tag ' + (slip > 14 ? 'bad' : 'warn') }, slip === 999 ? 'no date' : '+' + slip + 'd')));
    }
    p.querySelector('.body').appendChild(body); bandBottom.appendChild(p);
  }
  wrap.appendChild(bandTop); wrap.appendChild(cards); wrap.appendChild(bandBottom);
  view.appendChild(wrap);
}
// A button that opens a small menu under itself.
function menuButton(label, title, build) {
  const b = h('button', { class: 'btn menubtn', title, onclick: () => {
    const r = b.getBoundingClientRect();
    const pop = openPop(label, r.left - 12, r.bottom - 10);
    pop.classList.add('menupop');
    build(pop);
  } }, label, h('span', { class: 'caret' }, '▾'));
  return b;
}
function menuRow(label, checked, onSelect, hint) {
  return h('button', { class: 'mrow' + (checked ? ' on' : ''), onclick: () => { closePop(); onSelect(); } },
    h('span', { class: 'tick' }, checked ? '✓' : ''),
    h('span', { class: 'mlabel' }, label),
    hint ? h('span', { class: 'mhint' }, hint) : null);
}
function panel(title, sub) {
  return h('div', { class: 'panel' }, h('header', {}, h('h3', {}, title), sub ? h('span', { class: 'sub' }, sub) : null), h('div', { class: 'body' }));
}
function loadVsCapacityChart(stageKey) {
  const m = S.model, asOfK = dayKey(m.asOf);
  const { load } = buildLoad(stageKey, S.filtered, 'planned');
  const weeks = []; for (let i = -2; i < 14; i++) weeks.push(U.weekKey(keyToDate(asOfK + i * 7)));
  const uniq = [...new Set(weeks)];
  const loadByWeek = new Map(uniq.map(w => [w, 0])), capByWeek = new Map(uniq.map(w => [w, 0]));
  for (const [res, days] of load) {
    const { cap } = capFor(stageKey, res, days);
    for (const [k, v] of days) { const w = U.weekKey(keyToDate(k)); if (loadByWeek.has(w)) loadByWeek.set(w, loadByWeek.get(w) + v); }
    if (cap) for (const w of uniq) capByWeek.set(w, capByWeek.get(w) + cap * PC.workdayCount(w - 6, w));
  }
  const W = Math.max(720, uniq.length * 62), H = 210, PAD = { l: 46, r: 8, t: 12, b: 26 };
  const maxV = Math.max(1, ...loadByWeek.values(), ...capByWeek.values());
  const x = i => PAD.l + i * ((W - PAD.l - PAD.r) / uniq.length);
  const bw = ((W - PAD.l - PAD.r) / uniq.length) - 6;
  const y = v => PAD.t + (1 - v / maxV) * (H - PAD.t - PAD.b);
  const g = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Weekly sewing load against capacity' });
  for (let i = 0; i <= 4; i++) { const v = maxV * i / 4; g.appendChild(sv('line', { class: 'gridline', x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v) })); g.appendChild(sv('text', { x: PAD.l - 6, y: y(v) + 3, 'text-anchor': 'end' , text: fmtK(v)})); }
  uniq.forEach((w, i) => {
    const v = loadByWeek.get(w) || 0, c = capByWeek.get(w) || 0;
    const over = c > 0 && v > c;
    g.appendChild(sv('rect', { x: x(i) + 3, y: y(v), width: Math.max(2, bw), height: Math.max(0, H - PAD.b - y(v)), fill: over ? 'var(--sx-intent-danger)' : 'var(--st3)', rx: 1 }));
    if (c > 0) g.appendChild(sv('line', { class: 'caplin', x1: x(i) + 1, x2: x(i) + bw + 5, y1: y(c), y2: y(c) }));
    g.appendChild(sv('text', { x: x(i) + bw / 2 + 3, y: H - 9, 'text-anchor': 'middle', text: fmtDateShort(keyToDate(w)) }));
    if (v) g.appendChild(sv('text', { class: 'val', x: x(i) + bw / 2 + 3, y: y(v) - 4, 'text-anchor': 'middle', text: fmtK(v) }));
  });
  g.appendChild(sv('line', { class: 'axis', x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b }));
  const box = h('div');
  box.appendChild(g);
  box.appendChild(h('div', { class: 'legend' },
    h('span', {}, h('i', { style: 'background:var(--st3)' }), 'planned load (pcs)'),
    h('span', {}, h('i', { style: 'background:var(--sx-intent-danger)' }), 'week over capacity'),
    h('span', {}, h('i', { style: 'background:var(--sx-intent-danger);height:2px;width:16px' }), 'capacity = line target × working days')));
  return box;
}

/* ================= view: line board ================= */
function renderBoard(view, bar) {
  const m = S.model, F = m.F, B = S.board;
  const stage = stageByKey(B.stage);
  // toolbar: what you touch every minute stays out; the rest lives under Board options
  bar.appendChild(menuButton('Lanes: ' + stage.short, 'Which production stage the lanes represent', pop => {
    for (const st of STAGES) pop.appendChild(menuRow(st.name, st.key === B.stage, () => { B.stage = st.key; render(); },
      st.key === 'sew' ? 'sewing lines' : st.key === 'wash' ? 'laundry lines' : (st.key === 'fin' || st.key === 'pack') ? 'finishing lines' : 'factory sites'));
  }));
  const zoomOut = h('span', { class: 'vlabel', style: 'min-width:52px' }, B.dayW + 'px/day');
  let zoomTimer = null;
  const drawZoom = () => { clearTimeout(zoomTimer); zoomTimer = setTimeout(() => { render(); const z = document.querySelector('.zoom'); if (z) z.focus(); }, 90); };
  const zoom = h('input', {
    type: 'range', class: 'zoom', min: 12, max: 64, step: 2, value: B.dayW, 'aria-label': 'Day width in pixels',
    title: 'How wide one day is on the board',
    oninput: e => { B.dayW = +e.target.value; zoomOut.textContent = B.dayW + 'px/day'; drawZoom(); }
  });
  bar.appendChild(zoom); bar.appendChild(zoomOut);
  bar.appendChild(h('button', { class: 'btn', title: 'Scroll back to this week', onclick: () => { B.from = dayKey(m.asOf) - 7; render(); } }, 'Today'));
  bar.appendChild(menuButton('Board options', 'Fit, column width, load display and drop behaviour', pop => {
    pop.appendChild(menuRow('Fit the dates to the filter', false, () => fitToFiltered(), 'zoom to what is showing'));
    pop.appendChild(menuRow('Narrow the line column', B.narrowLanes, () => { B.narrowLanes = !B.narrowLanes; render(); }, 'when it covers the bars'));
    pop.appendChild(menuRow('Show load from filtered-out orders', B.others, () => { B.others = !B.others; render(); }, 'as grey bars'));
    pop.appendChild(menuRow('Refit duration when dropped on a line', B.refitOnDrop, () => { B.refitOnDrop = !B.refitOnDrop; render(); }, "to that line's daily target"));
    pop.appendChild(h('div', { class: 'menuhint' },
      stage.key === 'sew' ? 'Drag a bar sideways to move the sewing dates, onto another line to reassign it, or by an edge to change its duration.'
        : (stage.key === 'cut' || stage.key === 'ship') ? 'Drag a bar sideways to shift the whole plan.'
        : 'Drag sideways to shift the whole plan, or onto another lane to reassign this stage.'));
  }));
  bar.appendChild(h('div', { style: 'flex:1' }));
  bar.appendChild(h('button', { class: 'btn stashtab' + (S.stash.size ? ' full' : ''), 'aria-pressed': S.stashOpen,
    title: S.stash.size ? `${S.stash.size} order${S.stash.size > 1 ? 's' : ''} parked off the board. Open the tray to put one back or drag it onto a lane.`
      : 'Nothing stashed yet. Park an order from its detail panel to hold it here.',
    onclick: () => { S.stashOpen = !S.stashOpen; renderStashTray(); } },
    h('span', {}, '⇩ Stash'),
    S.stash.size ? h('span', { class: 'stashbadge' }, S.stash.size) : null));

  const from = B.from, to = from + B.days - 1;
  const groups = laneList(B.stage);
  const all = buildLoad(B.stage, m.orders, 'planned');
  const mine = buildLoad(B.stage, S.filtered, 'planned');
  // blocks per resource
  const blocks = new Map();
  let shown = 0, skippedNonWash = 0;
  for (const o of S.filtered) {
    const w = PC.stageWindow(m, o, stage); if (!w) continue;
    if (w[1] < from || w[0] > to) continue;
    if (stage.key === 'wash' && PC.isNonWash(m, o)) { skippedNonWash++; continue; }
    const res = PC.resourceOf(m, o, stage) || '(unassigned)';
    if (!blocks.has(res)) blocks.set(res, []);
    blocks.get(res).push({ o, a: w[0], b: w[1] }); shown++;
  }
  // unassigned lane if needed
  const known = new Set(groups.flatMap(g => g.lines.map(l => l.name)));
  const extra = [...blocks.keys()].filter(r => !known.has(r));
  if (extra.length) groups.unshift({ group: 'Not assigned to a lane', lines: extra.map(r => ({ name: r, label: r === '(unassigned)' ? 'No lane set' : r })) });

  // Filtering to particular lines focuses the board on them; with only a few on
  // screen the rows grow so the orders are easier to read and drag.
  const laneFilterOn = ['lineUnit', 'ldLine', 'finLine', 'site'].some(k => S.filters.facets[k] && S.filters.facets[k].size);
  const keepLane = L => blocks.has(L.name) || (!laneFilterOn && B.stage === 'sew');
  const visGroups = groups.map(g => ({ group: g.group, lines: g.lines.filter(keepLane) })).filter(g => g.lines.length);
  const laneCount = visGroups.reduce((a, g) => a + g.lines.length, 0);
  const ROWH = laneCount <= 2 ? 46 : laneCount <= 5 ? 38 : laneCount <= 12 ? 32 : 30;
  const BLKH = ROWH - 3, MINW = 240;   // short orders are padded to this so their text stays readable

  const board = h('div', { class: 'board' });
  board.appendChild(h('div', { class: 'boardkey' },
    h('span', { class: 'lbl' }, 'Bar border'),
    h('span', { title: 'A process has produced pieces, or the marker is already cut' }, h('i', { style: 'border-color:var(--run-go)' }), 'Running'),
    h('span', { title: `Nothing is holding it up and sewing starts within ${PC.READY_WINDOW_DAYS} days` }, h('i', { style: 'border-color:var(--run-ready)' }), 'Ready to run'),
    h('span', { title: 'Not started: waiting on fabric, approvals, trims or shrinkage, or not due yet' }, h('i', {}), 'Not started'),
    h('span', { title: 'Ex-factory runs past the confirmed delivery' }, h('i', { class: 'lateswatch' }), 'Late'),
    h('span', { class: 'sep' }),
    h('span', { class: 'lbl' }, 'Fill'), h('span', {}, 'production stage, palest at cutting'),
    h('span', { class: 'sep' }),
    h('span', { class: 'lbl' }, 'Bar under the lane'), h('span', {}, 'load against capacity')));
  const scroll = h('div', { class: 'bscroll' });
  const grid = h('div', { class: 'bgrid' });
  const HEADW = B.narrowLanes ? 66 : 208, dayW = B.dayW, plotW = B.days * dayW;
  // header
  const head = h('div', { class: 'bhead' });
  if (B.stage === 'wash' && skippedNonWash) bar.appendChild(h('span', { class: 'tag neutral' }, fmt(skippedNonWash) + ' orders are not washed'));
  head.appendChild(h('div', { class: 'corner', style: `width:${HEADW}px` },
    h('span', { class: 't' }, stage.key === 'sew' ? 'Sewing line' : stage.key === 'wash' ? 'Laundry line' : stage.key === 'fin' || stage.key === 'pack' ? 'Finishing line' : 'Factory site'),
    h('span', { class: 'sm muted' }, fmt(shown) + ' blocks')));
  const days = h('div', { class: 'days', style: `width:${plotW}px` });
  const months = h('div', { class: 'months' });
  let mi = 0;
  while (mi < B.days) { const d = keyToDate(from + mi); let len = 0; while (mi + len < B.days && keyToDate(from + mi + len).getUTCMonth() === d.getUTCMonth()) len++; months.appendChild(h('div', { class: 'm', style: `width:${len * dayW}px` }, MON[d.getUTCMonth()] + " '" + String(d.getUTCFullYear()).slice(2))); mi += len; }
  const dayrow = h('div', { class: 'dayrow' });
  const asOfK = dayKey(m.asOf);
  for (let i = 0; i < B.days; i++) {
    const d = keyToDate(from + i), su = d.getUTCDay() === 0;
    dayrow.appendChild(h('div', { class: 'dcell' + (su ? ' sun' : '') + (from + i === asOfK ? ' tdy' : ''), style: `width:${dayW}px` },
      dayW >= 20 ? h('b', {}, d.getUTCDate()) : (d.getUTCDate() % 5 === 0 || d.getUTCDate() === 1 ? h('b', {}, d.getUTCDate()) : h('b', {}, '')),
      dayW >= 26 ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getUTCDay()] : ''));
  }
  days.appendChild(months); days.appendChild(dayrow); head.appendChild(days); grid.appendChild(head);

  const laneEls = [];
  for (const g of visGroups) {
    const collapsed = B.collapsed.has(g.group);
    const gLines = g.lines;
    const gQty = gLines.reduce((a, l) => a + ((blocks.get(l.name) || []).reduce((x, b) => x + num(b.o.v[F.qty]), 0)), 0);
    grid.appendChild(h('div', { class: 'lane group' },
      h('button', { class: 'groupbar', style: `min-width:${HEADW + plotW}px`, onclick: () => { if (collapsed) B.collapsed.delete(g.group); else B.collapsed.add(g.group); render(); } },
        h('span', {}, collapsed ? '▸' : '▾'), g.group,
        h('span', { class: 'gn' }, gLines.length + ' lanes · ' + fmtK(gQty) + ' pcs in view'))));
    if (collapsed) continue;
    for (const L of gLines) {
      const items = (blocks.get(L.name) || []).sort((a, b) => a.a - b.a || a.b - b.b);
      // greedy row packing
      // A short order is widened to MINW so its name always fits; packing works in
      // pixels, not days, so the widened bar still never overlaps the next one.
      for (const it of items) {
        it.x = (it.a - from) * dayW + 1;
        it.natW = Math.max(dayW - 2, (it.b - it.a + 1) * dayW - 2);
        it.w = Math.max(it.natW, MINW);
      }
      const rowsEnd = []; let maxRow = 0;
      for (const it of items) {
        let r = 0; while (r < rowsEnd.length && rowsEnd[r] > it.x - 4) r++;
        rowsEnd[r] = it.x + it.w; it.row = r; if (r + 1 > maxRow) maxRow = r + 1;
      }
      const nRows = Math.max(1, maxRow);
      const plotH = nRows * ROWH + 14;
      const myLoad = mine.load.get(L.name) || new Map(), allLoad = all.load.get(L.name) || new Map();
      const capInfo = capFor(B.stage, L.name, allLoad);
      const lane = h('div', { class: 'lane' });
      // header
      const nowNext = describeLane(items, asOfK);
      const capIn = h('input', {
        class: 'capedit' + (capInfo.est ? ' est' : ''), value: capInfo.cap || '', type: 'text', inputmode: 'numeric',
        'aria-label': 'Daily capacity of ' + L.label + ' in pieces',
        title: `How many pieces ${L.label} can put out in a day. The bars below turn amber above 85% of it and red over 100%.` +
          (capInfo.est ? '\nThis figure is estimated from the plan because the workbook does not carry one — type the real number.' : '\nTaken from the TARGET column of the orders on this lane.'),
        onchange: e => { setCap(B.stage, L.name, parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0); render(); },
        onclick: e => e.stopPropagation()
      });
      lane.appendChild(h('div', { class: 'lanehead' + (B.narrowLanes ? ' narrow' : ''), style: `width:${HEADW}px`, title: B.narrowLanes ? `${L.label} · ${items.length} orders` : '' },
        h('div', { class: 'ln' },
          h('span', { class: 'nm', title: 'Filter everything to ' + L.name, onclick: () => { if (B.stage === 'sew') setOnlyFacet('lineUnit', L.label); else if (B.stage === 'wash') setOnlyFacet('ldLine', L.name); else if (B.stage === 'fin' || B.stage === 'pack') setOnlyFacet('finLine', L.name); else setOnlyFacet('site', L.name); } }, L.label),
          items.length ? h('button', { class: 'lanecount', title: 'List every order queued on this lane', onclick: e => showLaneOrders(L, items, stage, false, e) }, items.length) : null,
          (function () { const n = items.filter(i => PC.isLate(m, i.o)).length;
            return n ? h('button', { class: 'lanelate', title: `${n} order${n > 1 ? 's' : ''} on this lane will miss the delivery — click to see why`, onclick: e => showLaneOrders(L, items, stage, true, e) }, n + ' late') : null; })()),
        h('div', { class: 'meta' }, capIn, h('span', {}, 'pcs/day capacity'), h('span', { class: 'now', title: nowNext.title }, nowNext.text))));
      // plot
      const plot = h('div', { class: 'laneplot', style: `width:${plotW}px;height:${plotH}px` });
      const cols = h('div', { class: 'daycols' });
      for (let i = 0; i < B.days; i++) cols.appendChild(h('div', { class: 'daycol' + (keyToDate(from + i).getUTCDay() === 0 ? ' sun' : ''), style: `width:${dayW}px` }));
      plot.appendChild(cols);
      // capacity strip
      const strip = h('div', { class: 'capstrip' });
      for (let i = 0; i < B.days; i++) {
        const k = from + i, mv = myLoad.get(k) || 0, av = allLoad.get(k) || 0;
        const v = B.others ? av : mv;
        const cap = capInfo.cap;
        const r = cap ? v / cap : 0;
        const hh = cap ? Math.min(1, r) * 12 : Math.min(1, v / Math.max(1, capInfo.cap || 800)) * 12;
        const cls = !v ? '' : (B.others && mv === 0 ? 'ghost' : cap ? ratioClass(r) : 'under');
        strip.appendChild(h('div', { class: 'capbar ' + cls, style: `width:${dayW}px`, title: v ? `${fmtDateShort(keyToDate(k))} · ${fmt(v)} pcs${cap ? ' of ' + fmt(cap) + ' (' + pct(r) + ')' : ''}` : '' },
          v ? h('i', { style: `height:${Math.max(2, hh)}px` }) : null));
      }
      plot.appendChild(strip);
      if (asOfK >= from && asOfK <= to) plot.appendChild(h('div', { class: 'todayline', style: `left:${(asOfK - from) * dayW + dayW / 2}px` }));
      // blocks
      for (const it of items) plot.appendChild(makeBlock(it, ROWH, BLKH, stage));
      lane.appendChild(plot);
      lane._lane = L; lane._plot = plot; lane._rowh = ROWH; laneEls.push(lane);
      grid.appendChild(lane);
    }
  }
  scroll.appendChild(grid); board.appendChild(scroll); view.appendChild(board);
  attachDrag(scroll, laneEls, from, dayW, stage);
  S._laneEls = laneEls; S._boardGeom = { from, dayW };
  renderStashTray();
  scroll.addEventListener('scroll', () => scroll.classList.toggle('pinned', scroll.scrollLeft > 0), { passive: true });
  requestAnimationFrame(() => {
    const x = Math.max(0, (asOfK - from) * dayW - 180);
    scroll.scrollLeft = x; scroll.classList.toggle('pinned', x > 0);
  });
}
function showLaneOrders(L, items, stage, lateOnly, ev) {
  const m = S.model, F = m.F, asOfK = dayKey(m.asOf);
  const lateItems = items.filter(i => PC.isLate(m, i.o));
  const shown = (lateOnly ? lateItems : items).slice().sort((a, b) => a.a - b.a);
  const pop = openPop(`${L.label || L.name} — ${lateOnly ? fmt(lateItems.length) + ' late' : fmt(items.length) + ' orders'}`,
    ev ? ev.clientX : null, ev ? ev.clientY : null);
  const info = capFor(S.board.stage, L.name, null);
  pop.appendChild(h('div', { class: 'hint', style: 'margin-bottom:7px' },
    lateOnly
      ? `Ex-factory falls after the confirmed delivery on ${fmt(lateItems.length)} of ${fmt(items.length)} orders here. Reasons come from the plan and from the sheet's own delay note.`
      : `${fmt(shown.reduce((a, i) => a + num(i.o.v[F.qty]), 0))} pcs${info.cap ? ' · ' + fmt(info.cap) + ' pcs/day' : ''}. ● is running now, ✓ has finished, the rest is what comes next.`));
  if (!lateOnly && lateItems.length) pop.appendChild(h('button', { class: 'btn', style: 'width:100%;justify-content:center;margin-bottom:7px',
    onclick: e => showLaneOrders(L, items, stage, true, e) }, `Show the ${lateItems.length} late order${lateItems.length > 1 ? 's' : ''} and why`));
  for (const it of shown) {
    const o = it.o, running = it.a <= asOfK && it.b >= asOfK, future = it.a > asOfK;
    const late = PC.isLate(m, o);
    const slip = (function () { const ex = o.v[F.planExFactory], dly = o.v[F.cusFinalDly];
      return isDate(ex) && isDate(dly) ? dayKey(ex) - dayKey(dly) : null; })();
    const row = h('button', { class: 'prow lrowdet', onclick: () => { closePop(); openDrawer(o); } },
      h('span', { class: 'top' },
        h('span', { style: 'width:9px;flex:none;color:var(--sx-text-success)' }, running ? '●' : future ? '' : '✓'),
        h('span', { class: 'mono', style: 'width:80px;flex:none;overflow:hidden' }, str(o.v[F.po])),
        h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis' }, str(o.v[F.customer]) + ' · ' + str(o.v[F.style])),
        h('span', { class: 'mono muted', style: 'flex:none' }, fmt(num(o.v[F.qty]))),
        late ? h('span', { class: 'tag bad', style: 'flex:none' }, slip != null && slip > 0 ? '+' + slip + ' d' : 'late')
             : h('span', { class: 'mono muted', style: 'flex:none;width:86px;text-align:right' }, fmtDateShort(keyToDate(it.a)) + '→' + fmtDateShort(keyToDate(it.b)))));
    if (late) {
      const why = PC.lateReasons(m, o);
      if (why.length) row.appendChild(h('span', { class: 'why' }, why.join(' · ')));
    }
    pop.appendChild(row);
  }
  if (!shown.length) pop.appendChild(h('div', { class: 'empty' }, 'Nothing late on this lane.'));
  if (shown.length) pop.appendChild(h('button', { class: 'btn', style: 'width:100%;justify-content:center;margin-top:8px',
    onclick: () => { closePop(); S.filters.quick.late = lateOnly || undefined; if (!lateOnly) delete S.filters.quick.late;
      if (S.board.stage === 'sew') setOnlyFacet('lineUnit', L.label); else if (S.board.stage === 'wash') setOnlyFacet('ldLine', L.name);
      else if (S.board.stage === 'fin' || S.board.stage === 'pack') setOnlyFacet('finLine', L.name); else setOnlyFacet('site', L.name); } },
    lateOnly ? 'Filter the whole app to these' : 'Filter the whole app to this lane'));
  return pop;
}
// The stash tray: parked orders, retrievable by button or by dragging onto a lane.
function renderStashTray() {
  const old = document.getElementById('stashtray'); if (old) old.remove();
  if (!S.stashOpen || S.view !== 'board') return;
  const m = S.model, F = m.F;
  const tray = h('div', { class: 'stashtray', id: 'stashtray' },
    h('header', {}, h('b', {}, `Stash · ${S.stash.size}`),
      h('span', { class: 'hint' }, S.stash.size ? 'Drag a row onto a lane, or put it back where it came from.' : ''),
      h('button', { class: 'btn icon', title: 'Close the tray', onclick: () => { S.stashOpen = false; renderStashTray(); } }, '×')));
  const list = h('div', { class: 'stashlist' });
  if (!S.stash.size) list.appendChild(h('div', { class: 'empty' }, 'Nothing stashed. Open an order and press Stash to park it here.'));
  for (const [row, info] of S.stash) {
    const o = PC.orderByRow(m, row); if (!o) continue;
    const r = h('div', { class: 'stashrow', 'data-row': row, title: 'Drag onto a lane, or use the buttons' },
      h('span', { class: 'grab' }, '⠿'),
      h('span', { class: 'body' },
        h('span', { class: 'l1' }, h('span', { class: 'mono' }, str(o.v[F.po])), ' ', str(o.v[F.desc])),
        h('span', { class: 'l2' }, str(o.v[F.customer]) + ' · ' + fmt(num(o.v[F.qty])) + ' pcs' + (info.lane ? ' · was ' + info.lane : ''))),
      h('span', { class: 'acts' },
        info.lane ? h('button', { class: 'btn', title: 'Put it back on ' + info.lane, onclick: () => unstash(row) }, 'Put back') : null,
        h('button', { class: 'btn', title: 'Take it out of the stash and leave it unassigned on the board', onclick: () => unstash(row, '') }, 'Release')));
    r._o = o;
    list.appendChild(r);
  }
  tray.appendChild(list);
  document.body.appendChild(tray);
  attachStashDrag(tray);
}
function attachStashDrag(tray) {
  let drag = null;
  tray.addEventListener('pointerdown', e => {
    const row = e.target.closest('.stashrow'); if (!row || e.target.closest('.btn')) return;
    drag = { o: row._o, ghost: null, lane: null };
    row.setPointerCapture(e.pointerId); e.preventDefault();
  });
  tray.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.ghost) {
      drag.ghost = h('div', { class: 'stashghost' }, str(drag.o.v[S.model.F.po]) + ' · ' + str(drag.o.v[S.model.F.customer]));
      document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.left = (e.clientX + 12) + 'px'; drag.ghost.style.top = (e.clientY + 12) + 'px';
    const hit = laneUnder(e.clientX, e.clientY);
    if (drag.lane && drag.lane !== (hit && hit.el)) drag.lane.classList.remove('droptarget');
    drag.lane = hit ? hit.el : null;
    if (drag.lane) drag.lane.classList.add('droptarget');
    drag.hit = hit;
  });
  const end = e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.ghost) d.ghost.remove();
    if (d.lane) d.lane.classList.remove('droptarget');
    if (d.hit) dropFromStash(d.o, d.hit, e);
  };
  tray.addEventListener('pointerup', end);
  tray.addEventListener('pointercancel', end);
}
function laneUnder(x, y) {
  for (const el of (S._laneEls || [])) {
    const r = el.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right && el._lane) {
      const plot = el._plot.getBoundingClientRect();
      const day = S._boardGeom.from + Math.floor((x - plot.left) / S._boardGeom.dayW);
      return { el, lane: el._lane, day };
    }
  }
  return null;
}
function dropFromStash(o, hit, ev) {
  const m = S.model, F = m.F, info = S.stash.get(o.r);
  const s1 = o.v[F.sew1], s2 = o.v[F.sew2];
  const shift = isDate(s1) ? hit.day - dayKey(s1) : 0;
  const pop = openPop('Put it on ' + hit.lane.label, ev ? ev.clientX : null, ev ? ev.clientY : null);
  pop.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:6px' },
    h('span', { class: 'mono' }, str(o.v[F.po])), ' · ', str(o.v[F.customer]), ' · ', fmt(num(o.v[F.qty])), ' pcs'));
  const rows = h('div', { style: 'display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;font-size:12px;align-items:center' });
  const addRow = (k, a, b) => { rows.appendChild(h('span', { class: 'muted' }, k));
    rows.appendChild(h('span', { class: 'mono', style: 'color:var(--sx-text-disabled);text-decoration:line-through' }, a));
    rows.appendChild(h('span', { class: 'mono', style: 'color:var(--sx-text-warning);font-weight:600' }, b)); };
  addRow(m.cols[info.col].name, info.lane || '—', hit.lane.name);
  if (shift && isDate(s1)) { addRow('Sewing starts', fmtDate(s1), fmtDate(keyToDate(dayKey(s1) + shift)));
    if (isDate(s2)) addRow('Sewing ends', fmtDate(s2), fmtDate(keyToDate(dayKey(s2) + shift))); }
  pop.appendChild(rows);
  const go = h('button', { class: 'btn primary', onclick: () => { closePop();
    S.stash.delete(o.r);
    PC.beginGroup(m);
    try { PC.setCell(m, o, info.col, hit.lane.name); if (shift) { shiftDatesInner(o, shift); } } finally { PC.endGroup(); }
    S.sel = o;
    afterEdit(`${str(o.v[F.po])} placed on ${hit.lane.name}`, true);
    renderStashTray();
  } }, 'Place it here');
  pop.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:10px' }, go, h('button', { class: 'btn', onclick: closePop }, 'Cancel')));
  go.focus();
}
function describeLane(items, asOfK) {
  const m = S.model, F = m.F;
  const now = items.filter(i => i.a <= asOfK && i.b >= asOfK);
  const next = items.filter(i => i.a > asOfK).sort((a, b) => a.a - b.a)[0];
  const lbl = it => `${str(it.o.v[F.customer])} ${str(it.o.v[F.style])}`.trim();
  if (now.length) return { text: 'Now ' + lbl(now[0]) + (next ? ' → ' + lbl(next) : ''), title: 'Running now: ' + now.map(lbl).join(', ') + (next ? '\nNext: ' + lbl(next) + ' from ' + fmtDate(keyToDate(next.a)) : '') };
  if (next) return { text: 'Next ' + lbl(next) + ' ' + fmtDateShort(keyToDate(next.a)), title: 'Next order on this lane' };
  return { text: items.length ? '' : 'no orders in view', title: '' };
}
function makeBlock(it, rowH, blkH, stage) {
  const m = S.model, F = m.F, o = it.o;
  const p = PC.orderProgress(m, o);
  const si = PC.STAGE_INDEX[stage.key];
  const left = it.x, width = it.w, widened = it.w > it.natW + 2;
  const late = PC.isLate(m, o);
  const run = PC.runState(m, o);
  const gates = PC.openGates(m, o);
  const lead = PC.leadDays(m, o);
  const locked = p.stage > 5 || (p.qty > 0 && num(o.v[F.packedQty]) >= p.qty);
  const doneFrac = p.qty ? Math.min(1, p.done[si] / p.qty) : 0;
  const buyer = str(o.v[F.customer]), style = str(o.v[F.style]);
  const b = h('div', {
    class: 'blk' + (late ? ' late' : '') + (locked ? ' locked' : '') + (S.sel === o ? ' sel' : ''),
    'data-run': run,
    style: `left:${left}px;width:${width}px;top:${it.row * rowH + 1}px;height:${blkH}px;background:${stageColor(si)};color:${stageInk(si)}`,
    tabindex: 0, role: 'button',
    title: `${str(o.v[F.po])} · ${str(o.v[F.customer])} · style ${str(o.v[F.style])}\n${fmt(p.qty)} pcs · ${str(o.v[F.line])}\n${stage.name}: ${fmtDate(keyToDate(it.a))} → ${fmtDate(keyToDate(it.b))}${widened ? ' (bar widened to fit the name; the dashed line is the real end)' : ''}\n${RUN_LABEL[run]}${run === 'running' ? ' — ' + fmt(p.done[si]) + ' of ' + fmt(p.qty) + ' pcs done at ' + stage.name.toLowerCase() : lead != null && lead >= 0 ? ' — sewing starts in ' + lead + ' d' : ''}${gates.length ? '\nStill waiting on: ' + gates.join(', ') : ''}\nEx-factory ${fmtDate(o.v[F.planExFactory])} · delivery ${fmtDate(o.v[F.cusFinalDly])}${locked ? '\nLocked: already packed or shipped' : ''}`,
    onclick: e => { if (b._dragged) return; openDrawer(o); },
    onkeydown: e => {
      if (e.key === 'Enter') { openDrawer(o); return; }
      if (!e.shiftKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); shiftOrder(o, e.key === 'ArrowRight' ? 1 : -1); }
    }
  }, h('i', { class: 'prog', style: `width:${Math.min(width, doneFrac * it.natW)}px` }),
    h('span', { class: 'l1' },
      h('span', { class: 'mo' }, str(o.v[F.po])),
      h('span', { class: 'desc' }, str(o.v[F.desc])),
      h('span', { class: 'qty' }, fmt(p.qty))),
    blkH >= 40
      ? [h('span', { class: 'l2' }, buyer), style ? h('span', { class: 'l3' }, style) : null]
      : h('span', { class: 'l2' }, buyer + (style ? ' · ' + style : '')),
    widened ? h('i', { class: 'trueend', style: `left:${it.natW}px` }) : null,
    late ? h('i', { class: 'lateflag', title: 'Ex-factory runs past the confirmed delivery' }) : null,
    h('i', { class: 'grip l' }), h('i', { class: 'grip r' }));
  b._it = it; b._o = o; b._locked = locked;
  // previous-plan ghost
  const prev = o.v[F.planPrev];
  if (stage.key === 'sew' && isDate(prev) && prev.getUTCFullYear() > 2000 && dayKey(prev) !== it.b) {
    const delta = dayKey(prev) - it.b;
    b.title += `\nPrevious plan ended ${fmtDate(prev)} (${delta > 0 ? 'pulled in ' + delta : 'pushed out ' + -delta} d)`;
  }
  return b;
}
function fitToFiltered() {
  const m = S.model, stage = stageByKey(S.board.stage);
  let lo = Infinity, hi = -Infinity;
  for (const o of S.filtered) { const w = PC.stageWindow(m, o, stage); if (!w) continue; lo = Math.min(lo, w[0]); hi = Math.max(hi, w[1]); }
  if (!isFinite(lo)) { toast('No scheduled orders in this filter.'); return; }
  S.board.from = lo - 3; S.board.days = Math.max(28, Math.min(420, hi - lo + 8)); render();
}

/* ---- drag & drop ---- */
function attachDrag(scroll, laneEls, from, dayW, stage) {
  let drag = null;
  scroll.addEventListener('pointerdown', e => {
    const blk = e.target.closest('.blk'); if (!blk || e.button !== 0) return;
    const o = blk._o;
    if (blk._locked) { toast('This order is already packed or shipped, so its plan is locked.'); return; }
    const mode = e.target.classList.contains('grip') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
    drag = { blk, o, mode, x0: e.clientX, y0: e.clientY, it: blk._it, moved: false, lane: blk.closest('.lane') };
    blk.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  scroll.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (!drag.moved) { drag.moved = true; drag.blk.classList.add('dragging'); drag.blk._dragged = true; }
    const dd = Math.round(dx / dayW);
    let target = drag.lane;
    if (drag.mode === 'move') {
      for (const l of laneEls) { const r = l.getBoundingClientRect(); if (e.clientY >= r.top && e.clientY <= r.bottom) { target = l; break; } }
    }
    drag.dd = dd; drag.target = target;
    showGhost(drag, dd, target, from, dayW);
    showTip(e, drag, dd, target, stage);
  });
  const finish = e => {
    if (!drag) return;
    const d = drag; drag = null;
    d.blk.classList.remove('dragging');
    hideGhost(); hideTip();
    setTimeout(() => { d.blk._dragged = false; }, 0);
    if (!d.moved) return;
    applyDrag(d, stage, e);
  };
  scroll.addEventListener('pointerup', finish);
  scroll.addEventListener('pointercancel', finish);
}
let ghostEl = null, tipEl = null;
function showGhost(d, dd, target, from, dayW) {
  const plot = target._plot || d.lane._plot;
  const rowH = (target._rowh || d.lane._rowh || 22);
  if (!ghostEl) { ghostEl = h('div', { class: 'ghostblk' }); }
  if (ghostEl.parentNode !== plot) plot.appendChild(ghostEl);
  let a = d.it.a, b = d.it.b;
  if (d.mode === 'move') { a += dd; b += dd; } else if (d.mode === 'l') { a = Math.min(d.it.b, a + dd); } else { b = Math.max(d.it.a, b + dd); }
  ghostEl.style.left = ((a - from) * dayW + 1) + 'px';
  ghostEl.style.width = Math.max(92, Math.max(dayW - 2, (b - a + 1) * dayW - 2)) + 'px';
  ghostEl.style.top = (d.it.row * rowH + 1) + 'px';
  ghostEl.style.height = (rowH - 3) + 'px';
  ghostEl.textContent = fmtDateShort(keyToDate(a)) + ' → ' + fmtDateShort(keyToDate(b));
}
function hideGhost() { if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl); }
function showTip(e, d, dd, target, stage) {
  const m = S.model, F = m.F, o = d.o;
  if (!tipEl) { tipEl = h('div', { class: 'dragtip' }); document.body.appendChild(tipEl); }
  const newLane = target._lane ? target._lane.name : null;
  const sameLane = !newLane || newLane === PC.resourceOf(m, o, stage);
  let a = d.it.a, b = d.it.b;
  if (d.mode === 'move') { a += dd; b += dd; } else if (d.mode === 'l') a = Math.min(b, a + dd); else b = Math.max(a, b + dd);
  const days = PC.workdayCount(a, b);
  const need = num(o.v[F.target]) > 0 ? Math.ceil(num(o.v[F.qty]) / num(o.v[F.target])) : 0;
  const lines = [`${str(o.v[F.po])} · ${fmt(num(o.v[F.qty]))} pcs`,
  `${stage.name}  ${fmtDate(keyToDate(a))} → ${fmtDate(keyToDate(b))}  (${days} working days${need ? ', needs ' + need : ''})`];
  if (!sameLane) lines.push(`Move to ${newLane}`);
  const ex = o.v[F.planExFactory], dly = o.v[F.cusFinalDly];
  if (isDate(ex) && isDate(dly)) { const shift = d.mode === 'move' ? dd : (d.mode === 'r' ? dd : 0); const nex = dayKey(ex) + shift; const slip = nex - dayKey(dly); lines.push(`Ex-factory ${fmtDateShort(keyToDate(nex))} vs delivery ${fmtDateShort(dly)} → ${slip > 0 ? slip + ' d late' : Math.abs(slip) + ' d spare'}`); }
  tipEl.textContent = lines.join('\n');
  tipEl.style.left = Math.min(window.innerWidth - 320, e.clientX + 16) + 'px';
  tipEl.style.top = (e.clientY + 18) + 'px';
}
function hideTip() { if (tipEl && tipEl.parentNode) { tipEl.parentNode.removeChild(tipEl); tipEl = null; } }
// Several cells change per drop, so wrap them in one undo group.
function grouped(fn) { PC.beginGroup(S.model); try { return fn(); } finally { PC.endGroup(); } }
// A drop proposes a change; nothing is written until it is confirmed.
function planDrag(d, stage) {
  const m = S.model, F = m.F, o = d.o, dd = d.dd || 0;
  const snap = dt => U.skipSunday(U.startOfDay(dt));
  const newLane = d.target && d.target._lane ? d.target._lane.name : null;
  const curRes = PC.resourceOf(m, o, stage);
  const sets = [], rows = [];
  let s1 = o.v[F.sew1], s2 = o.v[F.sew2];
  const was1 = s1, was2 = s2;
  if (dd) {
    if (d.mode === 'move') { s1 = snap(addDays(s1, dd)); s2 = snap(addDays(s2, dd)); }
    else if (d.mode === 'r') { const t = snap(addDays(s2, dd)); if (dayKey(t) >= dayKey(s1)) s2 = t; }
    else { const t = snap(addDays(s1, dd)); if (dayKey(t) <= dayKey(s2)) s1 = t; }
  }
  if (newLane && newLane !== curRes && d.mode === 'move') {
    if (stage.key === 'sew') {
      sets.push([F.line, newLane]); rows.push(['Sewing line', curRes || '—', newLane]);
      const L = m.lineMap.get(newLane);
      if (L) {
        if (L.inout && str(o.v[F.inout]) && L.inout !== str(o.v[F.inout])) { sets.push([F.inout, L.inout]); rows.push(['In-house / subcon', str(o.v[F.inout]), L.inout]); }
        if (S.board.refitOnDrop && L.target > 0) {
          const need = Math.max(1, Math.ceil(num(o.v[F.qty]) / L.target));
          let end = U.startOfDay(s1), counted = 1;
          while (counted < need) { end = addDays(end, 1); if (end.getUTCDay() !== 0) counted++; }
          s2 = end;
          if (L.target !== num(o.v[F.target])) { sets.push([F.target, L.target]); rows.push(['Daily target', fmt(num(o.v[F.target])), fmt(L.target) + ' pcs/day']); }
        }
      }
    } else if (stage.key === 'wash') { sets.push([F.ldLine, newLane]); rows.push(['Laundry line', curRes || '—', newLane]); }
    else if (stage.key === 'fin' || stage.key === 'pack') { sets.push([F.finLine, newLane]); rows.push(['Finishing line', curRes || '—', newLane]); }
    else return { blocked: 'Cutting and ex-factory follow the sewing line. Move the order on the Sew board to change its site.' };
  }
  if (isDate(s1) && dayKey(s1) !== dayKey(was1)) { sets.unshift([F.sew1, s1]); rows.unshift(['Sewing starts', fmtDate(was1), fmtDate(s1)]); }
  if (isDate(s2) && dayKey(s2) !== dayKey(was2)) { sets.push([F.sew2, s2]); rows.push(['Sewing ends', fmtDate(was2), fmtDate(s2)]); }
  if (!sets.length) return null;
  // what the move does to the promise date, using the same chain the workbook uses
  const shift = isDate(s1) && isDate(was1) ? dayKey(s2) - dayKey(was2) : 0;
  const ex = o.v[F.planExFactory], dly = o.v[F.cusFinalDly];
  let verdict = null;
  if (isDate(ex) && isDate(dly)) {
    const slip = dayKey(ex) + shift - dayKey(dly);
    verdict = slip > 0 ? { bad: true, text: `Ex-factory lands ${slip} day${slip > 1 ? 's' : ''} after the ${fmtDate(dly)} delivery.` }
                       : { bad: false, text: `Ex-factory keeps ${Math.abs(slip)} day${Math.abs(slip) === 1 ? '' : 's'} of slack before the ${fmtDate(dly)} delivery.` };
  }
  return { o, sets, rows, verdict };
}
function applyDrag(d, stage, ev) {
  const plan = planDrag(d, stage);
  if (!plan) { render(); return; }
  if (plan.blocked) { toast(plan.blocked); render(); return; }
  confirmDrag(plan, ev);
}
function confirmDrag(plan, ev) {
  const m = S.model, F = m.F, o = plan.o;
  const pop = openPop('Confirm this change', ev ? ev.clientX : null, ev ? ev.clientY : null);
  pop.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:6px' },
    h('span', { class: 'mono' }, str(o.v[F.po])), ' · ', str(o.v[F.customer]), ' · ', fmt(num(o.v[F.qty])), ' pcs'));
  const tbl = h('div', { style: 'display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;font-size:12px;align-items:center' });
  for (const [label, from, to] of plan.rows) {
    tbl.appendChild(h('span', { class: 'muted' }, label));
    tbl.appendChild(h('span', { class: 'mono', style: 'color:var(--sx-text-disabled);text-decoration:line-through' }, from));
    tbl.appendChild(h('span', { class: 'mono', style: 'color:var(--sx-text-warning);font-weight:600' }, to));
  }
  pop.appendChild(tbl);
  if (plan.verdict) pop.appendChild(h('div', { class: 'tag ' + (plan.verdict.bad ? 'bad' : 'ok'), style: 'margin-top:8px;white-space:normal;line-height:1.5' }, plan.verdict.text));
  pop.appendChild(h('div', { class: 'hint', style: 'margin-top:6px' }, 'Cut, wash, finishing, packing and ex-factory dates all follow from this.'));
  const apply = h('button', { class: 'btn primary', onclick: () => { closePop(); commitDrag(plan); } }, 'Apply change');
  pop.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:10px' }, apply,
    h('button', { class: 'btn', onclick: () => { closePop(); render(); } }, 'Cancel')));
  apply.focus();
  pop.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply.click(); } });
}
function commitDrag(plan) {
  const m = S.model, F = m.F, o = plan.o;
  grouped(() => { for (const [c, v] of plan.sets) PC.setCell(m, o, c, v); });
  S.sel = o;
  afterEdit(`${str(o.v[F.po])} · ${plan.rows.map(r => r[0].toLowerCase() + ' ' + r[2]).join(', ')}`, true);
}
function shiftDates(o, dd) { grouped(() => shiftDatesInner(o, dd)); }
function shiftDatesInner(o, dd) {
  const m = S.model, F = m.F;
  (() => {
  const s1 = o.v[F.sew1], s2 = o.v[F.sew2];
    if (isDate(s1)) PC.setCell(m, o, F.sew1, U.skipSunday(U.startOfDay(addDays(s1, dd))));
    if (isDate(s2)) PC.setCell(m, o, F.sew2, U.skipSunday(U.startOfDay(addDays(s2, dd))));
  });
}
function shiftOrder(o, dd) { shiftDates(o, dd); S.sel = o; afterEdit(`${str(o.v[S.model.F.po])} moved ${dd > 0 ? '+' : ''}${dd} d`, true); }

/* ================= view: capacity ================= */
function renderCapacity(view, bar) {
  const m = S.model, C = S.cap;
  bar.appendChild(menuButton('Stage: ' + (C.stage === 'all' ? 'All' : stageByKey(C.stage).short), 'Which stage to measure', pop => {
    pop.appendChild(menuRow('All stages', C.stage === 'all', () => { C.stage = 'all'; render(); }, 'one row each, factory-wide'));
    for (const st of STAGES) pop.appendChild(menuRow(st.name, C.stage === st.key, () => { C.stage = st.key; render(); }));
  }));
  const gr = h('div', { class: 'seg' });
  for (const [g, l] of [['day', 'Day'], ['week', 'Week']]) gr.appendChild(h('button', { 'aria-pressed': C.grain === g, onclick: () => { C.grain = g; render(); } }, l));
  bar.appendChild(h('span', { class: 'vlabel' }, 'Bucket')); bar.appendChild(gr);
  bar.appendChild(h('div', { style: 'flex:1' }));
  bar.appendChild(h('div', { class: 'capkey' },
    h('span', { class: 'sc' }, h('i', { style: heatStyle(0.5) }), 'under 85%'),
    h('span', { class: 'sc' }, h('i', { style: heatStyle(0.95) }), '85–100%'),
    h('span', { class: 'sc' }, h('i', { style: heatStyle(1.4) }), 'over capacity'),
    h('span', { class: 'muted' }, 'remaining quantity only')));

  const asOfK = dayKey(m.asOf);
  const buckets = [];
  if (C.grain === 'week') { let w = U.weekKey(m.asOf); for (let i = 0; i < C.weeks; i++) { buckets.push({ a: w - 6, b: w, label: fmtDateShort(keyToDate(w)) }); w += 7; } }
  else { for (let i = 0; i < 45; i++) { const k = asOfK + i; buckets.push({ a: k, b: k, label: keyToDate(k).getUTCDate() + '', sub: MON[keyToDate(k).getUTCMonth()], sun: keyToDate(k).getUTCDay() === 0 }); } }

  const wrap = h('div', { style: 'padding:0' });
  const table = h('table', { class: 'heat' });
  const thead = h('thead'); const hr = h('tr');
  hr.appendChild(h('th', { class: 'rh' }, C.stage === 'all' ? 'Production stage' : 'Lane · capacity/day'));
  for (const b of buckets) hr.appendChild(h('th', { style: b.sun ? 'background:var(--sunday)' : '' }, b.label, b.sub ? h('div', { style: 'font-size:9px;opacity:.7' }, b.sub) : null));
  thead.appendChild(hr); table.appendChild(thead);
  const tbody = h('tbody');

  const stageKeys = C.stage === 'all' ? STAGES.map(s => s.key) : [C.stage];
  for (const sk of stageKeys) {
    const stage = stageByKey(sk);
    const { load, meta } = buildLoad(sk, S.filtered, 'remaining');
    const groups = laneList(sk);
    if (C.stage === 'all') {
      // one row per stage, factory-wide
      const tot = new Map(); let capSum = 0;
      for (const [res, days] of load) { const { cap } = capFor(sk, res, days); capSum += cap; for (const [k, v] of days) tot.set(k, (tot.get(k) || 0) + v); }
      const tr = h('tr', { class: 'grouprow' });
      tr.appendChild(h('th', { class: 'rh' }, h('div', { class: 'nm' }, h('i', { style: `width:9px;height:9px;border-radius:2px;background:${stageColor(PC.STAGE_INDEX[sk])}` }), stage.name),
        h('div', { class: 'sub' }, capSum ? fmt(capSum) + ' pcs/day across lanes' : 'no capacity set')));
      for (const b of buckets) tr.appendChild(cell(tot, b, capSum, sk, null, meta));
      tbody.appendChild(tr);
      continue;
    }
    for (const g of groups) {
      const lines = g.lines.filter(l => load.has(l.name));
      const extras = [...load.keys()].filter(r => !groups.some(gg => gg.lines.some(l => l.name === r)));
      if (!lines.length && !extras.length) continue;
      if (groups.length > 1) tbody.appendChild(h('tr', { class: 'grouprow' }, h('th', { class: 'rh' }, g.group), ...buckets.map(() => h('td'))));
      for (const L of [...lines, ...(g === groups[0] ? extras.map(r => ({ name: r, label: r === '(unassigned)' ? 'No lane set' : r })) : [])]) {
        const days = load.get(L.name) || new Map();
        const info = capFor(sk, L.name, days);
        const tr = h('tr');
        tr.appendChild(h('th', { class: 'rh' },
          h('div', { class: 'nm' }, h('span', { style: 'cursor:pointer', onclick: () => { S.board.stage = sk; setView('board'); } }, L.label || L.name)),
          h('div', { class: 'sub' },
            h('input', {
              class: 'capedit' + (info.est ? ' est' : ''), value: info.cap || '', title: info.est ? 'Estimated from the plan — type the real figure' : 'Daily capacity',
              onchange: e => { setCap(sk, L.name, parseInt(String(e.target.value).replace(/[^\d]/g, ''), 10) || 0); render(); }
            }), ' pcs/day', info.est ? ' (est.)' : '')));
        for (const b of buckets) tr.appendChild(cell(days, b, info.cap, sk, L.name, meta));
        tbody.appendChild(tr);
      }
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  if (!tbody.children.length) wrap.appendChild(h('div', { class: 'empty' }, 'No remaining work in this filter for that stage.'));
  // per-lane stage breakdown
  wrap.appendChild(stageBreakdown());
  view.appendChild(wrap);

  function cell(days, b, cap, sk, res, meta) {
    let v = 0; for (let k = b.a; k <= b.b; k++) v += days.get(k) || 0;
    const wd = PC.workdayCount(b.a, b.b) || 1;
    const capacity = cap * wd;
    const r = capacity > 0 ? v / capacity : 0;
    const td = h('td', {
      class: 'cell', style: heatStyle(r) + (b.sun ? ';background-image:linear-gradient(var(--sunday),var(--sunday))' : ''),
      title: v ? `${fmt(v)} pcs${capacity ? ' of ' + fmt(capacity) + ' capacity (' + pct(r) + ')' : ' — no capacity set'}\nClick to see the orders` : 'nothing loaded',
      onclick: () => v && showCellOrders(sk, res, b, meta)
    });
    if (v) { td.appendChild(h('div', { class: 'r' }, capacity ? pct(r) : fmtK(v))); if (capacity && b.b - b.a > 0) td.appendChild(h('div', { style: 'font-size:9px;opacity:.75' }, fmtK(v))); }
    return td;
  }
}
function showCellOrders(sk, res, b, meta) {
  const m = S.model, F = m.F;
  const stage = stageByKey(sk);
  const set = new Set();
  if (res == null) { for (const [, mm] of meta) for (let k = b.a; k <= b.b; k++) (mm.get(k) || []).forEach(i => set.add(i)); }
  else { const mm = meta.get(res); if (mm) for (let k = b.a; k <= b.b; k++) (mm.get(k) || []).forEach(i => set.add(i)); }
  const list = [...set].map(i => m.orders[i]).filter(Boolean).sort((a, c) => num(c.v[F.qty]) - num(a.v[F.qty]));
  const pop = openPop(`${stage.name} · ${res || 'all lanes'} · ${b.label}`);
  pop.appendChild(h('div', { class: 'hint', style: 'margin-bottom:6px' }, `${list.length} orders · ${fmt(list.reduce((a, o) => a + num(o.v[F.qty]), 0))} pcs planned`));
  for (const o of list.slice(0, 60)) pop.appendChild(h('button', { class: 'prow', onclick: () => { closePop(); openDrawer(o); } },
    h('span', { class: 'mono' }, str(o.v[F.po])), h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis' }, str(o.v[F.customer]) + ' · ' + str(o.v[F.style])), h('span', { class: 'mono muted' }, fmt(num(o.v[F.qty])))));
  pop.appendChild(h('button', { class: 'btn', style: 'margin-top:8px;width:100%;justify-content:center', onclick: () => { closePop(); if (res) { if (sk === 'sew') setOnlyFacet('lineUnit', (m.lineMap.get(res) || {}).label || res); else if (sk === 'wash') setOnlyFacet('ldLine', res); else if (sk === 'fin' || sk === 'pack') setOnlyFacet('finLine', res); else setOnlyFacet('site', res); } S.board.stage = sk; S.board.from = b.a - 5; setView('board'); } }, 'Open these on the board'));
}
function stageBreakdown() {
  const m = S.model;
  const box = h('div', { style: 'padding:12px' });
  const p = panel('Every stage for the orders in view', 'from planned cut to ex-factory, pieces per week');
  const asOfK = dayKey(m.asOf);
  const weeks = []; { let w = U.weekKey(m.asOf); for (let i = -1; i < 15; i++) { weeks.push(w); w += 7; } }
  const start = U.weekKey(m.asOf) - 7;
  const series = STAGES.map((st, si) => {
    const { load } = buildLoad(st.key, S.filtered, 'remaining');
    const arr = weeks.map(() => 0);
    for (const [, days] of load) for (const [k, v] of days) { const wk = U.weekKey(keyToDate(k)); const idx = Math.round((wk - start) / 7); if (idx >= 0 && idx < arr.length) arr[idx] += v; }
    return { st, si, arr };
  });
  const maxV = Math.max(1, ...series.flatMap(s => s.arr));
  const W = Math.max(560, weeks.length * 54), H = 208, PAD = { l: 50, r: 10, t: 10, b: 30 };
  const bw = (W - PAD.l - PAD.r) / weeks.length;
  const x = i => PAD.l + i * bw;
  const y = v => PAD.t + (1 - v / maxV) * (H - PAD.t - PAD.b);
  const g = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Remaining work per stage per week' });
  for (let i = 0; i <= 4; i++) { const v = maxV * i / 4; g.appendChild(sv('line', { class: 'gridline', x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v) })); g.appendChild(sv('text', { x: PAD.l - 6, y: y(v) + 3, 'text-anchor': 'end', text: fmtK(v) })); }
  const sw = (bw - 8) / 6;
  weeks.forEach((w, i) => {
    series.forEach(s => {
      const v = s.arr[i]; if (!v) return;
      g.appendChild(sv('rect', { x: x(i) + 4 + s.si * sw, y: y(v), width: Math.max(1.5, sw - 1), height: Math.max(1, H - PAD.b - y(v)), fill: `var(--st${s.si + 1})`, rx: 1 }));
    });
    if (i % 2 === 0) g.appendChild(sv('text', { x: x(i) + bw / 2, y: H - 10, 'text-anchor': 'middle', text: fmtDateShort(keyToDate(w)) }));
  });
  g.appendChild(sv('line', { class: 'axis', x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b }));
  const body = p.querySelector('.body');
  body.appendChild(g);
  const lg = h('div', { class: 'legend' });
  STAGES.forEach((st, i) => lg.appendChild(h('span', {}, h('i', { style: `background:${stageColor(i)}` }), st.name)));
  body.appendChild(lg);
  box.appendChild(p);
  return box;
}

/* ================= view: orders table ================= */
const PRESETS = {
  planner: { name: 'Planner', keys: ['po', 'blk', 'customer', 'style', 'desc', 'qty', 'line', 'target', 'pcd', 'sew1', 'sew2', 'factoryConfirm', 'output', 'ldLine', 'washLastOut', 'finLine', 'finLastOut', 'planExFactory', 'cusFinalDly', 'otd', 'status'] },
  cutting: { name: 'Cutting', keys: ['po', 'customer', 'style', 'qty', 'fabric', 'mill', 'fabReqIH', 'fabActIH', 'markerRelease', 'markerAct', 'pcd', 'cutQty', 'cutBal', 'inputDate', 'inputQty'] },
  sewing: { name: 'Sewing', keys: ['po', 'customer', 'style', 'qty', 'line', 'target', 'days', 'sew1', 'sew2', 'planPrev', 'factoryConfirm', 'inputQty', 'output', 'wipSewing', 'dispatched', 'sewBal'] },
  laundry: { name: 'Laundry', keys: ['po', 'customer', 'style', 'qty', 'ldLine', 'wash', 'recipe', 'washFirstOut', 'washLastOut', 'laundryWip', 'lrCompletion', 'lrConfirm', 'washOutput', 'washBal', 'shrinkStatus'] },
  finishing: { name: 'Finishing & packing', keys: ['po', 'customer', 'style', 'qty', 'finLine', 'finFirstOut', 'finLastOut', 'finConfirm', 'finOut', 'finBal', 'packLastOut', 'packConfirm', 'packedQty', 'packBal'] },
  shipping: { name: 'Delivery', keys: ['po', 'customer', 'style', 'qty', 'planInspection', 'planExFactory', 'exFactory', 'shippedQty', 'shipBal', 'sysDelivery', 'cusFinalDly', 'dlyRevision', 'otd', 'delayBucket', 'delayReason', 'shipMonth'] },
  approvals: { name: 'Approvals & materials', keys: ['po', 'customer', 'style', 'qty', 'fitStatus', 'fitApproved', 'ppStatus', 'ppApproved', 'washAppStatus', 'washAppDate', 'trimStatus', 'trimMax', 'pocketing', 'interlining', 'thread', 'zipper', 'label', 'shrinkStatus', 'fabActIH'] },
  all: { name: 'Every column', keys: null },
};
function presetCols(key) {
  const m = S.model;
  if (key === 'all') return m.cols.filter(c => c.nonEmpty > 0 || c.formula);
  return PRESETS[key].keys.map(k => m.F[k]).filter(i => i >= 0).map(i => m.cols[i]);
}
function renderOrders(view, bar) {
  const m = S.model, F = m.F, T = S.table;
  const seg = h('div', { class: 'seg' });
  for (const k in PRESETS) seg.appendChild(h('button', { 'aria-pressed': T.preset === k, onclick: () => { T.preset = k; render(); } }, PRESETS[k].name));
  bar.appendChild(h('span', { class: 'vlabel' }, 'Columns')); bar.appendChild(seg);
  bar.appendChild(h('div', { style: 'flex:1' }));
  bar.appendChild(h('span', { class: 'sm muted' }, 'Click a cell to edit. Blue column letters are written straight into the workbook.'));

  const cols = presetCols(T.preset);
  let rows = S.filtered.slice();
  if (T.sort != null) {
    const c = T.sort;
    rows.sort((a, b) => {
      const x = a.v[c], y = b.v[c];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      const cmp = isDate(x) && isDate(y) ? dayKey(x) - dayKey(y) : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return cmp * T.dir;
    });
  }
  const wrap = h('div', { class: 'tblwrap' });
  const table = h('table', { class: 'tbl' });
  const colgroup = h('colgroup');
  colgroup.appendChild(h('col', { style: 'width:34px' }));
  for (const c of cols) colgroup.appendChild(h('col', { style: `width:${colWidth(c)}px` }));
  table.appendChild(colgroup);
  const thead = h('thead'); const tr = h('tr');
  tr.appendChild(h('th', { class: 'stickycol', style: 'left:0' }, '#'));
  let left = 34;
  cols.forEach((c, i) => {
    const sticky = i < 2;
    const th = h('th', {
      class: sticky ? 'stickycol' : '', style: sticky ? `left:${left}px` : '',
      title: `${c.letter} · ${c.name}${c.owner ? '\nMaintained by ' + c.owner : ''}${c.formula ? '\nCalculated in the workbook — editing replaces the formula with a value' : ''}`,
      onclick: () => { if (T.sort === c.i) T.dir = -T.dir; else { T.sort = c.i; T.dir = 1; } render(); }
    }, h('span', { class: 'hl' }, c.letter, c.formula ? h('span', { class: 'fx' }, ' fx') : null), c.name.slice(0, 34), T.sort === c.i ? (T.dir > 0 ? ' ▲' : ' ▼') : '');
    if (sticky) left += colWidth(c);
    tr.appendChild(th);
  });
  thead.appendChild(tr); table.appendChild(thead);
  const tbody = h('tbody'); table.appendChild(tbody);
  wrap.appendChild(table); view.appendChild(wrap);

  // virtualisation
  const ROW = 30, BUF = 12;
  const spacerTop = h('tr', { style: 'height:0' }), spacerBot = h('tr', { style: 'height:0' });
  function draw() {
    const top = wrap.scrollTop, vh = wrap.clientHeight;
    const first = Math.max(0, Math.floor(top / ROW) - BUF);
    const last = Math.min(rows.length, Math.ceil((top + vh) / ROW) + BUF);
    clear(tbody);
    spacerTop.style.height = first * ROW + 'px'; spacerBot.style.height = Math.max(0, (rows.length - last) * ROW) + 'px';
    tbody.appendChild(spacerTop);
    for (let i = first; i < last; i++) tbody.appendChild(rowEl(rows[i], i));
    tbody.appendChild(spacerBot);
  }
  function rowEl(o, i) {
    const tr = h('tr', { class: S.sel === o ? 'sel' : '' });
    tr.appendChild(h('td', { class: 'stickycol n muted', style: 'left:0;cursor:pointer', onclick: () => openDrawer(o) }, i + 1));
    let l = 34;
    cols.forEach((c, ci) => {
      const sticky = ci < 2;
      const v = o.v[c.i];
      const edited = m.edits.has(o.r + ':' + c.i);
      const isNum = typeof v === 'number', isDt = isDate(v);
      const locked = c.owner === 'PLM' && !edited;
      const td = h('td', {
        class: (sticky ? 'stickycol ' : '') + (isNum ? 'n ' : isDt ? 'd ' : '') + (edited ? 'edited ' : '') + (locked ? 'locked ' : 'editable'),
        style: sticky ? `left:${l}px` : '',
        title: locked ? c.name + ' comes from the PLM system. Click to edit anyway.' : '',
        onclick: () => editCell(td, o, c)
      }, cellText(v, c));
      if (sticky) l += colWidth(c);
      tr.appendChild(td);
    });
    return tr;
  }
  wrap.addEventListener('scroll', () => requestAnimationFrame(draw));
  draw();
  if (!rows.length) view.appendChild(h('div', { class: 'empty' }, 'No order matches these filters.'));
}
function colWidth(c) {
  const k = c.nkey;
  if (/SAITEX PO|CUST PO|BLK/.test(k)) return 108;
  if (c.type === 'date') return 92;
  if (c.type === 'number') return 78;
  if (/DESCRIPTION|REMARK|REASON|RECIPE|STATUS$/.test(k)) return 210;
  return 124;
}
function cellText(v, c) {
  if (v == null) return '';
  if (isDate(v)) return v.getUTCFullYear() < 2000 ? '' : fmtDate(v);
  if (typeof v === 'number') return Number.isInteger(v) ? fmt(v) : (Math.abs(v) < 100 ? v.toFixed(2) : fmt(v));
  return String(v);
}
function editCell(td, o, c) {
  if (td.querySelector('input')) return;
  const m = S.model, v = o.v[c.i];
  const type = c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text';
  const inp = h('input', { class: 'cellin', type, value: isDate(v) ? ymd(v) : v == null ? '' : v, step: 'any' });
  clear(td); td.appendChild(inp); inp.focus(); inp.select();
  const commit = save => {
    const raw = inp.value.trim();
    clear(td);
    if (save) {
      let nv = null;
      if (raw !== '') nv = type === 'date' ? parseYmd(raw) : type === 'number' ? (isNaN(+raw) ? raw : +raw) : raw;
      if (PC.setCell(m, o, c.i, nv)) { afterEdit(`${str(o.v[m.F.po])} · ${c.name} → ${cellText(nv, c) || 'blank'}`, true); return; }
    }
    td.textContent = cellText(o.v[c.i], c);
  };
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { e.preventDefault(); commit(false); } });
}

/* ================= view: changes ================= */
function renderChanges(view, bar) {
  const m = S.model;
  bar.appendChild(h('span', { class: 'vlabel' }, 'Edits waiting to be written back'));
  bar.appendChild(h('div', { style: 'flex:1' }));
  bar.appendChild(h('button', { class: 'btn', disabled: !m.edits.size, onclick: () => { if (confirm('Discard all ' + m.edits.size + ' edits and go back to the workbook values?')) discardAll(); } }, 'Discard all'));
  bar.appendChild(h('button', { class: 'btn primary', disabled: !m.edits.size, onclick: doExport }, 'Export workbook'));

  const wrap = h('div', { class: 'ov' });
  if (!m.edits.size) {
    wrap.appendChild(h('div', { class: 'panel' }, h('div', { class: 'empty' },
      'No edits yet. Drag an order on the line board, or click any cell in Orders, and every change lands here before it goes back into the workbook.')));
    view.appendChild(wrap); return;
  }
  const byRow = new Map();
  for (const e of m.edits.values()) { if (!byRow.has(e.r)) byRow.set(e.r, []); byRow.get(e.r).push(e); }
  const p = panel(`${m.edits.size} cell${m.edits.size > 1 ? 's' : ''} changed across ${byRow.size} order${byRow.size > 1 ? 's' : ''}`, 'exported into the same workbook, formulas elsewhere left untouched');
  const body = p.querySelector('.body'); body.style.padding = '0';
  for (const [r, list] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const o = PC.orderByRow(m, r);
    body.appendChild(h('div', { style: 'padding:7px 12px 3px;font-weight:600;font-size:12px;display:flex;gap:8px;align-items:center' },
      h('span', { class: 'mono' }, str(o.v[m.F.po])),
      h('span', { class: 'muted sm' }, [str(o.v[m.F.customer]), str(o.v[m.F.style]), str(o.v[m.F.line])].filter(Boolean).join(' · ')),
      h('button', { class: 'btn', style: 'margin-left:auto', onclick: () => openDrawer(o) }, 'Open')));
    for (const e of list) {
      const c = m.cols[e.c];
      body.appendChild(h('button', { class: 'clrow', onclick: () => openDrawer(o) },
        h('span', { class: 'col' }, c.letter + ' · ' + c.name),
        h('span', { class: 'chg' }, h('span', { class: 'old' }, cellText(e.orig, c) || 'blank'), ' → ', h('span', { class: 'new' }, cellText(e.value, c) || 'blank')),
        e.origFormula ? h('span', { class: 'tag warn' }, 'was a formula') : h('span')));
    }
  }
  wrap.appendChild(p);
  wrap.appendChild(h('div', { class: 'hint', style: 'padding:0 2px' },
    'Cells that held a formula keep your typed value; every other formula in the workbook is preserved and Excel recalculates the file when it opens.'));
  view.appendChild(wrap);
}
function discardAll() {
  const m = S.model;
  for (const e of [...m.edits.values()]) { const o = PC.orderByRow(m, e.r); if (!o) continue; o.v[e.c] = e.orig; o.f[e.c] = e.origFormula; o.dirty = false; PC.recompute(m, o); }
  m.edits.clear(); m.undo.length = 0; m.redo.length = 0;
  localStorage.removeItem(S.storeKey);
  afterEdit('All edits discarded.');
}

/* ================= drawer ================= */
function openDrawer(o, keepScroll) {
  const m = S.model, F = m.F, d = $('drawer');
  const prevScroll = keepScroll ? (d.querySelector('.dbody') || {}).scrollTop : 0;
  const openSecs = new Set([...d.querySelectorAll('details[open]')].map(x => x.dataset.k));
  S.sel = o;
  if (!keepScroll) S.drawerMark = m.undo.length;   // edits made from here on belong to this visit
  clear(d);
  const p = PC.orderProgress(m, o);
  const g = k => (F[k] >= 0 ? o.v[F[k]] : null);
  const late = PC.isLate(m, o);
  const ex = g('planExFactory'), dly = g('cusFinalDly');
  const slack = isDate(ex) && isDate(dly) ? dayKey(dly) - dayKey(ex) : null;
  const L = m.lineMap.get(str(g('line')).trim());

  const head = h('div', { class: 'dhead' },
    h('div', { class: 'top' },
      h('div', { style: 'flex:1;min-width:0' },
        h('h2', {}, h('span', { class: 'mono' }, str(g('po')) || '(no MO)'), h('span', { class: 'tag neutral' }, str(g('blk')))),
        h('div', { class: 'sub' }, [str(g('customer')), 'style ' + str(g('style')), str(g('desc'))].filter(Boolean).join(' · '))),
      h('button', { class: 'btn icon', title: 'Close', onclick: () => closeDrawer() }, '×')),
    h('div', { class: 'dpills' },
      h('span', { class: 'tag accent' }, PC.stageLabel(p.stage)),
      (function () {
        const run = PC.runState(m, o), lead = PC.leadDays(m, o);
        if (run === 'running') return h('span', { class: 'tag ok' }, '● Running');
        if (run === 'ready') return h('span', { class: 'tag warn' }, '◐ Ready to run' + (lead != null ? ', sewing in ' + lead + ' d' : ''));
        if (run === 'clear') return h('span', { class: 'tag neutral' }, 'Cleared' + (lead != null ? ', sewing in ' + lead + ' d' : ''));
        if (run === 'waiting') return h('span', { class: 'tag neutral' }, 'Waiting on ' + PC.openGates(m, o).join(', '));
        return null;
      })(),
      (function () {
        const otd = PC.otdDays(m, o);
        if (otd != null && otd < 0) return h('span', { class: 'tag bad' }, '▲ ' + Math.round(-otd) + ' days late');
        if (slack != null && slack < 0) return h('span', { class: 'tag bad' }, '▲ ex-factory ' + Math.abs(slack) + ' d after delivery');
        if (late) return h('span', { class: 'tag bad' }, '▲ at risk');
        return h('span', { class: 'tag ok' }, '● ' + (slack != null ? slack + ' days spare' : 'on plan'));
      })(),
      (function () { const otd = PC.otdDays(m, o); if (otd == null) return str(g('otd')) ? h('span', { class: 'tag neutral' }, str(g('otd'))) : null;
        return h('span', { class: 'tag neutral', title: 'Column Y, on-time delivery in days. A minus figure means the order is late.' }, 'OTD ' + (otd < 0 ? '' : '+') + Math.round(otd) + ' d'); })(),
      g('delayBucket') ? h('span', { class: 'tag warn' }, 'delay ' + str(g('delayBucket')).toLowerCase()) : null,
      PC.isNonWash(m, o) ? h('span', { class: 'tag neutral' }, 'no wash — no laundry line') : null,
      o.dirty ? h('span', { class: 'tag warn' }, 'edited') : null,
      (function () {
        const lane = laneFieldForBoard(), cur = str(o.v[lane.col]).trim();
        if (!cur || /^#/.test(cur)) return null;
        return h('button', { class: 'unassign', title: `Clear ${lane.what} ${cur}. The order leaves that lane and parks under "Not assigned to a lane", where you can drag it back. It is not deleted.`,
          onclick: e => removeFromLane(o, e) }, '✕ Take off ' + cur);
      })(),
      h('button', { class: 'unassign stashbtn', title: 'Park this order in the stash. It comes off the board and off the capacity figures, and waits in the tray until you put it back or drag it onto a lane.',
        onclick: () => stashOrder(o) }, '⇩ Stash')));
  d.appendChild(head);

  const body = h('div', { class: 'dbody' });
  body.appendChild(h('div', { class: 'edithint' },
    h('span', {}, 'Click any value to edit it.'),
    (function () { const n = drawerEditCount();
      return n ? h('span', { class: 'tag warn' }, `${n} unsaved change${n > 1 ? 's' : ''}`) : null; })()));
  // --- order identity (the non-production columns the planner asked for)
  body.appendChild(kvSection('order', 'Order', [
    'po', 'blk', 'ldrLine', 'season', 'factoryNo', 'line', 'customerPlan', 'style', 'desc',
    'sysDelivery', 'cusFinalDly', 'saitexDelivery', 'otd', 'custPo', 'sampleType', 'fabric', 'wash', 'qty', 'target',
  ], o, true));
  {
    const rec = str(g('recipe')).trim();
    body.appendChild(h('div', { style: 'margin-top:8px;border:1px solid var(--sx-border-subtle);padding:6px 8px' },
      h('div', { class: 'k', style: 'font-size:11px;font-weight:500;color:var(--sx-text-disabled);display:flex;gap:4px' },
        h('span', { class: 'cl', style: 'color:var(--sx-text-link);font-family:var(--sx-font-mono)' }, 'HX'), 'Wash recipe'),
      rec && !/non\s*wash/i.test(rec)
        ? h('div', { class: 'mono', style: 'font-size:11px;white-space:normal;line-height:1.5;margin-top:2px' }, rec)
        : h('div', { style: 'margin-top:3px' }, h('span', { class: 'tag neutral' }, 'No recipe — this style is not washed, so no laundry line is allocated'))));
  }
  if (L) body.appendChild(h('div', { class: 'hint', style: 'margin-top:6px' },
    `Sewing line ${L.name} → factory ${L.site}, ${L.unit}. ${L.inout === 'Inside' ? 'In-house' : 'Subcontract'} · ${fmt(L.target)} pcs/day target.`));

  // --- stage rail
  const rail = h('div', { class: 'stagerail' });
  STAGES.forEach((st, i) => {
    const w = PC.stageWindow(m, o, st);
    const done = p.done[i], bal = Math.max(0, p.qty - done);
    const actual = g(st.actual);
    const skip = st.key === 'wash' && PC.isNonWash(m, o);
    rail.appendChild(h('div', { class: 'scard' + (p.stage === i ? ' current' : '') + (done >= p.qty && p.qty ? ' done' : '') },
      h('div', { class: 'sn' }, h('i', { class: 'dot', style: 'background:' + stageColor(i) }), st.short === 'Ship' ? 'Ex-factory' : st.name),
      h('div', { class: 'sd' },
        h('div', { class: 'dates' },
          skip ? h('span', {}, 'not required') :
            h('span', {}, 'plan ', h('b', {}, w ? fmtDateShort(keyToDate(w[0])) + ' → ' + fmtDate(keyToDate(w[1])) : '—')),
          actual != null ? h('span', {}, 'actual ', h('b', {}, isDate(actual) ? fmtDate(actual) : str(actual))) : null,
          st.key === 'sew' && isDate(g('factoryConfirm')) ? h('span', { style: dayKey(g('factoryConfirm')) > dayKey(g('sew2') || g('factoryConfirm')) ? 'color:var(--sx-text-warning)' : '' }, 'factory says ', h('b', {}, fmtDate(g('factoryConfirm')))) : null,
          st.key === 'wash' && g('ldLine') ? h('span', {}, 'LD line ', h('b', {}, str(g('ldLine')))) : null,
          st.key === 'fin' && g('finLine') ? h('span', {}, 'line ', h('b', {}, str(g('finLine')))) : null),
        skip ? null : h('div', { class: 'qbar' }, h('i', { style: `width:${p.qty ? Math.min(100, done / p.qty * 100) : 0}%` })),
        skip ? null : h('div', { class: 'qty' }, h('b', {}, fmt(done)), ' of ', fmt(p.qty), ' pcs · ', h('b', {}, fmt(bal)), ' to go'))));
  });
  body.appendChild(h('details', { class: 'dsec', 'data-k': 'stages', open: true }, h('summary', {}, 'Every production stage'), rail));

  body.appendChild(kvSection('sewplan', 'Sewing plan (drag on the board writes these)', ['pcd', 'markerRelease', 'markerAct', 'inputDate', 'inputQty', 'sew1', 'sew2', 'planPrev', 'factoryConfirm', 'target', 'days', 'output', 'dispatched'], o, openSecs.has('sewplan') || true));
  body.appendChild(kvSection('wip', 'Work in progress', ['cutQty', 'cutBal', 'wipInput', 'wipSewing', 'sewBal', 'wipDispatch', 'wipInLR', 'washBal', 'wipInFin', 'finBal', 'wipForPacking', 'packBal', 'whWip', 'shipBal'], o, openSecs.has('wip')));
  body.appendChild(kvSection('appr', 'Approvals', ['fitStatus', 'fitSubmit', 'fitApproved', 'ppStatus', 'ppSubmit', 'ppApproved', 'washAppStatus', 'washAppDate', 'repeatNew'], o, openSecs.has('appr')));
  body.appendChild(kvSection('laundry', 'Laundry', ['ldLine', 'recipe', 'washFirstOut', 'washLastOut', 'laundryWip', 'lrCompletion', 'lrConfirm', 'washOutput', 'washBal', 'rinse', 'dyeing', 'wash2', 'washQuality'], o, openSecs.has('laundry')));
  body.appendChild(kvSection('fab', 'Fabric & shrinkage', ['fabric', 'mill', 'fabArticle', 'consumption', 'yds', 'fabReqIH', 'fabEstIH', 'fabActIH', 'shrinkStatus', 'shrinkActDate', 'shadeStatus'], o, openSecs.has('fab')));
  {
    const trims = ['pocketing', 'interlining', 'thread', 'zipper', 'label', 'hookBar'];
    const box = h('div', { class: 'trims' });
    for (const k of trims) {
      const v = g(k); const s = isDate(v) ? fmtDate(v) : str(v);
      const cls = /^IH$/i.test(s) ? 'ok' : /N\/A|^na$/i.test(s) ? 'neutral' : s ? 'warn' : 'neutral';
      box.appendChild(h('span', { class: 'tag ' + cls }, PC.FIELD_DEFS[k][1] + ': ' + (s || '—')));
    }
    const st = str(g('trimStatus'));
    box.appendChild(h('span', { class: 'tag ' + (/cmpl/i.test(st) ? 'ok' : 'warn') }, 'Trim status: ' + (st || '—')));
    body.appendChild(h('details', { class: 'dsec', 'data-k': 'trims', open: openSecs.has('trims') }, h('summary', {}, 'Trims'), box));
  }
  body.appendChild(kvSection('dly', 'Delivery & merchandising', ['planInspection', 'planExFactory', 'exFactory', 'shippedQty', 'sysDelivery', 'dlyRevision', 'stxFinalDly', 'merchConfirm', 'merchComment', 'delayBucket', 'delayReason', 'shipMonthFinal'], o, openSecs.has('dly')));
  // plan history
  if (m.historyCols.length) {
    const box = h('div', { class: 'hist' });
    const vals = m.historyCols.map(c => ({ c, v: o.v[c] })).filter(x => isDate(x.v) && x.v.getUTCFullYear() > 2000);
    if (vals.length) {
      const lo = Math.min(...vals.map(x => dayKey(x.v))), hi = Math.max(...vals.map(x => dayKey(x.v)));
      for (const x of vals) box.appendChild(h('div', { class: 'h' },
        h('span', { class: 'muted' }, m.cols[x.c].name), h('span', {}, fmtDate(x.v)),
        h('span', {}, h('i', { class: 'b', style: `display:block;width:${hi > lo ? 6 + (dayKey(x.v) - lo) / (hi - lo) * 90 : 40}%` }))));
      body.appendChild(h('details', { class: 'dsec', 'data-k': 'hist', open: openSecs.has('hist') }, h('summary', {}, 'How the cut date moved across planning rounds'), box));
    }
  }
  d.appendChild(body);
  d.appendChild(h('div', { class: 'dactions' },
    h('button', { class: 'btn', onclick: () => { S.board.stage = 'sew'; const w = PC.stageWindow(m, o, STAGES[1]); if (w) S.board.from = w[0] - 14; closeDrawer(); setView('board'); } }, 'Show on the board'),
    h('button', { class: 'btn', onclick: () => { setOnlyFacet('blk', str(g('blk'))); closeDrawer(); } }, 'Show the whole bulk'),
    h('button', { class: 'btn', onclick: () => shiftOrder(o, -1) }, '− 1 day'),
    h('button', { class: 'btn', onclick: () => shiftOrder(o, 1) }, '+ 1 day')));
  $('scrim').classList.add('on'); d.classList.add('on');
  if (keepScroll) d.querySelector('.dbody').scrollTop = prevScroll;
}
function kvSection(key, title, fieldKeys, o, open) {
  const m = S.model, F = m.F;
  const grid = h('div', { class: 'kv' });
  for (const k of fieldKeys) {
    const ci = F[k]; if (ci == null || ci < 0) continue;
    const c = m.cols[ci], v = o.v[ci];
    const edited = m.edits.has(o.r + ':' + ci);
    const val = h('div', { class: 'v editable' + (edited ? ' edited' : ''), tabindex: 0, title: 'Click to edit ' + c.name, onclick: () => editKV(val, o, c), onkeydown: e => { if (e.key === 'Enter') editKV(val, o, c); } }, cellText(v, c) || '—');
    grid.appendChild(h('div', {}, h('div', { class: 'k', title: `Column ${c.letter} · ${c.name}` },
      h('span', { class: 'nm' }, tidyLabel(c.name)), h('span', { class: 'cl' }, c.letter)), val));
  }
  return h('details', { class: 'dsec', 'data-k': key, open: !!open }, h('summary', {}, title), grid);
}
// The sheet shouts its headers. Title-case the words but leave the trade's
// abbreviations alone: "SAITEX PO" -> "Saitex PO", "PLANNED QTY" -> "Planned Qty".
const LABEL_WORDS = { NO: 'No', QTY: 'Qty', DLY: 'Dly', PKC: 'Pkc', APP: 'App', REQ: 'Req', ACT: 'Act', EST: 'Est',
  MK: 'Mk', CUS: 'Cus', FOR: 'for', TO: 'to', IN: 'in', OF: 'of', AND: 'and', VS: 'vs' };
function tidyLabel(name) {
  const t = String(name).replace(/\s+/g, ' ').trim().slice(0, 30);
  if (/[a-z]/.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);   // already mixed case, leave it
  return t.split(' ').map(w => {
    if (LABEL_WORDS[w]) return LABEL_WORDS[w];
    if (w.length <= 3 && /^[A-Z&/()#%+-]+$/.test(w)) return w;          // PO, BLK, LDR, OTD, PP
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}
function editKV(el, o, c) {
  if (el.querySelector('input')) return;
  const m = S.model, v = o.v[c.i];
  const type = c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text';
  const inp = h('input', { type, value: isDate(v) ? ymd(v) : v == null ? '' : v, step: 'any' });
  clear(el); el.appendChild(inp); inp.focus(); inp.select();
  const commit = save => {
    const raw = inp.value.trim(); clear(el);
    if (save) {
      let nv = null; if (raw !== '') nv = type === 'date' ? parseYmd(raw) : type === 'number' ? (isNaN(+raw) ? raw : +raw) : raw;
      if (PC.setCell(m, o, c.i, nv)) { afterEdit(`${str(o.v[m.F.po])} · ${c.name} → ${cellText(nv, c) || 'blank'}`, true); return; }
    }
    el.textContent = cellText(o.v[c.i], c) || '—';
  };
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') commit(false); });
}
function stashOrder(o) {
  const m = S.model, F = m.F, lane = laneFieldForBoard();
  const from = str(o.v[lane.col]).trim();
  PC.beginGroup(m);
  try { if (from) PC.setCell(m, o, lane.col, null); } finally { PC.endGroup(); }
  S.stash.set(o.r, { col: lane.col, lane: from, what: lane.what });
  closeDrawer(true);
  afterEdit(`${str(o.v[F.po])} stashed${from ? ' from ' + from : ''}`, true);
}
function unstash(row, laneName) {
  const m = S.model, o = PC.orderByRow(m, row), info = S.stash.get(row);
  if (!o || !info) return;
  S.stash.delete(row);
  const target = laneName === undefined ? info.lane : laneName;
  if (target) { PC.beginGroup(m); try { PC.setCell(m, o, info.col, target); } finally { PC.endGroup(); } }
  afterEdit(`${str(o.v[m.F.po])} back${target ? ' on ' + target : ' on the board'}`, true);
}
// Which lane column the board is currently drawing rows from.
function laneFieldForBoard() {
  const F = S.model.F, k = S.board.stage;
  if (k === 'wash') return { col: F.ldLine, what: 'laundry line' };
  if (k === 'fin' || k === 'pack') return { col: F.finLine, what: 'finishing line' };
  return { col: F.line, what: 'sewing line' };
}
// Takes the order off its lane. It is an ordinary edit: undoable, listed in
// Changes, and written to the workbook as a blank cell on export.
function removeFromLane(o, ev) {
  const m = S.model, F = m.F, lane = laneFieldForBoard();
  const cur = str(o.v[lane.col]).trim();
  if (!cur) { toast(`This order has no ${lane.what} set.`); return; }
  const pop = openPop('Take it off the ' + lane.what, ev ? ev.clientX : null, ev ? ev.clientY : null);
  pop.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:6px' },
    h('span', { class: 'mono' }, str(o.v[F.po])), ' · ', str(o.v[F.customer]), ' · ', fmt(num(o.v[F.qty])), ' pcs'));
  pop.appendChild(h('div', { style: 'display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:12px;align-items:baseline' },
    h('span', { class: 'muted' }, m.cols[lane.col].name),
    h('span', { class: 'mono', style: 'color:var(--sx-text-disabled);text-decoration:line-through' }, cur)));
  pop.appendChild(h('div', { class: 'hint', style: 'margin-top:7px;white-space:normal;line-height:1.5' },
    `It drops off ${cur} and parks under "Not assigned to a lane" on the board, keeping its dates and quantities. Drag it onto a lane to put it back. The order itself is not deleted, and the workbook keeps the row.`));
  const go = h('button', { class: 'btn primary', onclick: () => { closePop();
    PC.setCell(m, o, lane.col, null);
    S.sel = o;
    afterEdit(`${str(o.v[F.po])} taken off ${cur}`, true);
  } }, 'Take it off the lane');
  pop.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:10px' }, go,
    h('button', { class: 'btn', onclick: closePop }, 'Cancel')));
  go.focus();
}
function drawerEditCount() {
  const m = S.model;
  if (!m || S.drawerMark == null) return 0;
  return Math.max(0, m.undo.length - S.drawerMark);
}
function closeDrawer(force) {
  if (drawerEditCount() > 0 && force !== true) { confirmDrawerClose(); return; }
  S.drawerMark = null;
  $('drawer').classList.remove('on'); $('scrim').classList.remove('on');
}
function confirmDrawerClose() {
  const m = S.model, o = S.sel, F = m.F;
  const n = drawerEditCount();
  const changed = m.undo.slice(S.drawerMark).map(x => m.cols[x.c].name);
  const seen = [...new Set(changed)];
  const pop = openPop(`Save ${n} change${n > 1 ? 's' : ''}?`);
  pop.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:6px' },
    h('span', { class: 'mono' }, str(o.v[F.po])), ' · ', str(o.v[F.customer])));
  pop.appendChild(h('div', { class: 'hint', style: 'white-space:normal;line-height:1.5' },
    'You edited ' + seen.slice(0, 6).map(tidyLabel).join(', ') + (seen.length > 6 ? ` and ${seen.length - 6} more` : '') +
    '. Saving keeps them for the export; discarding puts every one of them back.'));
  const save = h('button', { class: 'btn primary', onclick: () => { closePop(); closeDrawer(true); toast(`${n} change${n > 1 ? 's' : ''} kept. Export writes them into the workbook.`); } }, 'Save changes');
  pop.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap' }, save,
    h('button', { class: 'btn', onclick: () => { closePop();
      while (drawerEditCount() > 0 && m.undo.length) PC.undo(m);
      closeDrawer(true); afterEdit('Changes discarded.'); } }, 'Discard changes'),
    h('button', { class: 'btn', onclick: closePop }, 'Keep editing')));
  save.focus();
}

/* ---- popover ---- */
let popEl = null;
function openPop(title, x, y) {
  closePop();
  popEl = h('div', { class: 'pop', tabindex: -1 }, h('h4', {}, title));
  popEl._at = [x, y];
  popEl.style.maxHeight = Math.max(180, window.innerHeight - 24) + 'px';   // set once, never from the observer
  document.body.appendChild(popEl);
  placePop();
  // the caller fills it after this returns, and the web font settles later still,
  // so follow every size change rather than guessing when it has finished growing
  if (window.ResizeObserver) { popEl._ro = new ResizeObserver(() => placePop()); popEl._ro.observe(popEl); }
  requestAnimationFrame(placePop);
  setTimeout(placePop, 80);   // after the web font settles
  setTimeout(() => document.addEventListener('pointerdown', outside, { once: false }), 0);
  return popEl;
}
function placePop() {
  if (!popEl) return;
  const [x, y] = popEl._at || [null, null];
  const w = popEl.offsetWidth || 300, hh = popEl.offsetHeight || 200;
  const px = x == null ? window.innerWidth / 2 - w / 2 : Math.min(x + 12, window.innerWidth - w - 12);
  const py = y == null ? 120 : Math.min(y + 12, window.innerHeight - hh - 12);
  popEl.style.left = Math.max(8, px) + 'px';
  popEl.style.top = Math.max(8, py) + 'px';
}
function outside(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
function closePop() { if (popEl) { if (popEl._ro) popEl._ro.disconnect(); popEl.remove(); popEl = null; document.removeEventListener('pointerdown', outside); } }

/* ================= export ================= */
async function doExport() {
  const m = S.model;
  if (S.sample || !m.buffer) {
    toast('This is the read-only sample. Load your own workbook to write edits back and export.', 'Load workbook', () => $('drop').classList.remove('hide'));
    return;
  }
  if (!m.edits.size) { toast('Nothing has changed yet, so the workbook would be identical.'); return; }
  const btn = $('exportbtn'); btn.disabled = true; const label = btn.firstChild.textContent;
  try {
    const blob = await PC.buildEditedWorkbook(m, { onProgress: (l, f) => { btn.firstChild.textContent = l + ' ' + Math.round(f * 100) + '%'; } });
    const name = m.fileName.replace(/\.xlsx?$/i, '') + ' (edited).xlsx';
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    toast(`${name} saved with ${m.edits.size} changed cell${m.edits.size > 1 ? 's' : ''}. Excel recalculates the sheet when it opens.`);
  } catch (err) {
    console.error(err); toast('Export failed: ' + (err.message || err));
  } finally { btn.disabled = false; btn.firstChild.textContent = label; }
}

boot();
})();
