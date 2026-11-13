#!/usr/bin/env node
/* Builds a fully synthetic .zol case for testing Case Viewer.

   Nothing here comes from a real patient or device: names, identifiers, times and
   every sample are invented. The record layout follows the export format described
   in FORMAT.md so the viewer reads it the way it reads a real file, and the
   physiology is modelled so the viewer's algorithms have known answers to find.

     node tools/make-test-case.cjs                 -> test-cases/synthetic-cardiac.zol
     node tools/make-test-case.cjs --neuro         -> test-cases/synthetic-neuro.zol
     node tools/make-test-case.cjs --child         -> test-cases/synthetic-child.zol
     node tools/make-test-case.cjs --new-patient-at 650 --out file.zol
                                                   (New Patient marker at 650 s: the data before
                                                   it is an earlier patient's, to test exclusion)
     node tools/make-test-case.cjs --out file.zol

   Each run also writes <name>.expected.md: the timeline and the values the viewer
   should find. The output is deterministic (seeded), so results can be compared
   between versions of the viewer.

   The generator itself is synthCase() in case-viewer.html, where it also builds the
   sample cases on the Open page; this script runs that same code. */
'use strict';
const fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const NEURO = args.includes('--neuro'), CHILD = args.includes('--child');
if (NEURO && CHILD) { console.error('--neuro and --child cannot be combined'); process.exit(1); }
const npArg = args.indexOf('--new-patient-at');
const NP_AT = npArg >= 0 ? Number(args[npArg+1]) : 0;
if (npArg >= 0 && !(NP_AT > 0 && NP_AT < 1800)) { console.error('--new-patient-at needs a time in seconds between 0 and 1800'); process.exit(1); }
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? args[outArg+1]
  : path.join(__dirname, '..', 'test-cases', NEURO ? 'synthetic-neuro.zol' : CHILD ? 'synthetic-child.zol' : 'synthetic-cardiac.zol');

const html = fs.readFileSync(path.join(__dirname, '..', 'case-viewer.html'), 'utf8');
const m = html.match(/\/\* ---- synthetic sample cases: begin ----[\s\S]*?\/\* ---- synthetic sample cases: end ---- \*\//);
if (!m) { console.error('synthCase() not found in case-viewer.html'); process.exit(1); }
const synthCase = new Function(m[0] + '\nreturn synthCase;')();

const r = synthCase(NEURO, path.basename(OUT), {child: CHILD, newPatientAt: NP_AT});
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, r.zol);
fs.writeFileSync(OUT.replace(/\.zol$/i, '') + '.expected.md', r.sheet);
console.log('wrote', OUT, (r.zol.length/1048576).toFixed(1) + ' MB,', r.stats.records, 'records,', r.stats.beats, 'beats,',
  r.stats.breaths, 'breaths,', r.stats.compressions, 'compressions');
