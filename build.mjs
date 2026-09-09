// Bundle src/ into a single self-contained HTML file. No dependencies, node only,
// so the same command works locally and on a deploy runner.
//
//   public/index.html  always built, never contains order data, opens on the file picker.
//   app.demo.html      only when sample.json exists. It embeds real orders, so it is gitignored.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');

const shell = read('src/shell.html');
const core = read('src/core.js');
const ui = read('src/ui.js');
for (const [name, body] of [['core.js', core], ['ui.js', ui]]) {
  if (body.includes('</script')) throw new Error(name + ' would close the script tag early');
}

// Replacer functions, not strings: the sources contain "$&" (a regex escape in
// core.js) and String.replace would expand that into the matched text, quietly
// corrupting the bundle it just built.
const bundle = sample =>
  shell
    .replace('<script>/*CORE*/</script>', () => '<script>\n' + core + '\n</script>')
    .replace('<script>/*SAMPLE*/</script>', () => (sample ? '<script>\n' + sample + '\n</script>' : ''))
    .replace('<script>/*UI*/</script>', () => '<script>\n' + ui + '\n</script>');

const kb = s => String(Math.round(s.length / 1024)).padStart(4);

// Every inline script must still parse after bundling. A build that silently
// mangles its own output is worse than one that fails.
function assertScriptsParse(html, label) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!blocks.length) throw new Error(label + ': no inline scripts survived the bundle');
  blocks.forEach((m, i) => {
    try { new Function(m[1]); }
    catch (e) { throw new Error(`${label}: inline script ${i} does not parse - ${e.message}`); }
  });
  for (const marker of ['/*CORE*/', '/*UI*/', '/*SAMPLE*/']) {
    if (html.includes(marker)) throw new Error(`${label}: ${marker} placeholder was left in the output`);
  }
  return blocks.length;
}

// The bundle is a fragment: the artifact host supplies the document around it.
// A file served on its own needs that document, or the browser falls into quirks
// mode and renders every · and ✓ as mojibake for want of a charset.
function standalone(fragment) {
  const cut = fragment.indexOf('</style>');
  if (cut < 0) throw new Error('no <style> block found - cannot split head from body');
  const head = fragment.slice(0, cut + '</style>'.length);
  const body = fragment.slice(cut + '</style>'.length);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Drag-and-drop line board for the master production plan. Workbooks are read in your browser and never uploaded.">
${head}
</head>
<body>${body}
</body>
</html>
`;
}

// A var() that nothing defines is not an error to the browser, it is a silent
// fallback to whatever was inherited. That is how a white-on-white badge shipped.
function assertCssVarsDefined(html) {
  const defined = new Set([...html.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
  const used = new Set([...html.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map(m => m[1]));
  const missing = [...used].filter(v => !defined.has(v));
  if (missing.length) throw new Error('CSS variables used but never defined: ' + missing.join(', '));
}
assertCssVarsDefined(shell);

const clean = standalone(bundle(''));
if (clean.includes('window.SAMPLE=')) throw new Error('index.html must not carry order data');
assertScriptsParse(clean, 'public/index.html');
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public/index.html'), clean);
console.log(`built public/index.html ${kb(clean)} KB  no order data`);

if (existsSync(join(root, 'sample.json'))) {
  const data = read('sample.json');
  if (data.includes('</script')) throw new Error('sample.json would close the script tag early');
  const demo = bundle('window.SAMPLE=' + data + ';');
  assertScriptsParse(demo, 'app.demo.html');
  writeFileSync(join(root, 'app.demo.html'), demo);
  console.log(`built app.demo.html     ${kb(demo)} KB  embeds real orders - do not publish`);
}
