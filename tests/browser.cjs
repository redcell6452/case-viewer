// Optional real-browser checks. Install playwright-core locally or set PLAYWRIGHT_MODULE
// to an existing installation. BROWSER_EXECUTABLE can select an installed Chromium.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

function fixture(id) {
  const hdr = t => ({ElapsedTime:t});
  const lead = phase => Array.from({length:1000},(_,i)=>Math.round(100*Math.sin(i/20+phase)));
  const twelve = t => ({Ecg12LeadRec:{StdHdr:hdr(t),SampleRate:100,
    Amplitude:{'@UnitsVal':'microvolts','#text':10},
    LeadData:Object.fromEntries(['I','II','V1','V2','V3','V4','V5','V6'].map((l,i)=>['Lead'+l,lead(i)]))}});
  const records=[{CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:120}},
    {DataChannels:{DataChannel:[{ChanType:3,Scalar:10000,ScalarType:1}]}},
    {AnnotationEvt:{StdHdr:hdr(0),'@EvtName':'New Patient'}},
    {AnnotationEvt:{StdHdr:hdr(15),'@EvtName':'Test treatment',TreatmentSummary:1}},
    {ContinWaveRec:{StdHdr:hdr(0),Waveform:{WaveRec:{WaveType:3,WaveTypeVar:'12-Lead II',
      SampleTime:10000,UnpackedSamples:Array.from({length:12000},(_,i)=>Math.round(100*Math.sin(i/20)))}}}},
    twelve(30),twelve(70)];
  return {name:id+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:records}]}}))};
}

(async()=>{
  const browser=await chromium.launch({headless:true,
    executablePath:process.env.BROWSER_EXECUTABLE || undefined,args:['--disable-gpu']});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname,'..','case-viewer.html')).href);
    const load=async id=>{
      await page.locator('#fileinput').setInputFiles(fixture(id));
      await page.waitForFunction(()=>!APP.loading && document.querySelector('#app').classList.contains('live'));
    };
    await load('browser-case-a');
    const wave=page.locator('#monitorLeadList input[data-ch="12-Lead II"]');
    await wave.uncheck();
    await load('browser-case-b');
    assert.equal(await wave.isChecked(),false,'wave choice survives a case switch');
    await page.reload(); await load('browser-case-c');
    assert.equal(await wave.isChecked(),false,'wave choice survives a reload');
    await wave.check();

    await page.locator('#btnPlay').click();
    await page.locator('#eventlist .ev[data-snap="1"]').click();
    let state=await page.evaluate(()=>({playing:APP.playing,view:APP.view,selected:APP.snapshotIndex,
      cursor:APP.cursor,start:M.snapshots[1].start,back:APP.returnView}));
    assert.equal(state.playing,false); assert.equal(state.view,'ecg');
    assert.equal(state.selected,1); assert.equal(state.cursor,state.start);
    assert.equal(state.back,'monitor');
    assert.match(await page.locator('#snapList button.on').textContent(),/00:01:10/);
    await page.locator('#btnPlay').click();
    await page.waitForFunction(()=>APP.playing && APP.view==='monitor');
    await page.locator('#btnPlay').click();
    await page.locator('#eventlist .ev[data-t="15000"]').click();
    assert.deepEqual(await page.evaluate(()=>({cursor:APP.cursor,start:followWindow(APP.win,'monitorAnchor').t0})),
      {cursor:15000,start:15000});
    if(process.env.BROWSER_SCREENSHOT) await page.screenshot({path:process.env.BROWSER_SCREENSHOT.replace(/\.png$/, '-desktop.png')});

    await page.locator('#tabs button[data-view="hemo"]').click();
    await page.waitForSelector('#hemoWave');
    await page.locator('#eventlist .ev[data-snap="0"]').click();
    await page.locator('#eventlist .ev[data-snap="1"]').click();
    await page.locator('#btnPlay').click();
    await page.waitForFunction(()=>APP.playing && APP.view==='hemo');
    await page.locator('#btnPlay').click();
    await page.locator('#eventlist .ev[data-t="15000"]').click();
    assert.equal(await page.evaluate(()=>HV.anchor),15000);
    assert.deepEqual(errors,[]);

    // Repeat the snapshot/resume path in a narrow viewport using the event panel.
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{ setView('monitor'); setEventPanelVisible(true); });
    await page.locator('#eventlist .ev[data-snap="1"]').click();
    assert.equal(await page.evaluate(()=>APP.snapshotIndex),1);
    await page.locator('#btnPlay').click();
    await page.waitForFunction(()=>APP.playing && APP.view==='monitor');
    await page.locator('#btnPlay').click();
    assert.deepEqual(errors,[]);
    if(process.env.BROWSER_SCREENSHOT) await page.screenshot({path:process.env.BROWSER_SCREENSHOT});

    const bad=fixture('multi-patient');
    const obj=JSON.parse(bad.buffer.toString());
    obj.ZOLL.FullDisclosure[0].FullDisclosureRecord.push(
      {AnnotationEvt:{StdHdr:{ElapsedTime:80},'@EvtName':'New Patient'}});
    bad.buffer=Buffer.from(JSON.stringify(obj));
    await page.locator('#fileinput').setInputFiles(bad);
    await page.waitForFunction(()=>!APP.loading);
    assert.match(await page.locator('#progtext').textContent(),/multiple New Patient/);
    assert.equal(await page.locator('#app').evaluate(e=>e.classList.contains('live')),false);
    await load('browser-case-recovery');
    assert.equal(await page.evaluate(()=>APP.playing),false);
    console.log('Browser checks passed: saved waveforms, exact snapshot, pause/resume, event starts, mobile, rejected-file recovery.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
