# Planning App

A drag-and-drop line board for the Saitex master production plan.

Open the master plan workbook, re-plan the lines, and export the same workbook back
with your edits written into it. Everything runs in the browser; no server, no upload.

## Use it

Open `public/index.html` in a browser and choose the master plan `.xlsx`. The file is read
locally, and stays local — nothing is uploaded, and the app works offline once loaded.

It is also deployable as a static site. See [Deploy](#deploy).

## What it does

**Overview** — open orders, quantity at risk, work in production, ex-factory this week,
approvals pending. Weekly sewing load against line capacity, at-risk quantity by buyer,
lines over capacity, orders blocked before their cut date, room left on the lines, and the
ex-factory outlook.

**Line board** — one lane per resource, switching between cutting, sewing, washing,
finishing, packing and ex-factory, so the lane axis becomes sewing lines, laundry lines,
finishing lines or factory sites. Drag a bar sideways to move the sewing dates, drop it on
another lane to reassign it, drag an edge to change its duration. Every drop opens a
confirmation showing old against new and what the move does to the delivery promise;
nothing is written until you accept.

Each bar carries its run state in the border: green for running, amber for ready to run,
plain for not started, and a red notch when ex-factory falls past the confirmed delivery.

**Capacity** — load against capacity per lane per day or week, and every stage side by side
from planned cut through ex-factory. Sewing capacity comes from each line's daily target;
laundry, finishing and cutting have no capacity in the workbook, so it is estimated from the
plan, marked as an estimate, and can be typed over.

**Orders** — the full table with column presets and inline editing.

**Changes** — every edited cell, old value against new, before you export.

## Editing and export

Edits are held in the browser and survive a refresh. Export rewrites only the cells you
changed, inside your original file: untouched formulas are preserved, and Excel recalculates
the sheet when it opens. Cells that held a formula keep the value you typed.

## How the plan is derived

The workbook's own formula chain is reproduced, so moving a sewing date moves the whole
train: cut date, marker release, input, wash out, finishing, packing, inspection and
ex-factory, skipping Sundays the way the sheet does.

An order counts as **running** once any process has produced pieces or its marker is cut,
**ready to run** when nothing is blocking it and sewing starts within 14 days, and
**waiting** while fabric, an approval, trims or shrinkage is still outstanding. A style with
no wash recipe is never given a laundry line.

## Develop

```
npm install          # jszip, needed only by the self-check
npm run build        # bundles src/ into public/index.html
npm run check -- "/path/to/Production Plan.xlsx"
```

The build is plain node with no dependencies, so `node build.mjs` is all a deploy runner needs.

`src/core.js` is the data layer: it parses the workbook, reproduces the formula chain,
tracks edits with grouped undo, and patches the original `.xlsx` on export. It runs in the
browser and under node, which is how the self-check exercises it against a real file.
`src/ui.js` is the interface, `src/shell.html` the markup and design tokens. `build.mjs`
inlines all three.

`selfcheck.js` is the one runnable check. It asserts the parts that would otherwise fail
silently: the cut date stays twelve days before sewing, no derived date lands on a Sunday,
one drag is one undo, an order with no recipe never loads the laundry, a negative on-time
figure reads as late, every run state stays reachable, a finished order stops reading as
running, and an export reopens with the edits intact and the neighbouring row untouched.

## Demo data

`npm run build` also writes `app.demo.html` when a `sample.json` is present, which opens on
a few hundred real orders instead of the file picker.

**That file contains live customer orders and is deliberately excluded from this
repository**, along with `sample.json` and any `.xlsx`. Regenerate it locally:

```
node tools/make-sample.js "/path/to/Production Plan.xlsx"
npm run build
```

Only `public/index.html`, which carries no order data, is committed or deployed.

## Deploy

Import the repository into Vercel and accept the defaults. `vercel.json` sets the build to
`node build.mjs` and the output directory to `public/`, so the deployed site is one static
file served at `/`, built from `src/` on every push.

There is no server and no database. A deployment holds no order data: `sample.json` and
`app.demo.html` are gitignored, so the site always opens on the file picker, and each
planner's workbook is read in their own browser.
