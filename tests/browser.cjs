// Real-browser checks. Nothing to install: this drives an installed Edge or Chrome
// directly over the DevTools protocol, using the WebSocket built into Node 22 or later.
// BROWSER_EXECUTABLE picks a browser; otherwise the usual install locations are tried.
// The browser runs headless with a throwaway profile on a port the system chooses, and
// is closed (and its profile deleted) at the end. BROWSER_SCREENSHOT=path.png saves the
// desktop and narrow-screen results. All fixtures are generated here and anonymous.
'use strict';
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {pathToFileURL} = require('node:url');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  if (process.env.BROWSER_EXECUTABLE) return process.env.BROWSER_EXECUTABLE;
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [
    ...pf.map(d => path.join(d, 'Microsoft/Edge/Application/msedge.exe')),
    ...pf.map(d => path.join(d, 'Google/Chrome/Application/chrome.exe')),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('No Edge or Chrome found; set BROWSER_EXECUTABLE');
  return found;
}

/* ---------------- a minimal DevTools-protocol client ---------------- */
async function launch() {
  if (typeof WebSocket === 'undefined') throw new Error('Needs Node 22 or later (built-in WebSocket)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'case-viewer-browser-'));
  const proc = spawn(findBrowser(), ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], {stdio: 'ignore'});
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) {}
    if (!port) await sleep(100);
  }
  if (!port) { proc.kill(); throw new Error('The browser did not open a DevTools port'); }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const page = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  const close = async () => {
    try { const b = await connect(version.webSocketDebuggerUrl); await b.send('Browser.close').catch(() => {}); b.ws.close(); } catch (e) {}
    for (let i = 0; i < 50 && proc.exitCode == null; i++) await sleep(100);
    if (proc.exitCode == null) proc.kill();
    for (let i = 0; i < 20; i++) { try { fs.rmSync(profile, {recursive: true, force: true}); break; } catch (e) { await sleep(250); } }
  };
  return {page, close};
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools connection failed')); });
  let id = 0; const pending = new Map(), listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) listeners.forEach(f => f(m));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, {res, rej}); ws.send(JSON.stringify({id: i, method, params}));
  });
  return {ws, send, on: f => listeners.push(f)};
}
function pageApi(c) {
  const errors = [];
  c.on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const evaluate = async expr => {
    const r = await c.send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
    if (r.exceptionDetails) throw new Error('In page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expr, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(`!!(${expr})`).catch(() => false)) return; await sleep(50); }
    throw new Error('Timed out waiting for: ' + expr);
  };
  const box = async sel => {
    const r = await evaluate(`(()=>{ const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null;
      e.scrollIntoView({block:'nearest'}); const b=e.getBoundingClientRect(); return {x:b.left, y:b.top, w:b.width, h:b.height}; })()`);
    if (!r || !r.w) throw new Error('Not found or not visible: ' + sel);
    return r;
  };
  const mouse = (type, x, y) => c.send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});
  /* a real click at the element's centre (the same path a person's click takes) */
  const click = async sel => { const b = await box(sel), x = b.x + b.w/2, y = b.y + b.h/2;
    await c.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y}); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const KEYS = {ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, PageUp: 33, PageDown: 34, Home: 36, End: 35, ' ': 32};
  const key = async (k, mods = 0) => {
    const code = KEYS[k] || k.toUpperCase().charCodeAt(0);
    const base = {key: k, code: k === ' ' ? 'Space' : (KEYS[k] ? k : 'Key' + k.toUpperCase()), windowsVirtualKeyCode: code, modifiers: mods};
    await c.send('Input.dispatchKeyEvent', {type: 'keyDown', ...base, text: k.length === 1 ? k : undefined});
    await c.send('Input.dispatchKeyEvent', {type: 'keyUp', ...base});
  };
  const viewport = (width, height, mobile) => c.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: !!mobile});
  const goto = async url => { await c.send('Page.navigate', {url}); await waitFor(`document.readyState==='complete' && typeof APP!=='undefined'`); };
  const reload = async () => { await evaluate('location.reload(), 1'); await sleep(300); await waitFor(`document.readyState==='complete' && typeof APP!=='undefined'`); };
  const screenshot = async file => { const r = await c.send('Page.captureScreenshot', {format: 'png'}); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); };
  return {send: c.send, evaluate, waitFor, click, mouse, key, viewport, goto, reload, screenshot, errors};
}

