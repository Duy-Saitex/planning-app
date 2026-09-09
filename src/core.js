/* core.js — Saitex Master Plan data core (browser + node). No framework. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('jszip'));
  else root.PlanCore = factory(root.JSZip);
})(typeof self !== 'undefined' ? self : this, function (JSZip) {
'use strict';

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;

// ---------- primitives ----------
function serialToDate(n) { return new Date(EPOCH + Math.round(n * DAY)); }
function dateToSerial(d) { return (d.getTime() - EPOCH) / DAY; }
function isDate(v) { return v instanceof Date && !isNaN(v); }
function dayKey(d) { return Math.floor((d.getTime() - EPOCH) / DAY); }
function keyToDate(k) { return new Date(EPOCH + k * DAY); }
function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
function startOfDay(d) { return keyToDate(dayKey(d)); }
function isSunday(d) { return d.getUTCDay() === 0; }
function skipSunday(d) { return isSunday(d) ? addDays(d, 1) : d; }
function plusSkip(d, n) { return isDate(d) ? skipSunday(addDays(startOfDay(d), n)) : null; }
function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
function str(v) { return v == null ? '' : (isDate(v) ? ymd(v) : String(v)); }
function ymd(d) { return isDate(d) ? d.toISOString().slice(0, 10) : ''; }
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function mmmyy(d) { return isDate(d) ? MON[d.getUTCMonth()] + "'" + String(d.getUTCFullYear()).slice(2) : null; }
function fmtDate(d) { return isDate(d) ? String(d.getUTCDate()).padStart(2, '0') + ' ' + MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2) : ''; }
function fmtDateShort(d) { return isDate(d) ? d.getUTCDate() + ' ' + MON[d.getUTCMonth()] : ''; }
function parseYmd(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim()); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
function monthKey(d) { return isDate(d) ? d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') : null; }
function weekKey(d) { // Saturday-ending week like the sheet (WEEK = d + 7 - WEEKDAY(d,1)) → returns key of that Saturday
  if (!isDate(d)) return null; const k = dayKey(d); const wd = keyToDate(k).getUTCDay(); return k + (6 - wd);
}
function colToIdx(L) { let n = 0; for (let i = 0; i < L.length; i++) n = n * 26 + (L.charCodeAt(i) - 64); return n - 1; }
function idxToCol(i) { let s = ''; i = i + 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
const XML_ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function unescapeXml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, c) => {
    if (c[0] === '#') return String.fromCodePoint(c[1] === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10));
    return XML_ENT[c];
  });
}
function escapeXml(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
function attr(a, name) { const m = new RegExp('(?:^|\\s)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]*)"').exec(a); return m ? m[1] : undefined; }
function normKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9#%&/()+-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function yieldToUI() { return new Promise(r => setTimeout(r, 0)); }

// ---------- OOXML parsing ----------
function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const re = /<si>([\s\S]*?)<\/si>/g; let m;
  while ((m = re.exec(xml))) {
    const body = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    let t = '';
    const tr = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let tm;
    while ((tm = tr.exec(body))) t += tm[1];
    out.push(unescapeXml(t));
  }
  return out;
}
const BUILTIN_DATE_FMT = new Set([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]);
function isDateFmt(id, code) {
  if (code == null) return BUILTIN_DATE_FMT.has(id);
  const s = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  if (/general/i.test(s)) return false;
  return /[ymdhs]/i.test(s);
}
function parseDateStyles(xml) {
  const fmts = {};
  const nf = /<numFmt\b([^>]*)\/?>/g; let m;
  while ((m = nf.exec(xml))) { const id = +attr(m[1], 'numFmtId'); fmts[id] = unescapeXml(attr(m[1], 'formatCode') || ''); }
  const block = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  const out = [];
  if (!block) return out;
  const xf = /<xf\b([^>]*?)(?:\/>|>)/g;
  while ((m = xf.exec(block[1]))) { const id = +(attr(m[1], 'numFmtId') || 0); out.push(isDateFmt(id, fmts[id])); }
  return out;
}
function innerText(inner) { let t = ''; const tr = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = tr.exec(inner))) t += m[1]; return unescapeXml(t); }

async function parseSheetXml(xml, sst, dateStyles, onProgress) {
  const rows = [];            // rows[r] = sparse array of values
  const frows = [];           // frows[r] = sparse array of 1 where formula
  const formulaCount = [];
  const colDateStyle = [];
  let maxCol = 0, count = 0;
  const sdStart = Math.max(0, xml.indexOf('<sheetData'));
  let sdEnd = xml.indexOf('</sheetData>'); if (sdEnd < 0) sdEnd = xml.length;
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let pos = sdStart;
  for (;;) {
    const rs = xml.indexOf('<row ', pos); if (rs < 0 || rs > sdEnd) break;
    const tagEnd = xml.indexOf('>', rs);
    const rm = /\br="(\d+)"/.exec(xml.slice(rs, tagEnd)); const rnum = rm ? +rm[1] : 0;
    if (xml[tagEnd - 1] === '/') { pos = tagEnd + 1; continue; }
    const re = xml.indexOf('</row>', tagEnd);
    const body = xml.slice(tagEnd + 1, re < 0 ? sdEnd : re);
    const arr = [], farr = [];
    cellRe.lastIndex = 0; let m;
    while ((m = cellRe.exec(body))) {
      const c = colToIdx(m[1]); const attrs = m[3]; const inner = m[4];
      if (c + 1 > maxCol) maxCol = c + 1;
      if (inner === undefined) continue;
      const sM = /\bs="(\d+)"/.exec(attrs); const s = sM ? +sM[1] : 0;
      const tM = /\bt="(\w+)"/.exec(attrs); const t = tM ? tM[1] : 'n';
      if (inner.indexOf('<f') >= 0) { formulaCount[c] = (formulaCount[c] || 0) + 1; farr[c] = 1; }
      let v = null;
      if (t === 'inlineStr') v = innerText(inner);
      else {
        const vM = /<v>([^<]*)<\/v>/.exec(inner);
        if (vM && vM[1] !== '') {
          const raw = vM[1];
          if (t === 's') { const sv = sst[+raw]; v = sv == null ? null : sv; }
          else if (t === 'str') v = unescapeXml(raw);
          else if (t === 'e') v = null;
          else if (t === 'b') v = raw === '1';
          else { const n = Number(raw); if (isNaN(n)) v = null; else if (dateStyles[s]) { v = serialToDate(n); if (colDateStyle[c] === undefined) colDateStyle[c] = s; } else v = n; }
        }
      }
      if (typeof v === 'string') { v = v.trim(); if (v === '') v = null; }
      if (v !== null) arr[c] = v;
    }
    rows[rnum] = arr; frows[rnum] = farr;
    pos = (re < 0 ? sdEnd : re) + 6; count++;
    if ((count & 127) === 0) { if (onProgress) onProgress('Reading rows', 0.3 + 0.6 * (rs - sdStart) / Math.max(1, sdEnd - sdStart)); await yieldToUI(); }
  }
  return { rows, frows, maxCol, formulaCount, colDateStyle };
}

// ---------- field registry (letter + header name; header wins when the letter disagrees) ----------
const FIELD_DEFS = {
  po:['A','SAITEX PO'], blk:['B','BLK'], oldBlk:['C','OLD BLK'], ldrLine:['D','LDR LINE'], season:['E','SEASON'], inout:['F','Factory'], status:['G','STATUS'], factoryNo:['H','FACTORY'],
  line:['I','SEWING LINE NO'], customer:['J','CUSTOMER'], customerPlan:['K','CUSTOMER PLAN'], productType:['L','PRODUCT TYPE'], groupProduct:['M','GROUP PRODUCT'], style:['N','STYLE NO'], desc:['O','ORDER DESCRIPTION'],
  afterWash:['P','AFTER WASH OPERATION'], closePlacket:['Q','Close Placket'], desc2:['R','DESCRIPTION'], orderConfDate:['S','ORDER CONFIRMATION DATE'], sysDelivery:['T','SYSTEM DELIVERY'], shipMonth:['U','SHIPMENT MONTH'], cusFinalDly:['V','CUS FINAL DLY'],
  ppcdToDly:['W','PPCD To SYSTEM DLY'], saitexDelivery:['X','SAITEX DELIVERY'], otd:['Y','OTD'], orderConfToDel:['Z','ORDER CONFIRMATION TO DEL'], delayBucket:['AA','Delay'], custPo:['AB','CUST PO'], orderRec:['AC','ORDER REC'], moCreate:['AD','MO Create'], sampleType:['AE','SampleType'],
  fabric:['AF','FABRIC NAME'], wash:['AG','WASH NAME'], qty:['AH','PLANNED QTY'], target:['AI','TARGET'], days:['AJ','NO OF DAYS'], sundays:['AK','# OF SUNDAY'], adjDays:['AL','ADJUSTMENT'],
  fitStatus:['AM','FIT STATUS'], fitSubmit:['AN','FIT SUBMIT DATE'], fitApproved:['AO','FIT APPROVED DATE'], ppStatus:['AP','PP STATUS'], ppSubmit:['AQ','PP SUBMIT DATE'], ppApproved:['AR','PP APP DATE'], washAppStatus:['AS','WASH APP STATUS'], washAppDate:['AT','WASH APP DATE'],
  fabReqIH:['AU','FABRIC REQ IH'], fabActIH:['AV','ACTUAL IH DATE'], fabEstIH:['AW','EST FAB IH'], fabArticle:['AX','FABRIC ARTICLE #'], remark:['AY','REMARK'], consumption:['AZ','CONSUMSION'], yds:['BA','Qty(Yds)'], fabPkc:['BB','FABRIC PKC NO'], mill:['BC','MILL NAME'], fabIHStatus:['BD','ACT IH STATUS'], fabMerchConfirm:['BE','FABRIC MERCH CONFIRM'],
  shrinkSendLR:['BF','SHRINKAGE SEND TO LAUNDRY ACT'], shrinkLabPlan:['BH','SHRINKAGE LAUNDRY TO LAB PLAN'], shrinkLabAct:['BI','SHRINKAGE LAUNDRY TO LAB ACTUAL'], shrinkReleasePlan:['BK','LAB RELEASE SHRINKAGE PLAN'], shrinkReleaseAct:['BL','LAB RELEASE SHRINKAGE ACTUAL'],
  pocketing:['BN','POCKETING'], interlining:['BO','INTERLINING'], thread:['BP','THREAD'], zipper:['BQ','ZIPPER'], label:['BR','LABEL'], hookBar:['BS','HOOK & BAR'], trimStatus:['BT','TRIM STATUS'], trimMax:['BU','TRIM MAX DATE'], finTrim:['BV','FINAL FIN TRIM'],
  qcfPlan:['BW','QCF Plan to release date'], marker1stPlan:['BX','MARKER PLAN DATE 1st BULK'], sew1stPlan:['BY','1st bulk sewing plan to complete date'], wash1stPlan:['BZ','1st bulk washing plan to complete date'], qa1stPlan:['CA','1st bulk QA repost plan to release date'],
  skPlanLR:['CB','SK PLAN SEND LR'], skPlanLab:['CC','SK PLAN SEND LAB'], labReleasePlan:['CD','PLAN LAB RELEASE REPORT'], markerBulkPlan:['CE','MARKER PLAN DATE BULK'],
  ppm1stAct:['CF','1ST BULK ACTUAL PPM/QC File DATE'], marker1stAct:['CG','MARKER ACT DATE 1st BULK'], sew1stAct:['CH','1st Bulk sewing actual release date'], wash1stAct:['CI','1st bulk washing actual release date'], qa1stAct:['CJ','1st bulk QA repost actual release date'],
  shrinkActLR:['CK','SHRINKAGE ACT SEND LR'], shrinkActLab:['CL','SHRINKAGE ACT LR SEND LAB'], shrinkStatus:['CM','SHRINKAGE STATUS'], shrinkActDate:['CN','SHRINKAGE Act Date'], shadeStatus:['CO','SHADE STATUS'], bulkPpmAct:['CP','ACT BULK PPM'], markerAct:['CQ','MARKER ACT DATE'],
  preStatus:['CR','PRE STATUS'], repeatNew:['CS','REPEAT/NEW'], preStatusSubcon:['CT','PRE STATUS SUBCON'], ppcd:['CU','PPCD'], ppcMax:['CV','PPC Max'], delayReason:['CW','REASON FOR DELAYING'],
  planMk:['DH','PLAN MK DATE'], first:['DI','1st'], pcdBook:['DJ','PCD TO BOOK MATERIAL'], markerDiff:['DK','MARKER PLAN VS ACT DIFF'], markerRelease:['DL','MARKER RELEASE DATE'], pcd:['DM','MASTER PLANNED PCD'], cutQty:['DN','CUT QTY'],
  inputDate:['DO','INPUT DATE'], inputQty:['DP','IN PUT QTY'], wipInput:['DQ','WIP INPUT'], sew1:['DR','SEWING 1ST OUTPUT TARGET'], sew2:['DS','SEWING LAST OUTPUT TARGET'], planPrev:['DT','Plan'], factoryConfirm:['DU','FACTORY CONFIRM DATE'], output:['DV','Output'], wipSewing:['DW','WIP SEWING'],
  dispatched:['DX','DISPATCHED'], wipDispatch:['DY','WIP DISPATCH'], wipForSewing:['DZ','WIP FOR SEWING'], wipToDispatch:['EA','WIP qty to dispatch'], ldLine:['EB','LD LINE'], laundryWip:['EC','LAUNDRY WIP'], rinse:['ED','RINSE'], dyeing:['EE','DYEING'], towel:['EF','Towel'], booster:['EG','Booster'], awStitch:['EH','After Wash stitc op'],
  coating:['EI','COATING'], resin:['EJ','RESIN'], w1:['EK','W1'], wash2:['EL','2 WASH'], lrCompletion:['EM','LR COMPLETION DATE'], lrConfirm:['EN','LR CONFIRM COMPLETION DATE'], washOutput:['EO','WASH OUTPUT'], wipForWashing:['EP','WIP FOR WASHING'],
  finLine:['EQ','FINISHING LINE'], finWip:['ER','FINISHING WIP'], finCompletion:['ES','FINISHING COMPLETION DATE'], packWip:['ET','PACKING WIP'], finConfirm:['EU','FINISHING CONFIRM COMPLETION DATE'], packCompletion:['EV','PACKING COMPLETION DATE'], packConfirm:['EW','PACKING CONFIRM COMPLETION DATE'],
  inspection:['EX','INSPECTION'], inspectionConfirm:['EY','INSPECTION CONFIRM COMPLETION DATE'], exFactory:['EZ','DELIVERY/EX FACTORY'], handover:['FA','HANDOVER DATE'], sailing:['FB','SAILING DATE'], shipMode:['FC','SHIP MODE'], onTimeLate:['FD','ONTIME OR LATE'],
  ltOrderToPcd:['FE','ORDER CONFIRM TO PCD'], ltPcdToSew:['FF','PCD TO LAST SEWING'], ltPcdToExF:['FG','LT PCD TO READY EX F'], ltPcdToDly:['FH','PCD TO DLY'], ltSewToWash:['FI','LAST SEW TO LAST WASH'], ltWashToExF:['FJ','WASH TO EX F'], ltStitchToExF:['FK','STITCHING TO EX FACTORY'], ltSewToDly:['FL','SEWING TO DLY'],
  sewMonth:['FQ','SEWING MONTH'], sewQuality:['FR','SEWING QUALITY'], washMonth:['FV','MONTH DISPATCH TO FINISHING'], washFirstOut:['FW','MASTER PLAN WASH 1ST OUT'], finPackTrim:['FX','FIN/PACK TRIM MAIN DATE'], washLastOut:['FY','MASTER PLAN WASH LAST OUT'], washQuality:['FZ','WASHING QUALITY'], washLT:['GA','Wash LT'], washDispatch:['GC','WASH DISPATCH'], wipInLR:['GD','WIP IN LR'],
  finMonth:['GH','MONTH FINISHING'], finFirstOut:['GI','MASTER PLAN FINISHING 1ST OUT'], finLastOut:['GJ','MASTER PLAN FINISHING LAST OUT'], finQuality:['GK','FINISHING QUALITY'], finOut:['GL','FINISHING OUT'], wipInFin:['GM','WIP IN FINISHING'], packFirstOut:['GN','MASTER PLAN PACKIGN 1ST OUT'], packLastOut:['GO','MASTER PLAN PACKIG LAST'],
  bChoice:['GP','% BCHOICE'], preFinalInsp:['GQ','PRE-FINAL INSPECTION'], finalInsp:['GR','FINAL INSPECTION'], packedQty:['GS','PACKED QTY'], wipForPacking:['GT','WIP FOR PACKING'], preFinal:['GU','PRE FINAL'], planInspection:['GV','MAST PLAN INSPECTION'], planExFactory:['GW','MASTER PLAN EX FACTORY'],
  whWip:['GX','WH WIP'], shippedQty:['GY','SHIPPED QTY'], wipForShipping:['GZ','WIP FOR SHIPPING'], fob:['HA','FOB VALUE'], dlyMonth:['HD','DLY PREDIC MONTH'], merchConfirm:['HF','MERCHANT CONFIRM'], merchComment:['HG','Merch comment'], dlyRevision:['HH','Delivery revision given to customer'], delMax:['HI','DEL MAX()'],
  xCountry:['HJ','X-CONTRY DATE(Shipping Plan)'], stxFinalDly:['HK','STX FINAL DLY'], finalWeek:['HM','FINALWEEKLY'], shipMonthFinal:['HN','Shipment Month'], packBal:['HQ','PACKING BAL'], cutBal:['HR','CUT BALANCE'], finBal:['HS','FINISHING BAL'], washBal:['HT','WASHING BAL'], sewBal:['HU','SEWING BAL'], shipBal:['HV','SHIP BAL'],
  recipe:['HX','Recipe'], diff:['HY','diff'], dailyTotal:['JE','TTL'],
};
function resolveFields(cols) {
  const F = {};
  const byKey = new Map(); cols.forEach(c => { if (!byKey.has(c.nkey)) byKey.set(c.nkey, c.i); });
  for (const key in FIELD_DEFS) {
    const [letter, name] = FIELD_DEFS[key]; const want = normKey(name);
    const li = colToIdx(letter); const at = cols[li];
    if (at && (at.nkey === want || at.nkey.indexOf(want) >= 0 || want.indexOf(at.nkey) >= 0 && at.nkey.length > 3)) { F[key] = li; continue; }
    if (byKey.has(want)) { F[key] = byKey.get(want); continue; }
    const fuzzy = cols.find(c => c.nkey.indexOf(want) >= 0);
    F[key] = fuzzy ? fuzzy.i : (at ? li : -1);
  }
  return F;
}

// ---------- model ----------
async function loadWorkbook(buffer, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  onProgress('Opening workbook', 0.02);
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheets = []; { const re = /<sheet\b([^>]*?)\/?>/g; let m; while ((m = re.exec(wbXml))) sheets.push({ name: unescapeXml(attr(m[1], 'name') || ''), rid: attr(m[1], 'r:id'), state: attr(m[1], 'state') }); }
  const rels = {}; { const re = /<Relationship\b([^>]*?)\/?>/g; let m; while ((m = re.exec(relsXml))) rels[attr(m[1], 'Id')] = attr(m[1], 'Target'); }
  const sheet = sheets.find(s => /master\s*plan/i.test(s.name)) || sheets.find(s => s.state !== 'hidden') || sheets[0];
  if (!sheet) throw new Error('No worksheet found in this file.');
  let target = rels[sheet.rid] || 'worksheets/sheet1.xml';
  target = target.replace(/^\//, ''); if (!/^xl\//.test(target)) target = 'xl/' + target;
  if (!zip.file(target)) throw new Error('Sheet part not found: ' + target);
  onProgress('Reading shared strings', 0.08);
  const sst = parseSharedStrings(zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : '');
  const dateStyles = parseDateStyles(zip.file('xl/styles.xml') ? await zip.file('xl/styles.xml').async('string') : '');
  onProgress('Inflating sheet', 0.15);
  const xml = await zip.file(target).async('string');
  onProgress('Reading rows', 0.3);
  const g = await parseSheetXml(xml, sst, dateStyles, onProgress);
  onProgress('Building model', 0.92);
  // header row: first row (within 20) whose column A mentions SAITEX PO, else the row with most strings
  let headerRow = 0;
  for (let r = 1; r <= 25 && !headerRow; r++) { const a = g.rows[r]; if (a && typeof a[0] === 'string' && /saitex\s*po/i.test(a[0])) headerRow = r; }
  if (!headerRow) { let best = 0; for (let r = 1; r <= 25; r++) { const a = g.rows[r]; if (!a) continue; const n = a.reduce((k, v) => k + (typeof v === 'string' ? 1 : 0), 0); if (n > best) { best = n; headerRow = r; } } }
  const headers = g.rows[headerRow] || [], owners = g.rows[headerRow - 1] || [];
  const ncols = g.maxCol; const cols = []; const seen = new Map();
  for (let c = 0; c < ncols; c++) {
    let h = headers[c]; if (isDate(h)) h = ymd(h);
    let name = String(h == null ? '' : h).replace(/\s+/g, ' ').trim(); if (!name) name = 'Column ' + idxToCol(c);
    const isDaily = isDate(headers[c]);
    if (seen.has(name)) name = name + ' (' + idxToCol(c) + ')'; seen.set(name, c);
    const owner = typeof owners[c] === 'string' ? owners[c].trim() : '';
    cols.push({ i: c, letter: idxToCol(c), name, nkey: normKey(name), owner, isDaily, dailyDate: isDaily ? headers[c] : null, formulaCount: g.formulaCount[c] || 0, dateStyle: g.colDateStyle[c], type: 'text' });
  }
  const F = resolveFields(cols);
  // orders = rows after header with an identity or a quantity
  const orders = [];
  for (let r = headerRow + 1; r < g.rows.length; r++) {
    const a = g.rows[r]; if (!a) continue;
    const id = a[F.po] != null || a[F.blk] != null || a[F.style] != null || num(a[F.qty]) > 0;
    if (!id) continue;
    const v = new Array(ncols); for (let c = 0; c < ncols; c++) v[c] = a[c] === undefined ? null : a[c];
    const f = new Uint8Array(ncols); const fa = g.frows[r] || []; for (let c = 0; c < ncols; c++) if (fa[c]) f[c] = 1;
    orders.push({ r, v, f, idx: orders.length, dirty: false });
  }
  // column types by majority of non-null values
  for (const col of cols) {
    let d = 0, n = 0, s = 0;
    for (const o of orders) { const v = o.v[col.i]; if (v == null) continue; if (isDate(v)) d++; else if (typeof v === 'number') n++; else s++; }
    const tot = d + n + s; col.nonEmpty = tot;
    col.type = tot === 0 ? (col.dateStyle !== undefined ? 'date' : 'text') : (d >= n && d >= s ? 'date' : (n >= s ? 'number' : 'text'));
    col.mixed = tot > 0 && Math.max(d, n, s) / tot < 0.85;
    col.formula = col.formulaCount >= Math.max(1, orders.length * 0.4);
  }
  const model = { fileName: opts.fileName || 'Production Plan.xlsx', sheetName: sheet.name, sheetPath: target, headerRow, cols, F, orders, ncols, buffer, edits: new Map(), undo: [], redo: [] };
  model.dailyCols = cols.filter(c => c.isDaily).map(c => c.i);
  model.historyCols = cols.filter(c => /^main date/i.test(c.name)).map(c => c.i);
  model.asOf = detectAsOf(model);
  buildLines(model);
  onProgress('Ready', 1);
  return model;
}
function detectAsOf(model) {
  // "as of" = the newest date recorded in strictly-actual columns (things that only get filled in once they happen)
  const F = model.F; const keys = ['fabActIH', 'markerAct', 'shrinkActLR', 'shrinkActLab', 'shrinkActDate', 'bulkPpmAct', 'marker1stAct', 'sew1stAct', 'wash1stAct', 'qa1stAct'];
  const seen = [];
  const cap = Date.UTC(2100, 0, 1), floor = Date.UTC(2000, 0, 1);
  for (const k of keys) { const c = F[k]; if (c < 0) continue; for (const o of model.orders) { const v = o.v[c]; if (isDate(v)) { const t = v.getTime(); if (t > floor && t < cap) seen.push(t); } } }
  if (!seen.length) return startOfDay(new Date());
  seen.sort((a, b) => a - b);
  return startOfDay(new Date(seen[Math.floor(seen.length * 0.999)]));
}
function mode(counter) { let best = null, bn = -1; for (const [k, n] of counter) if (n > bn) { bn = n; best = k; } return best; }
// "A2- Line 02" -> site A2, unit "Line 02".  "STX-TT 1" -> site STX-TT, unit "TT 1".  "STX-VS2" -> site STX-VS, unit "VS2".
function parseLineName(raw) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!name) return { site: '', unit: '', label: '', sort: '' };
  let m = /^([A-Za-z0-9]+)\s*[-–]\s*Line\s*0*(\d+)$/i.exec(name);
  if (m) return { site: m[1].toUpperCase(), unit: 'Line ' + String(m[2]).padStart(2, '0'), label: 'Line ' + String(m[2]).padStart(2, '0'), sort: String(m[2]).padStart(3, '0') };
  m = /^(STX)\s*[-–]\s*([A-Za-z]+)\s*0*(\d+)$/i.exec(name);
  if (m) return { site: 'STX-' + m[2].toUpperCase(), unit: m[2].toUpperCase() + ' ' + m[3], label: m[2].toUpperCase() + ' ' + m[3], sort: String(m[3]).padStart(3, '0') };
  m = /^(STX)\s*[-–]\s*([A-Za-z]+)$/i.exec(name);
  if (m) return { site: 'STX-' + m[2].toUpperCase(), unit: '(unnumbered)', label: '(unnumbered)', sort: 'zzz' };
  m = /^([A-Za-z0-9]+)\s*[-–]\s*(.+)$/.exec(name);
  if (m) return { site: m[1].toUpperCase(), unit: m[2].trim(), label: m[2].trim(), sort: m[2].trim() };
  m = /^(A2)\s+(.+)$/i.exec(name);
  if (m) return { site: 'A2', unit: m[2].trim(), label: m[2].trim(), sort: m[2].trim() };
  return { site: name.toUpperCase(), unit: name, label: name, sort: name };
}
function buildLines(model) {
  const F = model.F; const lines = new Map();
  for (const o of model.orders) {
    const ln = str(o.v[F.line]).trim(); if (!ln) continue;
    let L = lines.get(ln); if (!L) { L = { name: ln, n: 0, qty: 0, targets: new Map(), inout: new Map(), factories: new Map() }; lines.set(ln, L); }
    L.n++; L.qty += num(o.v[F.qty]);
    const t = o.v[F.target]; if (typeof t === 'number' && t > 0) L.targets.set(t, (L.targets.get(t) || 0) + 1);
    const io = str(o.v[F.inout]); if (io) L.inout.set(io, (L.inout.get(io) || 0) + 1);
    const fn = o.v[F.factoryNo]; if (fn != null) L.factories.set(String(fn), (L.factories.get(String(fn)) || 0) + 1);
  }
  const arr = [...lines.values()].map(L => { const p = parseLineName(L.name); return { name: L.name, site: p.site, unit: p.unit, label: p.label, sort: p.sort, n: L.n, qty: L.qty, target: mode(L.targets) || 0, inout: mode(L.inout) || (/^A2/i.test(L.name) ? 'Inside' : 'Outside'), factory: mode(L.factories) || '' }; });
  arr.sort((a, b) => (a.inout === b.inout ? 0 : a.inout === 'Inside' ? -1 : 1) || a.site.localeCompare(b.site) || a.sort.localeCompare(b.sort, undefined, { numeric: true }));
  model.lines = arr; model.lineMap = new Map(arr.map(l => [l.name, l]));
  const sites = new Map();
  for (const l of arr) { let S = sites.get(l.site); if (!S) { S = { site: l.site, inout: l.inout, lines: [], n: 0, qty: 0, capacity: 0 }; sites.set(l.site, S); } S.lines.push(l); S.n += l.n; S.qty += l.qty; S.capacity += l.target; }
  model.sites = [...sites.values()];
  model.ldLines = distinctOf(model, F.ldLine); model.finLines = distinctOf(model, F.finLine);
}
function distinctOf(model, c) { const m = new Map(); if (c < 0) return []; for (const o of model.orders) { const v = str(o.v[c]).trim(); if (!v || /^#/.test(v)) continue; m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([name, n]) => ({ name, n })); }

// ---------- derivation (mirrors the sheet's formula chain; only touches cells that are formulas in the sheet) ----------
function recompute(model, o) {
  const F = model.F, v = o.v, f = o.f;
  const g = k => (F[k] >= 0 ? v[F[k]] : null);
  const set = (k, val) => { const c = F[k]; if (c >= 0 && f[c]) v[c] = val; };
  const sew1 = g('sew1'), sew2 = g('sew2');
  set('pcd', plusSkip(sew1, -12)); set('inputDate', plusSkip(sew1, -4)); set('washFirstOut', plusSkip(sew1, 3));
  const pcd = g('pcd');
  set('markerRelease', plusSkip(pcd, -7)); set('fabReqIH', plusSkip(pcd, -10));
  const otd = g('otd'); set('pcdBook', isDate(pcd) ? (typeof otd === 'number' && otd < 0 ? addDays(pcd, otd) : addDays(pcd, -10)) : null);
  set('laundryWip', plusSkip(sew2, 7)); set('washLastOut', plusSkip(sew2, 15));
  set('lrCompletion', plusSkip(g('laundryWip'), 5)); set('finWip', plusSkip(g('lrCompletion'), 3)); set('finCompletion', plusSkip(g('finWip'), 2)); set('packWip', plusSkip(g('finCompletion'), 3));
  set('finFirstOut', plusSkip(g('washFirstOut'), 3)); set('finLastOut', plusSkip(g('washLastOut'), 3));
  set('packFirstOut', plusSkip(g('finFirstOut'), 1)); set('packLastOut', plusSkip(g('finLastOut'), 2));
  set('planInspection', plusSkip(g('packLastOut'), 1)); const insp = g('planInspection');
  set('preFinal', isDate(insp) ? addDays(insp, -2) : null); set('planExFactory', plusSkip(insp, 1));
  const qty = num(g('qty')), tgt = num(g('target'));
  if (tgt > 0) { const d = qty / tgt; set('days', d); set('sundays', d / 7); set('adjDays', d + d / 7); }
  set('yds', qty * num(g('consumption')) || null);
  const cut = num(g('cutQty')), inp = num(g('inputQty')), out = num(g('output')), disp = num(g('dispatched')), washOut = num(g('washOutput')), finOut = num(g('finOut')), packed = num(g('packedQty')), shipped = num(g('shippedQty')), washDisp = num(g('washDispatch'));
  set('wipInput', cut - inp); set('wipSewing', inp - out); set('wipDispatch', out - disp); set('wipForSewing', out > qty ? 0 : qty - out); set('wipToDispatch', (qty - disp) <= 1 ? 0 : qty - disp);
  set('wipInLR', disp - washDisp); set('wipInFin', qty - finOut); set('wipForPacking', qty - packed); set('whWip', packed - shipped); set('wipForShipping', shipped > qty ? 0 : qty - shipped);
  set('packBal', packed > qty ? 0 : qty - packed); set('cutBal', cut > qty ? 0 : qty - cut); set('finBal', finOut > qty ? 0 : qty - finOut); set('washBal', washOut > qty ? 0 : qty - washOut); set('sewBal', out > qty ? 0 : qty - out);
  set('shipBal', String(otd).toLowerCase() === 'shipped' ? 0 : (shipped > qty ? 0 : qty - shipped));
  set('sewMonth', mmmyy(sew2)); set('washMonth', mmmyy(g('washLastOut'))); set('finMonth', mmmyy(g('finLastOut'))); set('dlyMonth', mmmyy(g('planExFactory'))); set('shipMonth', mmmyy(g('sysDelivery')));
  set('ldrLine', g('ldLine')); set('ppcMax', g('ppcd')); set('planMk', g('markerAct'));
  const ey = g('inspectionConfirm'); set('exFactory', ey); set('saitexDelivery', ey);
  set('delMax', g('dlyRevision')); const hj = g('xCountry'); set('stxFinalDly', isDate(hj) ? hj : g('delMax')); set('cusFinalDly', g('stxFinalDly'));
  const V = g('cusFinalDly'), EZ = g('exFactory'); set('onTimeLate', isDate(V) && isDate(EZ) ? (dayKey(V) - dayKey(EZ)) : null);
  const T = g('sysDelivery'), CV = g('ppcMax'); set('ppcdToDly', isDate(T) && isDate(CV) ? dayKey(T) - dayKey(CV) : null);
  const DM = g('pcd'), AD = g('moCreate'); set('ltOrderToPcd', isDate(DM) && isDate(AD) ? dayKey(DM) - dayKey(AD) : null);
  set('ltPcdToSew', isDate(sew2) && isDate(DM) ? dayKey(sew2) - dayKey(DM) : null); set('ltPcdToDly', isDate(T) && isDate(DM) ? dayKey(T) - dayKey(DM) : null);
  set('ltSewToWash', isDate(g('lrCompletion')) && isDate(sew2) ? dayKey(g('lrCompletion')) - dayKey(sew2) : null); set('ltSewToDly', isDate(T) && isDate(sew2) ? dayKey(T) - dayKey(sew2) : null);
  set('ltPcdToExF', isDate(EZ) && isDate(DM) ? dayKey(EZ) - dayKey(DM) : null); set('ltStitchToExF', isDate(EZ) && isDate(sew2) ? dayKey(EZ) - dayKey(sew2) : null);
  set('markerDiff', isDate(g('markerRelease')) && isDate(g('planMk')) ? dayKey(g('markerRelease')) - dayKey(g('planMk')) : null);
  set('ltWashToExF', isDate(g('saitexDelivery')) && isDate(g('lrCompletion')) ? dayKey(g('saitexDelivery')) - dayKey(g('lrCompletion')) : null);
  set('washLT', null);
  if (F.dailyTotal >= 0 && f[F.dailyTotal]) { let s = 0; for (const c of model.dailyCols) s += num(v[c]); v[F.dailyTotal] = s; }
  set('diff', qty - disp - num(g('dailyTotal')));
}

// ---------- edits / undo / persistence ----------
function sameVal(a, b) { if (a == null && b == null) return true; if (isDate(a) && isDate(b)) return a.getTime() === b.getTime(); return a === b; }
// One user action (a drag, a re-fit) can touch several cells; they share a group id so
// a single undo reverses the whole action.
let GROUP = 0, groupDepth = 0;
function beginGroup(model) { if (groupDepth++ === 0) GROUP++; return GROUP; }
function endGroup() { if (groupDepth > 0) groupDepth--; }
function setCell(model, o, c, value, opts = {}) {
  const old = o.v[c]; if (sameVal(old, value)) return false;
  const key = o.r + ':' + c;
  const wasFormula = o.f[c];
  if (!model.edits.has(key)) model.edits.set(key, { r: o.r, c, orig: old, origFormula: wasFormula });
  const e = model.edits.get(key); e.value = value;
  if (sameVal(e.orig, value) && !e.origFormula) model.edits.delete(key);
  o.v[c] = value; o.f[c] = 0; o.dirty = true;
  if (!opts.silent) {
    model.undo.push({ r: o.r, c, before: old, after: value, beforeFormula: wasFormula, g: groupDepth > 0 ? GROUP : ++GROUP });
    if (model.undo.length > 800) model.undo.shift();
    model.redo.length = 0;
  }
  recompute(model, o);
  return true;
}
function undoOne(model, u) {
  const o = orderByRow(model, u.r); if (!o) return;
  const key = u.r + ':' + u.c;
  o.v[u.c] = u.before; o.f[u.c] = u.beforeFormula;
  const e = model.edits.get(key);
  if (e) { if (sameVal(e.orig, u.before) && e.origFormula === u.beforeFormula) model.edits.delete(key); else e.value = u.before; }
  recompute(model, o);
}
function undo(model) {
  const top = model.undo[model.undo.length - 1]; if (!top) return null;
  const batch = [];
  while (model.undo.length && model.undo[model.undo.length - 1].g === top.g) batch.push(model.undo.pop());
  for (const u of batch) undoOne(model, u);
  model.redo.push(batch.reverse());
  return top;
}
function redo(model) {
  const batch = model.redo.pop(); if (!batch) return null;
  for (const u of batch) { const o = orderByRow(model, u.r); if (o) setCell(model, o, u.c, u.after, { silent: true }); }
  model.undo.push(...batch);
  return batch[batch.length - 1];
}
function orderByRow(model, r) { if (!model._byRow) { model._byRow = new Map(model.orders.map(o => [o.r, o])); } return model._byRow.get(r); }
function serializeValue(v) { return isDate(v) ? { d: v.toISOString() } : v; }
function deserializeValue(v) { return v && typeof v === 'object' && v.d ? new Date(v.d) : v; }
function exportEdits(model) { return [...model.edits.values()].map(e => ({ r: e.r, c: e.c, letter: idxToCol(e.c), col: model.cols[e.c].name, value: serializeValue(e.value), orig: serializeValue(e.orig) })); }
function importEdits(model, list) { let n = 0; for (const e of list || []) { const o = orderByRow(model, e.r); if (!o || e.c == null || e.c >= model.ncols) continue; if (setCell(model, o, e.c, deserializeValue(e.value), { silent: true })) n++; } return n; }

// ---------- stage engine ----------
const STAGES = [
  { key: 'cut',  name: 'Cutting',    short: 'Cut',   start: 'pcd',          end: 'inputDate',     resource: 'site',      done: 'cutQty',     actual: 'markerAct' },
  { key: 'sew',  name: 'Sewing',     short: 'Sew',   start: 'sew1',         end: 'sew2',          resource: 'line',      done: 'output',     actual: 'factoryConfirm' },
  { key: 'wash', name: 'Washing',    short: 'Wash',  start: 'washFirstOut', end: 'washLastOut',   resource: 'ldLine',    done: 'washOutput', actual: 'lrConfirm' },
  { key: 'fin',  name: 'Finishing',  short: 'Fin',   start: 'finFirstOut',  end: 'finLastOut',    resource: 'finLine',   done: 'finOut',     actual: 'finConfirm' },
  { key: 'pack', name: 'Packing',    short: 'Pack',  start: 'packFirstOut', end: 'packLastOut',   resource: 'finLine',   done: 'packedQty',  actual: 'packConfirm' },
  { key: 'ship', name: 'Inspection & ex-factory', short: 'Ship', start: 'preFinal', end: 'planExFactory', resource: 'site',      done: 'shippedQty', actual: 'exFactory' },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
function stageWindow(model, o, stage) {
  const F = model.F; let s = o.v[F[stage.start]], e = o.v[F[stage.end]];
  if (!isDate(s) || !isDate(e)) return null;
  if (s.getUTCFullYear() < 2000 || e.getUTCFullYear() < 2000) return null;
  let a = dayKey(s), b = dayKey(e); if (b < a) b = a; if (b - a > 400) return null;
  return [a, b];
}
// No laundry line is allocated when the style is not washed. The wash recipe (HX)
// is the ground truth: an empty recipe means no wash at all.
function isNonWash(model, o) {
  const F = model.F;
  const recipe = str(o.v[F.recipe]).trim();
  if (F.recipe >= 0 && (!recipe || /non\s*wash/i.test(recipe))) return true;
  if (str(o.v[F.ldLine]).toLowerCase().indexOf('non') >= 0) return true;
  if (str(o.v[F.ldrLine]).toLowerCase().indexOf('non') >= 0) return true;
  if (/non\s*wash/i.test(str(o.v[F.wash]))) return true;
  if (/non\s*wash/i.test(str(o.v[F.washAppStatus]))) return true;
  return false;
}
// The sheet only writes "shipped" into OTD sometimes. An order is finished once it is
// fully packed, once OTD says shipped or ready, or once ex-factory is already in the past.
function productionComplete(model, o) {
  const F = model.F, qty = num(o.v[F.qty]);
  if (qty > 0 && num(o.v[F.packedQty]) >= qty) return true;
  if (/^(shipped|ready)$/i.test(str(o.v[F.otd]).trim())) return true;
  const ex = o.v[F.exFactory];
  return isDate(ex) && ex.getUTCFullYear() > 2000 && dayKey(ex) <= dayKey(model.asOf);
}
function orderProgress(model, o) {
  const F = model.F, qty = num(o.v[F.qty]);
  const done = STAGES.map(s => num(o.v[F[s.done]]));
  const shipped = productionComplete(model, o) || (qty > 0 && done[5] >= qty);
  let stage = -1; // -1 = not started, 6 = shipped
  if (shipped) stage = 6;
  else {
    // furthest stage with any quantity; if that stage is complete, the next one is "current"
    let furthest = -1; for (let i = 0; i < STAGES.length; i++) if (done[i] > 0) furthest = i;
    if (furthest < 0) stage = -1;
    else if (qty > 0 && done[furthest] >= qty && furthest < 5) { stage = furthest + 1; if (stage === 2 && isNonWash(model, o)) stage = 3; }
    else stage = furthest;
  }
  return { qty, done, stage, shipped, remaining: STAGES.map((s, i) => Math.max(0, qty - done[i])) };
}
const STAGE_NAMES = ['Not started', ...STAGES.map(s => s.name), 'Shipped'];
function stageLabel(i) { return STAGE_NAMES[i + 1]; }
function resourceOf(model, o, stage) {
  if (stage.resource === 'site') { const L = model.lineMap.get(str(o.v[model.F.line]).trim()); return L ? L.site : (parseLineName(o.v[model.F.line]).site || ''); }
  const c = model.F[stage.resource]; const v = c >= 0 ? o.v[c] : null; const s = str(v).trim(); return s && !/^#/.test(s) ? s : '';
}
function workdayCount(a, b) { let n = 0; for (let k = a; k <= b; k++) if (keyToDate(k).getUTCDay() !== 0) n++; return n; }
// Distribute an order's stage quantity over its window. mode: 'planned' (full qty over full window) | 'remaining' (remaining qty from max(asOf,start) to end; overdue lands on asOf)
function spreadLoad(model, o, stage, mode, asOfKey, out /* Map res→Map dayKey→pcs */, meta) {
  const w = stageWindow(model, o, stage); if (!w) return false;
  const prog = orderProgress(model, o); const si = STAGE_INDEX[stage.key];
  if (stage.key === 'wash' && isNonWash(model, o)) return false;
  let qty = prog.qty; let [a, b] = w;
  if (mode === 'remaining') { qty = prog.remaining[si]; if (prog.shipped || qty <= 0) return false; if (a < asOfKey) a = asOfKey; if (b < a) b = a; }
  if (qty <= 0) return false;
  const res = resourceOf(model, o, stage) || '(unassigned)';
  let m = out.get(res); if (!m) { m = new Map(); out.set(res, m); }
  const nd = workdayCount(a, b) || 1; const per = qty / nd;
  for (let k = a; k <= b; k++) { if (nd > 1 && keyToDate(k).getUTCDay() === 0 && workdayCount(a, b) > 0) continue; m.set(k, (m.get(k) || 0) + per); }
  if (meta) { let mm = meta.get(res); if (!mm) { mm = new Map(); meta.set(res, mm); } for (let k = a; k <= b; k++) { let arr = mm.get(k); if (!arr) { arr = []; mm.set(k, arr); } arr.push(o.idx); } }
  return true;
}
function capacityOf(model, stage, res, caps) {
  const ov = caps && caps[stage.key] && caps[stage.key][res]; if (typeof ov === 'number' && ov > 0) return ov;
  if (stage.key === 'sew') { const L = model.lineMap.get(res); return L && L.target ? L.target : 0; }
  return 0;
}
// percentile helper for auto-capacity of laundry/finishing lines
function autoCapacity(loadMap, p = 0.8) { const vals = [...loadMap.values()].filter(x => x > 0).sort((a, b) => a - b); if (!vals.length) return 0; return Math.round(vals[Math.min(vals.length - 1, Math.floor(vals.length * p))]); }

