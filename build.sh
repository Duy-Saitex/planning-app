#!/bin/bash
# Bundle src/ into a single self-contained HTML file.
#
#   app.html       always built, never contains order data, opens on the file picker.
#   app.demo.html  only when sample.json exists. It embeds real orders, so it is gitignored.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import os

shell = open('src/shell.html').read()
core  = open('src/core.js').read()
ui    = open('src/ui.js').read()
for name, body in (('core.js', core), ('ui.js', ui)):
    assert '</script' not in body, name + ' would close the script tag early'

def bundle(sample_js):
    out = shell.replace('<script>/*CORE*/</script>', '<script>\n' + core + '\n</script>')
    out = out.replace('<script>/*SAMPLE*/</script>', '<script>\n' + sample_js + '\n</script>' if sample_js else '')
    return out.replace('<script>/*UI*/</script>', '<script>\n' + ui + '\n</script>')

clean = bundle('')
assert 'window.SAMPLE=' not in clean, 'app.html must not carry order data'
open('app.html', 'w').write(clean)
print('built app.html       %4d KB  no order data' % (len(clean) / 1024))

if os.path.exists('sample.json'):
    data = open('sample.json').read()
    assert '</script' not in data, 'sample.json would close the script tag early'
    demo = bundle('window.SAMPLE=' + data + ';')
    open('app.demo.html', 'w').write(demo)
    print('built app.demo.html  %4d KB  embeds real orders - do not publish' % (len(demo) / 1024))
PY