/* ---------------- fixtures ---------------- */
function fixture(id, extra = []) {
  const hdr = t => ({ElapsedTime: t});
  const lead = phase => Array.from({length: 1000}, (_, i) => Math.round(100*Math.sin(i/20 + phase)));
  const twelve = t => ({Ecg12LeadRec: {StdHdr: hdr(t), SampleRate: 100,
    Amplitude: {'@UnitsVal': 'microvolts', '#text': 10},
    LeadData: Object.fromEntries(['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((l, i) => ['Lead' + l, lead(i)]))}});
  const records = [{CaseSummary: {StartTime: '2020-01-01T00:00:00', ElapsedTime: 120}},
    {DataChannels: {DataChannel: [{ChanType: 3, Scalar: 10000, ScalarType: 1}]}},
    {AnnotationEvt: {StdHdr: hdr(0), '@EvtName': 'New Patient'}},
    {AnnotationEvt: {StdHdr: hdr(15), '@EvtName': 'Test treatment', TreatmentSummary: 1}},
    {ContinWaveRec: {StdHdr: hdr(0), Waveform: {WaveRec: {WaveType: 3, WaveTypeVar: '12-Lead II',
      SampleTime: 10000, UnpackedSamples: Array.from({length: 12000}, (_, i) => Math.round(100*Math.sin(i/20)))}}}},
    twelve(30), twelve(70), ...extra];
  return {name: id + '.json', text: JSON.stringify({ZOLL: {FullDisclosure: [{FullDisclosureRecord: records}]}})};
}

(async () => {
  const {page, close} = await launch();
  const p = pageApi(page);
  const shotBase = process.env.BROWSER_SCREENSHOT;
  try {
    await p.send('Page.enable'); await p.send('Runtime.enable');
    await p.viewport(1440, 1000);
    await p.goto(pathToFileURL(path.join(__dirname, '..', 'case-viewer.html')).href);
    const load = async f => {
      await p.evaluate(`(()=>{ const dt=new DataTransfer();
        dt.items.add(new File([${JSON.stringify(f.text)}], ${JSON.stringify(f.name)}, {type:'application/json'}));
        const inp=document.querySelector('#fileinput'); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);
      await p.waitFor(`!APP.loading && M.fileName===${JSON.stringify(f.name)} && document.querySelector('#app').classList.contains('live')`);
    };
    const state = expr => p.evaluate(`JSON.stringify(${expr})`).then(JSON.parse);

    /* -- the start page offers three sample cases; the child one opens with child CPR targets -- */
    assert.equal(await p.evaluate(`document.querySelectorAll('#samples [data-samp]').length`), 3);
    await p.click('#samples [data-samp="2"]');
    await p.waitFor(`!APP.loading && M.caseId==='SIM-CHILD-0001' && document.querySelector('#app').classList.contains('live')`, 60000);
    await p.click('#tabs button[data-view="cpr"]');
    await p.evaluate('seek(1120000), 1');   /* the live dashboard needs the playhead inside the CPR */
    await p.waitFor(`APP.view==='cpr' && document.querySelector('.dashwarn')`);
    assert.equal(await p.evaluate('CPR_TARGET.group'), 'child');
    assert.match(await p.evaluate(`document.querySelector('.dashwarn').textContent`), /Adult-derived model/);
    await p.click('#tabs button[data-view="monitor"]');

    /* -- waveform choices are remembered across cases and reloads -- */
    await load(fixture('browser-case-a'));
    const waveSel = '#monitorLeadList input[data-ch="12-Lead II"]';
    await p.evaluate(`(()=>{ const w=document.querySelector('${waveSel}'); if(w.checked) w.click(); return 1; })()`);
    await load(fixture('browser-case-b'));
    assert.equal(await p.evaluate(`document.querySelector('${waveSel}').checked`), false, 'wave choice survives a case switch');
    await p.reload(); await load(fixture('browser-case-c'));
    assert.equal(await p.evaluate(`document.querySelector('${waveSel}').checked`), false, 'wave choice survives a reload');
    await p.evaluate(`(()=>{ const w=document.querySelector('${waveSel}'); if(!w.checked) w.click(); return 1; })()`);

    /* -- a 12-lead event pauses, opens that acquisition from its start; Play returns -- */
    await p.click('#btnPlay');
    await p.click('#eventlist .ev[data-snap="1"]');
    let s = await state(`{playing:APP.playing, view:APP.view, selected:APP.snapshotIndex, cursor:APP.cursor,
      start:M.snapshots[1].start, back:APP.returnView}`);
    assert.equal(s.playing, false); assert.equal(s.view, 'ecg');
    assert.equal(s.selected, 1); assert.equal(s.cursor, s.start); assert.equal(s.back, 'monitor');
    assert.match(await p.evaluate(`document.querySelector('#snapList button.on').textContent`), /00:01:10/);
    await p.click('#btnPlay');
    await p.waitFor(`APP.playing && APP.view==='monitor'`);
    await p.click('#btnPlay');
    await p.click('#eventlist .ev[data-t="15000"]');
    assert.deepEqual(await state(`{cursor:APP.cursor, start:followWindow(APP.win,'monitorAnchor').t0}`), {cursor: 15000, start: 15000});
    if (shotBase) await p.screenshot(shotBase.replace(/\.png$/i, '') + '-desktop.png');

    /* -- the same on Physiology -- */
    await p.click('#tabs button[data-view="hemo"]');
    await p.waitFor(`document.querySelector('#hemoWave')`);
    await p.click('#eventlist .ev[data-snap="0"]');
    await p.click('#eventlist .ev[data-snap="1"]');
    await p.click('#btnPlay');
    await p.waitFor(`APP.playing && APP.view==='hemo'`);
    await p.click('#btnPlay');
    await p.click('#eventlist .ev[data-t="15000"]');
    assert.equal(await p.evaluate('HV.anchor'), 15000);

    /* -- whole-case ECG panel: O opens it; drag to scrub; keyboard on the panel and its edge -- */
    await p.click('#tabs button[data-view="monitor"]');
    if (await p.evaluate(`document.querySelector('#ovDock').hidden`)) await p.key('o');
    await p.waitFor(`!document.querySelector('#ovDock').hidden && document.querySelector('#ovCanvas')._ov`);
    const g = await p.evaluate(`(()=>{ const c=document.querySelector('#ovCanvas'), b=c.getBoundingClientRect(), k=c._ov, z=(CFG.uiScale||100)/100;
      return {x:b.left, y:b.top, z, L:k.L, T:k.T, plotW:k.plotW, rowMs:k.rowMs, RH:k.RH}; })()`);
    const at = f => [g.x + (g.L + f*g.plotW)*g.z, g.y + (g.T + g.RH/2)*g.z];   /* first row, fraction f across */
    await p.mouse('mousePressed', ...at(0.1));
    await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: at(0.3)[0], y: at(0.3)[1], button: 'left', buttons: 1});
    assert.equal(await p.evaluate('OV.dragging'), true, 'dragging on the panel');
    await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: at(0.5)[0], y: at(0.5)[1], button: 'left', buttons: 1});
    await p.mouse('mouseReleased', ...at(0.5));
    const want = Math.min(0.5*g.rowMs, await p.evaluate('M.durMs'));
    assert.ok(Math.abs(await p.evaluate('APP.cursor') - want) < g.rowMs/100, 'drag-to-scrub lands where released');
    await p.evaluate(`document.querySelector('#ovCanvas').focus(), 1`);
    await p.key('Home');
    assert.equal(await p.evaluate('APP.cursor'), 0);
    await p.key('ArrowRight');
    assert.equal(await p.evaluate('APP.cursor'), 1000, 'arrow keys step 1 s from the panel');
    await p.key('ArrowDown');
    assert.equal(await p.evaluate('APP.cursor'), Math.min(1000 + g.rowMs, await p.evaluate('M.durMs')), 'down moves a row');
    await p.key('End'); await p.key('ArrowUp');
    assert.equal(await p.evaluate('APP.cursor'), Math.max(0, (await p.evaluate('M.durMs')) - g.rowMs), 'up moves back a row');
    assert.match(await p.evaluate(`document.querySelector('#ovCanvas').getAttribute('aria-valuetext')`), /into the case/);
    await p.evaluate(`document.querySelector('#ovGrip').focus(), 1`);
    const h0 = await p.evaluate('CFG.ovH||200');
    await p.key('ArrowUp');
    assert.equal(await p.evaluate('CFG.ovH'), h0 + 20, 'the panel edge resizes from the keyboard');
    await p.key('Home');
    assert.equal(await p.evaluate('CFG.ovH'), 200, 'Home resets the panel height');
    assert.equal(await p.evaluate('APP.cursor'), Math.max(0, (await p.evaluate('M.durMs')) - g.rowMs), 'Home on the edge does not move the playhead');
    await p.key('o');   /* close it again: the narrow-screen checks expect the default layout */
    assert.deepEqual(p.errors, []);

    /* -- the snapshot/resume path on a narrow screen, through the event panel -- */
    await p.viewport(390, 844, true);
    await p.evaluate(`(()=>{ setView('monitor'); setEventPanelVisible(true); return 1; })()`);
    await p.click('#eventlist .ev[data-snap="1"]');
    assert.equal(await p.evaluate('APP.snapshotIndex'), 1);
    await p.click('#btnPlay');
    await p.waitFor(`APP.playing && APP.view==='monitor'`);
    await p.click('#btnPlay');
    assert.deepEqual(p.errors, []);
    if (shotBase) await p.screenshot(shotBase);

    /* -- a file with two patients is refused, and the next file still opens -- */
    await p.viewport(1440, 1000);
    await p.evaluate(`(()=>{ const dt=new DataTransfer();
      dt.items.add(new File([${JSON.stringify(fixture('multi-patient', [{AnnotationEvt: {StdHdr: {ElapsedTime: 80}, '@EvtName': 'New Patient'}}]).text)}],
        'multi-patient.json', {type:'application/json'}));
      const inp=document.querySelector('#fileinput'); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);
    await p.waitFor(`!APP.loading && /multiple New Patient/.test(document.querySelector('#progtext').textContent)`);
    assert.equal(await p.evaluate(`document.querySelector('#app').classList.contains('live')`), false);
    await load(fixture('browser-case-recovery'));
    assert.equal(await p.evaluate('APP.playing'), false);
    assert.deepEqual(p.errors, []);
    console.log('Browser checks passed: child sample from the start page, saved waveforms, exact snapshot, pause/resume, ' +
      'event starts, whole-case ECG drag and keyboard, mobile, rejected-file recovery.');
  } finally { await close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