// ---------- filtering ----------
function textOf(model, o) { if (o._text === undefined || o.dirty) { const F = model.F; const parts = []; for (const k of ['po', 'blk', 'oldBlk', 'style', 'desc', 'customer', 'custPo', 'fabric', 'wash', 'line', 'season', 'mill', 'remark', 'delayReason', 'preStatus', 'merchComment']) { const c = F[k]; if (c >= 0 && o.v[c] != null) parts.push(str(o.v[c]).toLowerCase()); } o._text = parts.join(' | '); } return o._text; }
function cellString(v) { return v == null ? '' : isDate(v) ? ymd(v) : String(v); }
function matchesCustom(model, o, cf) {
  const v = o.v[cf.col]; const col = model.cols[cf.col];
  switch (cf.op) {
    case 'empty': return v == null; case 'notEmpty': return v != null;
    case 'contains': return cellString(v).toLowerCase().indexOf(String(cf.value).toLowerCase()) >= 0;
    case 'notContains': return cellString(v).toLowerCase().indexOf(String(cf.value).toLowerCase()) < 0;
    case 'eq': return isDate(v) ? ymd(v) === String(cf.value) : cellString(v).toLowerCase() === String(cf.value).toLowerCase();
    case 'gt': case 'lt': case 'gte': case 'lte': {
      let a, b; if (isDate(v)) { a = dayKey(v); const d = parseYmd(cf.value); if (!d) return false; b = dayKey(d); } else if (typeof v === 'number') { a = v; b = Number(cf.value); if (isNaN(b)) return false; } else return false;
      return cf.op === 'gt' ? a > b : cf.op === 'lt' ? a < b : cf.op === 'gte' ? a >= b : a <= b;
    }
    case 'between': { let a, lo, hi; if (isDate(v)) { a = dayKey(v); const d1 = parseYmd(cf.value), d2 = parseYmd(cf.value2); if (!d1 || !d2) return false; lo = dayKey(d1); hi = dayKey(d2); } else if (typeof v === 'number') { a = v; lo = Number(cf.value); hi = Number(cf.value2); } else return false; return a >= lo && a <= hi; }
    default: return true;
  }
}
// facets: {key: Set of string values}; ranges: {fieldKey:[fromYmd,toYmd]}; quick: {late:true,...}
function buildPredicate(model, fs, skipFacet) {
  const F = model.F; const tokens = (fs.search || '').toLowerCase().split(/\s+/).filter(Boolean);
  const facetKeys = Object.keys(fs.facets || {}).filter(k => k !== skipFacet && fs.facets[k] && fs.facets[k].size);
  const rangeKeys = Object.keys(fs.ranges || {}).filter(k => fs.ranges[k] && (fs.ranges[k][0] || fs.ranges[k][1]));
  const custom = (fs.custom || []).filter(c => c && c.col >= 0);
  const quick = fs.quick || {};
  return function (o) {
    if (tokens.length) { const t = textOf(model, o); for (const tok of tokens) if (t.indexOf(tok) < 0) return false; }
    for (const k of facetKeys) { const val = facetValue(model, o, k); if (!fs.facets[k].has(val)) return false; }
    for (const k of rangeKeys) { const c = F[k]; if (c < 0) continue; const v = o.v[c]; const [from, to] = fs.ranges[k]; if (!isDate(v)) return false; const dk = dayKey(v); if (from && dk < dayKey(parseYmd(from))) return false; if (to && dk > dayKey(parseYmd(to))) return false; }
    for (const cf of custom) if (!matchesCustom(model, o, cf)) return false;
    for (const k in quick) {
      const test = QUICK_TESTS[k];
      if (quick[k] && test && !test(model, o)) return false;   // "stashed" has no test here; the interface holds that list
    }
    return true;
  };
}
// One definition per quick filter, so the interface can both apply and count them.
const QUICK_TESTS = {
  late: (m, o) => isLate(m, o),
  wip: (m, o) => { const st = orderProgress(m, o).stage; return st >= 0 && st <= 5; },
  unassigned: (m, o) => !str(o.v[m.F.line]).trim(),
  fabricPending: (m, o) => !isDate(o.v[m.F.fabActIH]),
  approvalPending: (m, o) => approvalPending(m, o),
  unconfirmed: (m, o) => /un[\s-]?confirmed/i.test(str(o.v[m.F.status])),
  dirty: (m, o) => !!o.dirty,
};
// What still has to land before this order can start. A blank cell is not a blocker:
// the planners leave columns empty for order types the gate does not apply to.
const TRIM_KEYS = ['pocketing', 'interlining', 'thread', 'zipper', 'label', 'hookBar'];
function trimsPending(model, o) {
  const F = model.F, asOf = dayKey(model.asOf);
  return TRIM_KEYS.some(k => {
    const c = F[k]; if (c < 0) return false;
    const v = o.v[c]; if (v == null) return false;
    if (isDate(v)) return dayKey(v) > asOf;                 // booked to arrive later
    const t = str(v).trim();
    if (/^(IH|N\/A|na|stock|AW)$/i.test(t)) return false;    // in house, or not needed
    return /TBC|NY UPDATE|LATE|PENDING|NOT/i.test(t);
  });
}
function openGates(model, o) {
  const F = model.F, out = [];
  if (!isDate(o.v[F.fabActIH])) out.push('fabric');
  if (approvalPending(model, o)) out.push('approval');
  if (trimsPending(model, o)) out.push('trims');
  const shrink = str(o.v[F.shrinkStatus]).trim();
  const shrinkDup = /^wt fab$/i.test(shrink) && out.indexOf('fabric') >= 0;   // same fact, already listed
  if (!/^(done|na)$/i.test(shrink) && !shrinkDup) out.push('shrinkage');
  return out;
}
const READY_WINDOW_DAYS = 14;
// running = a process has produced pieces, or the marker is already cut
// ready   = nothing produced, nothing holding it up, and sewing starts within the window
// clear   = nothing holding it up but the start is still far off
// waiting = at least one gate is open
// done    = production finished
function runState(model, o) {
  const F = model.F, p = orderProgress(model, o);
  if (p.shipped) return 'done';
  if (p.done.some(d => d > 0)) return 'running';
  const mk = o.v[F.markerAct];
  if (isDate(mk) && mk.getUTCFullYear() > 2000 && dayKey(mk) <= dayKey(model.asOf)) return 'running';
  if (openGates(model, o).length) return 'waiting';
  const s1 = o.v[F.sew1];
  const lead = isDate(s1) ? dayKey(s1) - dayKey(model.asOf) : 9999;
  return lead <= READY_WINDOW_DAYS ? 'ready' : 'clear';
}
function leadDays(model, o) { const s1 = o.v[model.F.sew1]; return isDate(s1) ? dayKey(s1) - dayKey(model.asOf) : null; }
const APPROVAL_CLEAR = /^(approved|repeat|not\s*req(uired|'?d)?|non\s*wash|n\/?a)$/i;
function approvalPending(model, o) {
  const F = model.F;
  return ['fitStatus', 'ppStatus', 'washAppStatus'].some(k => {
    const v = str(o.v[F[k]]).trim();
    return v !== '' && !APPROVAL_CLEAR.test(v);   // blank = the column does not apply, not a blocker
  });
}
// OTD (column Y) is on-time delivery in days: a negative number means the order is late.
function otdDays(model, o) { const v = o.v[model.F.otd]; return typeof v === 'number' && isFinite(v) && Math.abs(v) < 400 ? v : null; }
function isLate(model, o) {
  const F = model.F; const prog = orderProgress(model, o);
  const otd = otdDays(model, o);
  if (prog.shipped) return otd != null && otd < 0;
  if (otd != null && otd < 0) return true;
  const dly = o.v[F.cusFinalDly]; const ex = o.v[F.planExFactory]; const asOf = model.asOf;
  if (isDate(dly) && dly.getUTCFullYear() > 2000) { if (dayKey(dly) < dayKey(asOf)) return true; if (isDate(ex) && ex.getUTCFullYear() > 2000 && dayKey(ex) > dayKey(dly)) return true; }
  return false;
}
// Why an order is late, in the order a planner would ask: how far past the promise,
// what the sheet's own delay note says, and what is still holding it up.
function lateReasons(model, o) {
  const F = model.F, out = [], asOf = dayKey(model.asOf);
  const ex = o.v[F.planExFactory], dly = o.v[F.cusFinalDly];
  if (isDate(ex) && isDate(dly) && ex.getUTCFullYear() > 2000 && dly.getUTCFullYear() > 2000 && dayKey(ex) > dayKey(dly))
    out.push(`ex-factory ${dayKey(ex) - dayKey(dly)} d after the ${fmtDate(dly)} delivery`);
  const otd = otdDays(model, o);
  if (otd != null && otd < 0) out.push(`on-time delivery ${Math.round(otd)} d`);
  if (isDate(dly) && dly.getUTCFullYear() > 2000 && dayKey(dly) < asOf && !orderProgress(model, o).shipped)
    out.push(`delivery ${fmtDate(dly)} already passed`);
  const gates = openGates(model, o);
  if (gates.length) out.push('waiting on ' + gates.join(', '));
  const note = str(o.v[F.delayReason]).trim();
  if (note) out.push('note: ' + note);
  const merch = str(o.v[F.merchComment]).trim();
  if (merch) out.push('merch: ' + merch);
  return out;
}
function facetValue(model, o, k) {
  const F = model.F;
  switch (k) {
    case 'stage': return stageLabel(orderProgress(model, o).stage);
    case 'late': return isLate(model, o) ? 'Late / at risk' : 'On plan';
    case 'sewMonthKey': return monthKey(o.v[F.sew2]) || '(none)';
    case 'dlyMonthKey': return monthKey(o.v[F.cusFinalDly]) || '(none)';
    case 'pcdMonthKey': return monthKey(o.v[F.pcd]) || '(none)';
    case 'site': { const L = model.lineMap.get(str(o.v[F.line]).trim()); return L ? L.site : (parseLineName(o.v[F.line]).site || '(none)'); }
    case 'lineUnit': { const L = model.lineMap.get(str(o.v[F.line]).trim()); return L ? L.label : '(none)'; }
    default: { const c = F[k]; if (c < 0) return '(none)'; const v = o.v[c]; if (v == null) return '(none)'; if (isDate(v)) return ymd(v); const s = String(v).trim(); return s === '' || /^#/.test(s) ? '(none)' : s; }
  }
}
function facetCounts(model, orders, fs, key) { const pred = buildPredicate(model, fs, key); const m = new Map(); for (const o of orders) { if (!pred(o)) continue; const v = facetValue(model, o, key); m.set(v, (m.get(v) || 0) + 1); } return m; }
function applyFilter(model, fs) { const pred = buildPredicate(model, fs, null); return model.orders.filter(pred); }

// ---------- Excel write-back ----------
function shiftFormula(text, dr, dc) {
  // shift relative refs; leave quoted strings alone
  const parts = text.split('"'); // even indexes = code, odd = string literal
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (m, ac, col, ar, row, off, s) => {
      const prev = off > 0 ? s[off - 1] : ''; if (/[A-Za-z0-9_.]/.test(prev)) return m; // part of a name
      let ci = colToIdx(col), ri = +row; if (!ac) ci += dc; if (!ar) ri += dr; if (ci < 0 || ri < 1) return m;
      return ac + idxToCol(ci) + ar + ri;
    });
  }
  return parts.join('"');
}
function cellXml(ref, s, value, dateStyleForCol) {
  const sv = s != null ? ' s="' + s + '"' : '';
  if (value == null) return '<c r="' + ref + '"' + sv + '/>';
  if (typeof value === 'boolean') return '<c r="' + ref + '"' + sv + ' t="b"><v>' + (value ? 1 : 0) + '</v></c>';
  if (isDate(value)) { const st = dateStyleForCol != null ? ' s="' + dateStyleForCol + '"' : sv; return '<c r="' + ref + '"' + st + '><v>' + dateToSerial(value) + '</v></c>'; }
  if (typeof value === 'number') return '<c r="' + ref + '"' + sv + '><v>' + value + '</v></c>';
  return '<c r="' + ref + '"' + sv + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(String(value)) + '</t></is></c>';
}
async function buildEditedWorkbook(model, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const edits = [...model.edits.values()].filter(e => !(sameVal(e.orig, e.value) && !e.origFormula) || true);
  onProgress('Opening original workbook', 0.05);
  const zip = await JSZip.loadAsync(model.buffer);
  let xml = await zip.file(model.sheetPath).async('string');
  onProgress('Locating rows', 0.2);
  // row index
  const rowPos = new Map(); { const re = /<row r="(\d+)"/g; let m; while ((m = re.exec(xml))) rowPos.set(+m[1], m.index); }
  const sdEnd = xml.indexOf('</sheetData>');
  const rowSpan = r => { const s = rowPos.get(r); if (s == null) return null; let e = xml.indexOf('</row>', s); const selfEnd = xml.indexOf('>', s); if (xml[selfEnd - 1] === '/') e = selfEnd + 1; else e = e + 6; return [s, e]; };
  const editedKeys = new Set(edits.map(e => e.r + ':' + e.c));
  // ops: Map row → Map col → newCellXml
  const ops = new Map(); const addOp = (r, c, cx) => { let m = ops.get(r); if (!m) { m = new Map(); ops.set(r, m); } m.set(c, cx); };
  const cellRegex = (ref) => new RegExp('<c r="' + ref + '"(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</c>)');
  const findCell = (r, c) => { const sp = rowSpan(r); if (!sp) return null; const seg = xml.slice(sp[0], sp[1]); const m = cellRegex(idxToCol(c) + r).exec(seg); return m ? m[0] : null; };
  const rehome = []; // shared formula masters that need a new home
  let i = 0;
  for (const e of edits) {
    const ref = idxToCol(e.c) + e.r; const old = findCell(e.r, e.c);
    let s = null; if (old) { const sm = /\bs="(\d+)"/.exec(old); if (sm) s = +sm[1]; }
    if (s == null) { // borrow style from a neighbour row in the same column
      for (const dr of [-1, 1, -2, 2, -3, 3]) { const nb = findCell(e.r + dr, e.c); if (nb) { const sm = /\bs="(\d+)"/.exec(nb); if (sm) { s = +sm[1]; break; } } }
    }
    const col = model.cols[e.c]; const dateStyle = col && col.dateStyle != null ? col.dateStyle : null;
    addOp(e.r, e.c, cellXml(ref, s, e.value, isDate(e.value) ? (dateStyle != null ? dateStyle : s) : null));
    if (old) { const fm = /<f\b([^>]*)>([\s\S]*?)<\/f>/.exec(old); if (fm && /t="shared"/.test(fm[1]) && /\bref="/.test(fm[1])) rehome.push({ r: e.r, c: e.c, attrs: fm[1], text: unescapeXml(fm[2]) }); }
    if ((++i & 63) === 0) { onProgress('Applying edits', 0.2 + 0.4 * i / edits.length); await yieldToUI(); }
  }
  // re-home shared formula masters: the next dependent cell in the ref range becomes the master
  for (const rh of rehome) {
    const si = attr(rh.attrs, 'si'); const ref = attr(rh.attrs, 'ref'); const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref); if (!mm) continue;
    const c1 = colToIdx(mm[1]), r1 = +mm[2], c2 = colToIdx(mm[3]), r2 = +mm[4];
    let found = null;
    outer: for (let r = r1; r <= r2 && !found; r++) for (let c = c1; c <= c2; c++) {
      if (r === rh.r && c === rh.c) continue; if (editedKeys.has(r + ':' + c)) continue;
      const cell = findCell(r, c); if (!cell) continue;
      const fm = /<f\b([^>]*?)\/>/.exec(cell); if (fm && attr(fm[1], 'si') === si && /t="shared"/.test(fm[1])) { found = { r, c, cell }; break outer; }
    }
    if (!found) continue;
    const newRef = idxToCol(found.c) + found.r + ':' + mm[3] + mm[4];
    const shifted = shiftFormula(rh.text, found.r - rh.r, found.c - rh.c);
    const newCell = found.cell.replace(/<f\b[^>]*?\/>/, '<f t="shared" ref="' + newRef + '" si="' + si + '">' + escapeXml(shifted) + '</f>');
    addOp(found.r, found.c, newCell);
  }
  onProgress('Writing sheet', 0.65);
  // rebuild xml: process rows in ascending order
  const rowsToPatch = [...ops.keys()].sort((a, b) => a - b);
  const out = []; let cursor = 0;
  for (const r of rowsToPatch) {
    const sp = rowSpan(r); const cmap = ops.get(r);
    if (!sp) { // row missing entirely → insert before the next row or before </sheetData>
      let insertAt = sdEnd; for (const [rr, p] of rowPos) if (rr > r && p < insertAt) insertAt = p;
      const cells = [...cmap.keys()].sort((a, b) => a - b).map(c => cmap.get(c)).join('');
      out.push(xml.slice(cursor, insertAt)); out.push('<row r="' + r + '">' + cells + '</row>'); cursor = insertAt; continue;
    }
    let seg = xml.slice(sp[0], sp[1]);
    const missing = [];
    for (const [c, cx] of cmap) {
      const re = cellRegex(idxToCol(c) + r);
      if (re.test(seg)) seg = seg.replace(re, () => cx); else missing.push(c);
    }
    if (missing.length) { // insert cells at the right column position
      for (const c of missing.sort((a, b) => a - b)) {
        const cx = cmap.get(c); let inserted = false;
        const cr = /<c r="([A-Z]+)(\d+)"/g; let m; let lastIdx = -1;
        while ((m = cr.exec(seg))) { if (colToIdx(m[1]) > c) { seg = seg.slice(0, m.index) + cx + seg.slice(m.index); inserted = true; break; } lastIdx = m.index; }
        if (!inserted) { if (/\/>$/.test(seg.trim()) && seg.indexOf('</row>') < 0) { seg = seg.replace(/\/>\s*$/, '>' + cx + '</row>'); } else seg = seg.replace(/<\/row>\s*$/, cx + '</row>'); }
      }
    }
    out.push(xml.slice(cursor, sp[0])); out.push(seg); cursor = sp[1];
  }
  out.push(xml.slice(cursor)); xml = out.join('');
  zip.file(model.sheetPath, xml);
  onProgress('Updating workbook settings', 0.85);
  let wb = await zip.file('xl/workbook.xml').async('string');
  if (/<calcPr\b[^>]*fullCalcOnLoad=/.test(wb)) wb = wb.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"');
  else if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
  else wb = wb.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
  zip.file('xl/workbook.xml', wb);
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const ct = await zip.file('[Content_Types].xml').async('string'); zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/g, ''));
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string'); zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/g, ''));
  }
  onProgress('Compressing', 0.9);
  const blob = await zip.generateAsync({ type: typeof Blob !== 'undefined' ? 'blob' : 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, meta => onProgress('Compressing', 0.9 + 0.1 * meta.percent / 100));
  onProgress('Done', 1);
  return blob;
}

return { loadWorkbook, recompute, setCell, undo, redo, beginGroup, endGroup, orderByRow, exportEdits, importEdits, buildEditedWorkbook, shiftFormula, parseLineName, buildLines,
  STAGES, STAGE_INDEX, STAGE_NAMES, stageLabel, stageWindow, orderProgress, resourceOf, spreadLoad, capacityOf, autoCapacity, workdayCount, isNonWash, isLate, approvalPending,
  buildPredicate, applyFilter, facetCounts, facetValue, textOf, FIELD_DEFS, otdDays, openGates, runState, lateReasons, QUICK_TESTS, trimsPending, productionComplete, leadDays, READY_WINDOW_DAYS,
  util: { serialToDate, dateToSerial, isDate, dayKey, keyToDate, addDays, startOfDay, isSunday, skipSunday, plusSkip, num, str, ymd, fmtDate, fmtDateShort, parseYmd, monthKey, weekKey, mmmyy, colToIdx, idxToCol, normKey, MON } };
});
