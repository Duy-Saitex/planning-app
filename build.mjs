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

const bundle = sample =>
  shell
    .replace('<script>/*CORE*/</script>', '<script>\n' + core + '\n</script>')
    .replace('<script>/*SAMPLE*/</script>', sample ? '<script>\n' + sample + '\n</script>' : '')
    .replace('<script>/*UI*/</script>', '<script>\n' + ui + '\n</script>');

const kb = s => String(Math.round(s.length / 1024)).padStart(4);

const clean = bundle('');
if (clean.includes('window.SAMPLE=')) throw new Error('index.html must not carry order data');
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public/index.html'), clean);
console.log(`built public/index.html ${kb(clean)} KB  no order data`);

if (existsSync(join(root, 'sample.json'))) {
  const data = read('sample.json');
  if (data.includes('</script')) throw new Error('sample.json would close the script tag early');
  const demo = bundle('window.SAMPLE=' + data + ';');
  writeFileSync(join(root, 'app.demo.html'), demo);
  console.log(`built app.demo.html     ${kb(demo)} KB  embeds real orders - do not publish`);
}
