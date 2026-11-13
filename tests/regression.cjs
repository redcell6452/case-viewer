const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const zlib = require('node:zlib');
const html = fs.readFileSync(path.join(__dirname, '..', 'case-viewer.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const core = script.slice(0, script.indexOf('(function boot(){'));
function app(extra = {}) {
  const storage = new Map();
  const ctx = vm.createContext({console, TextDecoder, TextEncoder, Blob, Response,
    DecompressionStream, URL, setTimeout, clearTimeout,
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v)}, ...extra});
  vm.runInContext(core, ctx);
  return {ctx, run: source => vm.runInContext(source, ctx)};
}
const ab = b => Uint8Array.from(b).buffer;
function container(json = '{"ZOLL":{}}', xml = '<CaseReview/>') {
  const j = Buffer.from(json), x = Buffer.from('\ufeff' + xml, 'utf16le');
  const b = Buffer.alloc(j.length + x.length + 8);
  b.writeUInt32LE(j.length); j.copy(b, 4); b.writeUInt32LE(x.length, j.length + 4); x.copy(b, j.length + 8);
  return b;
}
// Independent ZIP fixture producer: CRC from Node's zlib, not the viewer implementation.
function zip(data, options = {}) {
  const name = Buffer.from(options.name || 'case.json'), method = options.method ?? 8;
  const raw = method === 0 ? data : zlib.deflateRawSync(data), crc = zlib.crc32(data);
  const l = Buffer.alloc(30 + name.length), c = Buffer.alloc(46 + name.length), e = Buffer.alloc(22);
  l.writeUInt32LE(0x04034b50); l.writeUInt16LE(method, 8); l.writeUInt32LE(crc, 14);
  l.writeUInt32LE(raw.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(name.length, 26); name.copy(l, 30);
  c.writeUInt32LE(0x02014b50); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(raw.length, 20); c.writeUInt32LE(options.declared ?? data.length, 24);
  c.writeUInt16LE(name.length, 28); name.copy(c, 46);
  e.writeUInt32LE(0x06054b50); e.writeUInt16LE(1, 8); e.writeUInt16LE(1, 10);
  e.writeUInt32LE(c.length, 12); e.writeUInt32LE(l.length + raw.length, 16);
  return Buffer.concat([l, raw, c, e]);
}
test('complete browser script parses', () => new vm.Script(script));
test('all 25 existing arterial self-checks pass', () => {
  const results = app().run('runHemoSelfTests()');
  assert.equal(results.length, 25);
  assert.deepEqual(Array.from(results.filter(r => !r.pass)), []);
});
for (const prefix of ['', ' \r\n\t', '\ufeff', '\ufeff  ']) {
  test('raw JSON accepts prefix ' + JSON.stringify(prefix), () => {
    const a = app({input: ab(Buffer.from(prefix + '{"ZOLL":{}}'))});
    assert.equal(a.run('JSON.parse(splitZol(input).json).ZOLL != null'), true);
  });
}
test('container parses JSON and UTF-16 XML, even when length starts with a JSON magic byte', () => {
  for (const size of [123, 255, 316]) {
    const j = '{"p":"' + 'a'.repeat(size - 8) + '"}';
    const a = app({input: ab(container(j))});
    assert.equal(a.run('splitZol(input).json.length'), size);
    assert.equal(a.run('splitZol(input).xml'), '<CaseReview/>');
  }
});
test('truncated JSON, XML, XML length and empty files are rejected', () => {
  const b = container(), jsonEnd = 4 + b.readUInt32LE(0);
  for (const bad of [Buffer.alloc(0), b.subarray(0, 7), b.subarray(0, jsonEnd+2), b.subarray(0,b.length-2)]) {
    assert.throws(() => app({input:ab(bad)}).run('splitZol(input)'));
  }
});
for (const method of [0, 8]) test('ZIP method ' + method + ' roundtrips', async () => {
  const data = Buffer.from('{"ZOLL":{}}');
  const a = app({input: ab(zip(data, {method}))});
  const out = await a.run('unzipFirstMatch(input, /\.json$/i)');
  assert.equal(Buffer.from(out.buf).toString(), data.toString());
});
test('ZIP validates checksum, bounds, supported entries and declared size', async () => {
  const data = Buffer.from('{"ZOLL":{}}'), corrupt = zip(data, {method:0});
  corrupt[30 + Buffer.byteLength('case.json')] ^= 1;
  const invalid = [corrupt, zip(data).subarray(0,40), zip(data,{name:'readme.txt'}),
    zip(data,{declared:268435457}), zip(data,{declared:1}), zip(data,{declared:100})];
  for (const b of invalid) await assert.rejects(app({input:ab(b)}).run('unzipFirstMatch(input, /\.json$/i)'));
});
test('oversize input is rejected before reading', async () => {
  let read = false;
  const a = app({file:{size:268435457, arrayBuffer(){read=true;}}});
  await assert.rejects(a.run('readCaseFile(file)'), /256 MiB/);
  assert.equal(read, false);
});
test('numeric and wrapped zero trends survive, invalid values do not', () => {
  const a=app();
  a.run(`buildModel(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}},
    {TrendRpt:{StdHdr:{ElapsedTime:0},Trend:{Resp:{TrendData:{DataState:'valid',Val:0}},
      Fico2:{TrendData:{DataState:'valid',Val:{'#text':0}}},Etco2:{TrendData:{DataState:'invalid',Val:12}}}}}
  ]}]}}),null,'synthetic.json')`);
  assert.equal(a.run('M.trends[0].rr'), 0);
  assert.equal(a.run('M.trends[0].fico2'), 0);
  assert.equal(a.run('M.trends[0].etco2'), null);
});
test('annotation imports sanitize attributes while preserving literal note text', () => {
  const a=app({payload:{id:'\"><img src=x onerror=alert(1)>', color:'red" onmouseover="alert(1)',t0:1,t1:10,text:'<b>literal</b>'}});
  a.run('M.durMs=100; M.caseId="case-a"; importAnnotations([payload])');
  assert.equal(a.run('ANN.list.length'),1);
  assert.equal(a.run('/^[\\w.:-]+$/.test(ANN.list[0].id)'),true);
  assert.equal(a.run('ANN.list[0].color'), '#4aa3ff');
  assert.equal(a.run('esc(ANN.list[0].text)'), '&lt;b&gt;literal&lt;/b&gt;');
});
test('annotation validation rejects malformed data and other cases atomically', () => {
  const a=app(); a.run('M.durMs=100; M.caseId="case-a"');
  for (const expr of ['null','{}','[{t0:"1",t1:5}]','[{t0:6,t1:5}]','[{t0:1,t1:101}]',
    '[{t0:1,t1:2},{t0:-1,t1:5}]','{caseId:"case-b",annotations:[]}']) {
    assert.throws(() => a.run('importAnnotations('+expr+')'));
    assert.equal(a.run('ANN.list.length'),0);
  }
  a.run('importAnnotations([{id:"a1",t0:1,t1:2}]); importAnnotations([{id:"a1",t0:1,t1:2}])');
  assert.equal(a.run('ANN.list.length'),1);
});
test('saved non-array annotations cannot break loading', () => {
  const a=app(); a.run('localStorage.setItem(annKey(), "{}"); annLoad()');
  assert.equal(a.run('ANN.list.length'),0);
});
test('ventilation timing uses selected window and chooses a source within it', () => {
  const a=app(); a.run(`M.breathsCo2=[0,5000,10000,15000,20000].map(t=>({t}));
    M.vents=[30000,35000,40000,45000,50000,90000];`);
  assert.equal(a.run('ventilationRegularity({t0:30000,t1:50000}).ok'),true);
  assert.equal(a.run('ventilationRegularity({t0:30000,t1:50000}).src'),'ventilation marks');
  assert.equal(a.run('ventilationRegularity({t0:30000,t1:90000}).ok'),false);
});
test('respiratory variation excludes clipped cycles and uses a mean for SVV', () => {
  const a=app(); a.run(`M.vents=[0,5000,10000,15000,20000];
    var b=Array.from({length:20},(_,i)=>({t:i*1000,tFoot:i*1000,tEnd:(i+1)*1000, v:i%5===4?3:1}));`);
  assert.equal(a.run('respVariation(b,x=>x.v,true,{t0:1000,t1:19000}).value'),null);
  assert.equal(a.run('respVariation(b,x=>x.v,true,{t0:0,t1:20000},true).cycles'),4);
  assert.ok(Math.abs(a.run('respVariation(b,x=>x.v,true,{t0:0,t1:20000},true).value') - 200/1.4)<1e-8);
});
test('quality noise is local to the window and invariant to case duration', () => {
  const a=app(); a.run(`var ch=synthArterial({hr:80,sys:120,dia:70});
    var beats=extractBeats(ch,pulseDetect(ch));
    var baseline=signalQuality(ch,beats.filter(b=>b.t>=30000),{t0:30000,t1:60000}).noise;
    for(let i=0;i<ch.hz*20;i++) ch.segs[0].data[i]+=(i%2?1:-1)*30;`);
  assert.equal(a.run('signalQuality(ch,beats.filter(b=>b.t>=30000),{t0:30000,t1:60000}).noise'),a.run('baseline'));
  assert.ok(a.run('signalQuality(ch,beats.filter(b=>b.t<20000),{t0:0,t1:20000}).flags.includes("excessive_noise")'));
});
test('windowed venous mean does not use arterial beat criteria', () => {
  const a=app(); a.run(`var art=synthArterial({hr:75,sys:120,dia:70});
    var ven={name:'CVP',hz:10,segs:[{t0:0,n:600,data:Float32Array.from({length:600},(_,i)=>i<300?8:14)}],nValid:600};
    hemoLines=()=>({art:{ch:art},cvp:{ch:ven}}); M.beatsByChan={[art.name]:pulseDetect(art)};
    M.durMs=60000; HEMO.svK=266;`);
  assert.equal(a.run('hemoCompute({t0:0,t1:30000}).cvp.value'),8);
  assert.equal(a.run('hemoCompute({t0:30000,t1:60000}).cvp.value'),14);
});
test('regular respiration gives descriptive values without clinical cutoffs or Eadyn', () => {
  const a=app(); a.run(`var art=synthArterial({hr:80,sys:120,dia:70,respAmp:14,respHz:0.2});
    hemoLines=()=>({art:{ch:art}}); M.beatsByChan={[art.name]:pulseDetect(art)};
    M.vents=Array.from({length:13},(_,i)=>i*5000); var r=hemoCompute({t0:0,t1:60000}).results;`);
  assert.equal(a.run('r.ppv.valid'),true);
  assert.equal(a.run('r.ppv.reference_range'),null);
  assert.equal(a.run('r.ppv.interpretation'),'trend_only');
  assert.equal(a.run('r.eadyn.valid'),false);
  assert.ok(a.run('r.ppv.limitations.includes("ventilation_mode_and_clinical_conditions_unverified")'));
});
test('HRV retains elapsed time and avoids adjacent differences across rejected intervals', () => {
  const a=app(); a.run(`var t=0; var b=Array.from({length:30},(_,i)=>{const rr=i===15?1400:1000;t+=rr;return {t,rr};}); var h=hrvAnalysis(b);`);
  assert.equal(a.run('h.excluded'),1);
  assert.equal(a.run('h.spanS'),30.4);
  assert.equal(a.run('h.adjacentPairs'),27);
  assert.equal(a.run('h.rmssd'),0);
  assert.equal(a.run('h.freq'),null);
});
test('equal-amplitude LF and HF oscillations have approximately equal integrated power', () => {
  const a=app(); a.run(`var t=0,b=[]; while(t<360000){
    const rr=1000+35*Math.sin(2*Math.PI*0.1*t/1000)+35*Math.sin(2*Math.PI*0.25*t/1000);
    t+=rr; b.push({t,rr}); } var h=hrvAnalysis(b);`);
  const ratio=a.run('h.freq.lfhf');
  assert.ok(ratio>0.8 && ratio<1.25,'LF/HF='+ratio);
});
test('HRV withholds spectra across recording gaps', () => {
  const a=app(); a.run('var b=Array.from({length:400},(_,i)=>({t:(i+1)*1000+(i>200?60000:0),rr:1000}));');
  assert.equal(a.run('hrvAnalysis(b).freq'),null);
});
test('low CO2 intervals are detected and never bridge NaN or segment gaps', () => {
  const a=app(); a.run(`var ch={hz:1,segs:[{t0:0,n:40,data:Float32Array.from({length:40},(_,i)=>i===20?NaN:0)}]};`);
  assert.equal(a.run('capnoApnea(ch,[],{t0:0,t1:40000}).longest'),20);
  assert.equal(a.run('capnoApnea(ch,[],{t0:5000,t1:15000}).longest'),10);
  a.run('ch.segs=[{t0:0,n:6,data:new Float32Array(6)},{t0:20000,n:6,data:new Float32Array(6)}]');
  assert.equal(a.run('capnoApnea(ch,[]).longest'),6);
});
test('patient assumptions are saved per case and old global values are ignored', () => {
  const a=app(); a.run(`localStorage.setItem(CFG_KEY,JSON.stringify({heightCm:190,svK:500})); cfgLoad();`);
  assert.equal(a.run('CFG.svK'),null);
  a.run('M.caseId="a"; loadCaseInputs(); CFG.svK=123; CFG.heightCm=180; cfgSave(); M.caseId="b"; loadCaseInputs()');
  assert.equal(a.run('HEMO.svK'),null);
  assert.equal(a.run('HEMO.heightCm'),null);
  a.run('M.caseId="a"; loadCaseInputs()');
  assert.equal(a.run('HEMO.svK'),123);
  assert.equal(a.run('HEMO.heightCm'),180);
});
test('case IDs reset when opening XML followed by raw JSON', () => {
  const a=app({json:JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}}
  ]}]}})});
  a.run('buildModel(json,\'<Case id="first-case"/>\',"first.zol"); buildModel(json,null,"second.json")');
  assert.equal(a.run('M.caseId'),'second');
});
test('self-checks restore the current case and calibration even after an exception', () => {
  const a=app(); a.run('HEMO.svK=456; var before=M.channels; var cache=M._hemoBeats; hemoCompute=()=>{throw new Error("forced failure")};');
  assert.throws(()=>a.run('runHemoSelfTests()'),/forced failure/);
  assert.equal(a.run('M.channels===before && M._hemoBeats===cache'),true);
  assert.equal(a.run('HEMO.svK'),456);
});
test('capnogram analysis reports I/E and applies the declared angle convention', () => {
  const a=app(); a.run(`var ch={name:'CO2',kind:'co2',hz:100,nValid:6000,segs:[{t0:0,n:6000,
    data:Float32Array.from({length:6000},(_,i)=>{const t=(i/100)%6;
      return t<0.4?t*100:t<3.9?40+(t-0.4):t<4.1?43.5*(4.1-t)/0.2:0;})}]};
    M.channels={CO2:ch}; M.chCo2=ch; M.durMs=60000;
    M.breathsCo2=capnoBreaths(ch); var r=sigCompute({t0:0,t1:60000}).results;`);
  assert.ok(a.run('r.ie.value>0.4 && r.ie.value<0.65'));
  assert.ok(a.run('r.alpha.value>90 && r.alpha.value<120'));
  assert.ok(a.run('r.beta.value>70 && r.beta.value<110'));
  assert.equal(a.run('capnoBreathSet(ch,{t0:0,t1:2000}).length'),0);
  assert.ok(a.run('sigTable(r,["Pulmonary"],{showAll:true}).includes("time with CO₂ below threshold")'));
});
test('trailing trend averages cannot see future completed cycles', () => {
  const a=app(); a.run('M.durMs=60000; var s=smoothSeries([{t:10000,v:1},{t:20000,v:2},{t:30000,v:3}]);');
  assert.equal(a.run('s.find(p=>p.t===10000).v'),null);
  assert.equal(a.run('s.find(p=>p.t===30000).v'),2);
});
test('synthetic raw case completes parsing, analysis, and table rendering without visit-order dependencies', () => {
  const recs=[{CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}},
    {DataChannels:{DataChannel:[{ChanType:30,Scalar:1,ScalarType:2}]}}];
  for(let sec=0;sec<60;sec++) {
    recs.push({ContinWaveRec:{StdHdr:{ElapsedTime:sec},Waveform:{WaveRec:{WaveType:30,
      WaveTypeVar:'IBP 1',SampleTime:8000,UnpackedSamples:Array.from({length:125},(_,i)=>{
        const phase=((sec+i/125)*1.25)%1;
        return 70+50*Math.exp(-Math.pow((phase-0.2)/0.12,2));
      })}}}});
    recs.push({TrendRpt:{StdHdr:{ElapsedTime:sec},Trend:{Resp:{TrendData:{DataState:'valid',Val:12}}}}});
  }
  const a=app({json:JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:recs}]}})});
  a.run(`buildModel(json,null,'integration.json'); loadCaseInputs(); detectBeats(); loadSites();
    buildParams(); buildHemoParams(); var first=sigCompute(wholeCase());
    var h=hemoCompute(wholeCase()); var second=sigCompute(wholeCase());`);
  assert.equal(a.run('M.durMs'),60000);
  assert.ok(a.run('h.results.sbp.valid'));
  assert.equal(a.run('JSON.stringify(first.results)===JSON.stringify(second.results)'),true);
  assert.ok(a.run('sigTable(second.results,["Pulmonary","Cardiac","Cross-signal"],{showAll:true}).length>100'));
  assert.equal(a.run('syncQuality().errorMs'),null);
});
function arterialCase(a) {
  a.run(`var art=synthArterial({hr:75,sys:120,dia:70});
    M.channels={[art.name]:art}; M.durMs=60000; HV.scope='all';
    M.ibpSite={1:'ART'}; M.beatsByChan={[art.name]:pulseDetect(art)};
    M.trends=Array.from({length:6},(_,i)=>({t:i*10000,hr:75,spo2:96,
      ibp:[{ch:1,sys:120,dia:70,map:87}]}));`);
}
test('default haemodynamics hide missing-input rows but retain available measurements and signal failures', () => {
  const a=app(); arterialCase(a);
  const markup=a.run('renderHemoPanel()');
  for(const id of ['sv','svi','co','ci','svr','svri','ea','eadyn','cpo','cpi','bsa'])
    assert.ok(!markup.includes('data-hemo-val="'+id+'"'),id+' must be hidden');
  for(const id of ['sbp','dbp','map','pp','pr','ppv','svv'])
    assert.ok(markup.includes('data-hemo-val="'+id+'"'),id+' must remain available');
  assert.ok(markup.includes('no respiratory cycle timing'));
  assert.ok(!markup.includes('no calibration constant'));
});
test('dependent results appear only after each required input is supplied', () => {
  const a=app(); arterialCase(a);
  a.run('applyCaseInputDraft({svK:"266"})');
  let markup=a.run('renderHemoPanel()');
  assert.ok(markup.includes('data-hemo-val="co"'));
  assert.ok(!markup.includes('data-hemo-val="ci"'));
  assert.ok(!markup.includes('data-hemo-val="svr"'));
  a.run('applyCaseInputDraft({heightCm:"175",weightKg:"75",assumedCvp:"0"})');
  markup=a.run('renderHemoPanel()');
  for(const id of ['bsa','svi','ci','svri','cpi','svr']) assert.ok(markup.includes('data-hemo-val="'+id+'"'));
  assert.ok(!markup.includes('data-hemo-val="eadyn"'));
  a.run('applyCaseInputDraft({svK:""})');
  markup=a.run('renderHemoPanel()');
  assert.ok(!markup.includes('data-hemo-val="co"'));
  assert.ok(markup.includes('data-hemo-val="bsa"'));
});
test('recorded anthropometry works without overrides or a calibration constant', () => {
  const a=app(); arterialCase(a);
  a.run(`M.patient={Height:{'#text':175,'@Units':'cm'},Weight:{'#text':75,'@Units':'kg'}}`);
  assert.ok(a.run('renderHemoPanel().includes(\'data-hemo-val="bsa"\')'));
  assert.equal(a.run('HEMO.heightCm'),null);
  assert.equal(a.run('HEMO.svK'),null);
});
test('S/F ratio is hidden without known FiO2 and uses percentage input correctly', () => {
  const a=app(); arterialCase(a);
  assert.ok(!a.run('sigTable(sigCompute(wholeCase()).results,["Pulmonary"],{showAll:true})').includes('SpO₂/FiO₂ ratio'));
  a.run('applyCaseInputDraft({fio2:"40"})');
  assert.equal(a.run('CFG.fio2'),0.4);
  assert.equal(a.run('sigCompute(wholeCase()).results.sf_ratio.value'),240);
  assert.ok(a.run('sigTable(sigCompute(wholeCase()).results,["Pulmonary"],{showAll:true})').includes('SpO₂/FiO₂ ratio'));
  a.run('applyCaseInputDraft({fio2:""})');
  assert.ok(!a.run('sigTable(sigCompute(wholeCase()).results,["Pulmonary"],{showAll:true})').includes('SpO₂/FiO₂ ratio'));
});
test('optional inputs start open, are labeled, and are limited to data relevant to the case', () => {
  const a=app();
  assert.equal(a.run('renderCaseInputs()'),'');
  arterialCase(a);
  const markup=a.run('renderCaseInputs()');
  assert.ok(markup.includes('<details class="caseinputs" id="caseInputs" open>'));
  a.run('CASE_INPUT_UI.open=false');
  assert.ok(a.run('renderCaseInputs()').includes('<details class="caseinputs" id="caseInputs">'));
  a.run('CASE_INPUT_UI.open=true');
  for(const key of ['heightCm','weightKg','svK','assumedCvp','fio2'])
    assert.ok(markup.includes('for="caseInput_'+key+'"'));
  assert.ok(!script.includes('id="cfgSvK"'));
  assert.ok(!script.includes('id="cfgHt"'));
  a.run('M.channels={}; M.ibpSite={}');
  const oxygenOnly=a.run('renderCaseInputs()');
  assert.ok(oxygenOnly.includes('caseInput_fio2'));
  assert.ok(!oxygenOnly.includes('caseInput_svK'));
});
test('invalid optional inputs fail atomically and never become authored defaults', () => {
  const a=app();
  for(const draft of ['{svK:"0"}','{svK:"-1"}','{svK:"Infinity"}','{fio2:"0.4"}',
    '{fio2:"101"}','{weightKg:"NaN"}','{heightCm:"175",weightKg:"0"}']) {
    assert.throws(()=>a.run('applyCaseInputDraft('+draft+')'));
    assert.equal(a.run('CFG.heightCm'),null);
    assert.equal(a.run('HEMO.svK'),null);
  }
  a.run('M.caseId="bad-inputs"; localStorage.setItem("zollviewer:inputs:bad-inputs",JSON.stringify({svK:-10,weightKg:0,fio2:40})); loadCaseInputs()');
  assert.equal(a.run('HEMO.svK'),null);
  assert.equal(a.run('CFG.fio2'),null);
});
test('applying and clearing case inputs updates parameter lists and exported selections', () => {
  const a=app(); arterialCase(a);
  a.run('renderPhysPane=()=>{}; refreshParamViews=()=>{}; M.caseId="selection"; applyCaseInputDraft({svK:"266"}); refreshCaseInputResults(); SEL.ids=["co","ibp1"];');
  assert.ok(a.run('!!M.paramById.co'));
  a.run('applyCaseInputDraft({svK:""}); refreshCaseInputResults()');
  assert.equal(a.run('!!M.paramById.co'),false);
  assert.equal(a.run('SEL.ids.includes("co")'),false);
  assert.equal(a.run('SEL.ids.includes("ibp1")'),true);
  assert.equal(a.run('JSON.parse(localStorage.getItem("zollviewer:inputs:selection")).svK'),null);
});
test('optional form blocks invalid edits, applies valid inputs, and clears them through its controls', () => {
  let focused=null;
  const node=id=>({focus:()=>{focused=id;},setAttribute(){}});
  const fields=[{dataset:{caseInput:'heightCm'},value:'175'},
    {dataset:{caseInput:'weightKg'},value:'bad'},{dataset:{caseInput:'svK'},value:'266'}];
  const nodes={
    '#caseInputs':{open:true}, '#caseInputsForm':{querySelectorAll:()=>fields},
    '#caseInputsError':{}, '#caseInput_weightKg':node('weight'),
    '#caseInputsApply':node('apply'), '#caseInputsClear':{}
  };
  const a=app({document:{querySelector:s=>nodes[s]}}); arterialCase(a);
  a.run('M.caseId="form-case"; renderPhysPane=()=>{}; refreshParamViews=()=>{}; toast=()=>{}; wireCaseInputs()');
  nodes['#caseInputsForm'].onsubmit({preventDefault(){}});
  assert.equal(a.run('HEMO.heightCm'),null);
  assert.equal(a.run('HEMO.svK'),null);
  assert.equal(nodes['#caseInputsError'].hidden,false);
  assert.match(nodes['#caseInputsError'].textContent,/Weight/);
  assert.equal(focused,'weight');
  fields[1].value='75';
  nodes['#caseInputsForm'].onsubmit({preventDefault(){}});
  assert.equal(a.run('HEMO.svK'),266);
  assert.ok(a.run('!!M.paramById.co'));
  assert.equal(focused,'apply');
  nodes['#caseInputsClear'].onclick();
  assert.equal(a.run('HEMO.svK'),null);
  assert.equal(a.run('!!M.paramById.co'),false);
  assert.equal(a.run('JSON.parse(localStorage.getItem("zollviewer:inputs:form-case")).heightCm'),null);
});
test('BSA formula choice stays with its case', () => {
  const a=app();
  a.run('M.caseId="formula-a"; applyCaseInputDraft({bsaFormula:"mosteller"}); cfgSave(); M.caseId="formula-b"; loadCaseInputs()');
  assert.equal(a.run('HEMO.bsaFormula'),'dubois');
  a.run('M.caseId="formula-a"; loadCaseInputs()');
  assert.equal(a.run('HEMO.bsaFormula'),'mosteller');
});

function multiSignalCase(a, withArterial = true) {
  a.run(`var art=synthArterial({hr:75});
    var ecg={name:'ECG II',kind:'ecg',isEcg:true,hz:250,nValid:15000,vmin:0,vmax:1,
      segs:[{t0:0,n:15000,data:Float32Array.from({length:15000},(_,i)=>
        Math.exp(-Math.pow(((i/250)%0.8-0.6)/0.018,2)))}]};
    var pleth={...art,name:'Pleth',kind:'spo2',vmin:0,vmax:1,
      segs:art.segs.map(s=>({...s,t0:s.t0+150,data:Float32Array.from(s.data,v=>(v-70)/50)}))};
    M.channels={[ecg.name]:ecg,[pleth.name]:pleth};
    ${withArterial ? 'M.channels[art.name]=art;' : ''}
    M.ibpSite={1:'ART'}; M.durMs=60000; M.t0Wall=0;
    M.trends=[]; HV.scope=60000; APP.cursor=60000; detectBeats();`);
}

test('cross-signal results use recorded ECG, arterial and pleth even when every trace is hidden', () => {
  const a=app(); multiSignalCase(a);
  a.run(`HV.chans=Object.keys(M.channels); var shown=sigCompute();
    HV.chans=[]; APP.hidden=new Set(Object.keys(M.channels));
    detectBeats(); var hidden=sigCompute();`);
  for(const id of ['pat_art','pat_ppg','deficit']) {
    assert.equal(a.run(`shown.results.${id}.valid`),true,id+' fixture must produce a result');
    assert.equal(a.run(`JSON.stringify(shown.results.${id})===JSON.stringify(hidden.results.${id})`),true);
  }
  assert.equal(a.run('visibleChannels().length'),0);
  assert.ok(a.run('anSectionHtml("cross",{sig:hidden}).includes(\'data-sig-val="pat_ppg"><b>\')'));
});

for(const withArterial of [true,false]) test('cursor refresh updates hidden-signal results '+(withArterial?'with':'without')+' arterial rows', () => {
  let now=2000;
  const label={}, cross={innerHTML:'',querySelectorAll:()=>[]};
  const box={querySelector:s=>s==='.anwrap'?{}:s==='[data-section-content="cross"]'?cross:null,
    querySelectorAll:s=>s==='[data-hemo-scope]'?[label]:[]};
  const a=app({performance:{now:()=>now},document:{querySelector:s=>s==='#hemoBody'?box:null}});
  multiSignalCase(a,withArterial);
  a.run('HV.chans=[]; APP.hidden=new Set(Object.keys(M.channels)); APP.cursor=0; refreshHemoValues(true)');
  const initial=cross.innerHTML;
  const initialLabel=label.textContent;
  assert.ok(!initial.includes('data-sig-val="pat_ppg"><b>'));
  a.run('APP.cursor=60000'); now=2500;
  a.run('refreshHemoValues()');
  assert.equal(cross.innerHTML,initial,'playback must respect its refresh interval');
  now=3101; a.run('refreshHemoValues()');
  assert.ok(cross.innerHTML.includes('data-sig-val="pat_ppg"><b>'));
  assert.notEqual(label.textContent,initialLabel);
  assert.match(label.textContent,/^last 1 min to /);
  a.run('APP.cursor=0; refreshHemoValues(true)');
  assert.equal(cross.innerHTML,initial,'a manual seek must refresh immediately');
});

test('section navigation reveals hidden sections and never toggles a shown section off', () => {
  let scrolls=0, focused=0;
  const jump={dataset:{jump:'cross'}}, checkbox={dataset:{sec:'cross'},checked:true,focus(){}};
  const target={setAttribute(){},focus(){focused++;},scrollIntoView(){scrolls++;}};
  const nodes={'#review':{},'#review #an_cross':target,'#review input[data-sec="cross"]':checkbox};
  const a=app({document:{querySelector:s=>nodes[s]||null,querySelectorAll:s=>
    s==='#review .anjump'?[jump]:s==='#review .anidx input'?[checkbox]:[]}});
  a.run(`var navState={cross:true}, renders=0;
    wireSidebar('#review',[{id:'cross',label:'Cross-signal'}],navState,()=>renders++);`);
  jump.onclick();
  assert.equal(a.run('navState.cross'),true);
  assert.equal(a.run('renders'),0);
  checkbox.checked=false; checkbox.onchange({stopPropagation(){}});
  assert.equal(a.run('navState.cross'),false);
  jump.onclick();
  assert.equal(a.run('navState.cross'),true);
  assert.equal(a.run('renders'),2);
  assert.equal(scrolls,2); assert.equal(focused,2);
});

// Exercise the real renderer, seek and animation loop; only browser drawing/DOM primitives
// are replaced. Result HTML comes from the viewer, rather than hand-authored fixture cells.
function physiologyPlayback() {
  let now=2000;
  const sections=new Map(), labels=[];
  function contentNode() {
    let markup='', cells=[];
    return {get innerHTML(){return markup;},set innerHTML(v){
      markup=v; cells=Array.from(v.matchAll(/data-hemo-live="([^"]+)">([\s\S]*?)<\/span>/g),
        m=>({dataset:{hemoLive:m[1]},innerHTML:m[2]}));
    }, querySelectorAll:s=>s==='[data-hemo-live]'?cells:[]};
  }
  const body={querySelector:s=>s==='.anwrap'?{}:
    sections.get((s.match(/data-section-content="([^"]+)"/)||[])[1])||null,
    querySelectorAll:s=>s==='[data-hemo-live]'?Array.from(sections.values()).flatMap(n=>n.querySelectorAll(s)):
      s==='[data-hemo-scope]'||s==='[data-hemo-beat-status]'?labels:[],
    set innerHTML(value){
      sections.clear();
      for(const m of value.matchAll(/data-section-content="([^"]+)">([\s\S]*?)<\/section>/g)){
        const n=contentNode(); n.innerHTML=m[2].replace(/<\/div>$/,''); sections.set(m[1],n);
      }
    }};
  const context=new Proxy({measureText:t=>({width:String(t).length*6})},
    {get:(o,k)=>k in o?o[k]:()=>{}});
  const canvas=h=>({getBoundingClientRect:()=>({width:900,height:h,left:0}),getContext:()=>context});
  const nodes={'#hemoBody':body,'#hemoWave':canvas(180),'#hemoScrub':canvas(44),
    '#hvScope':{},'#hvWin':{},'#clock':{},'#elapsed':{},'#tlCursor':{style:{}},
    '#btnPlay':{classList:{toggle(){}}}};
  const frames=[];
  const a=app({performance:{now:()=>now},window:{devicePixelRatio:1},
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    document:{querySelector:s=>nodes[s]||null,querySelectorAll:()=>[]}});
  multiSignalCase(a);
  a.run(`APP.view='hemo'; updateNowLine=()=>{}; selectEventNear=()=>{};
    for(const s of art.segs) for(let i=0;i<s.n;i++) if(i>=2000) s.data[i]+=40;
    M.beatsByChan[art.name]=pulseDetect(art); buildParams(); buildHemoParams();
    HV.chans=[art.name]; HV.anchor=0;`);
  return {a,body,nodes,sections,frames,setNow:v=>{now=v;},
    live:id=>body.querySelectorAll('[data-hemo-live]').find(c=>c.dataset.hemoLive===id)?.innerHTML};
}

test('actual playback updates the latest beat before the slower analysis-window refresh', () => {
  const h=physiologyPlayback(), a=h.a;
  a.run('APP.cursor=15000; renderPhysPane(); refreshHemoValues(true); setPlaying(true); APP.speed=20');
  assert.match(h.live('sbp'),/<b>120<\/b>/);
  const windowMarkup=h.sections.get('haemo').innerHTML;
  h.setNow(2200); h.frames.shift()(2200);
  assert.equal(a.run('APP.cursor'),19000);
  assert.match(h.live('sbp'),/<b>160<\/b>/);
  assert.equal(h.sections.get('haemo').innerHTML,windowMarkup,'window summary is separately throttled');
  assert.ok(h.frames.length>0,'playback schedules its next frame');
  assert.ok(h.nodes['#hemoWave']._hv,'the waveform renderer ran');
});

test('live waveform values also follow the cursor in whole-case mode', () => {
  const h=physiologyPlayback(), a=h.a;
  a.run('HV.scope="all"; APP.cursor=15000; renderPhysPane()');
  const summary=h.sections.get('haemo').innerHTML;
  assert.match(h.live('sbp'),/<b>120<\/b>/);
  a.run('seek(19000,true)');
  assert.match(h.live('sbp'),/<b>160<\/b>/);
  assert.equal(h.sections.get('haemo').innerHTML,summary,'whole-case summaries remain whole-case');
});

test('live beat values never reveal a future cycle, carry across missing data, or show clipped beats', () => {
  const h=physiologyPlayback(), a=h.a;
  a.run('APP.cursor=10000; renderPhysPane(); var b=hemoLiveBeat();');
  assert.equal(a.run('Math.max(b.tEnd,b.t+b.rr)<=APP.cursor'),true);
  a.run('APP.cursor=0; refreshHemoValues(true)');
  assert.ok(!h.live('sbp').includes('<b>'));
  a.run(`APP.cursor=10000; var b=hemoLiveBeat(); b.clip=true; refreshLiveHemoValues(document.querySelector('#hemoBody'))`);
  assert.ok(!h.live('sbp').includes('<b>'));
  a.run(`b.clip=false; art.segs[0].data[1250]=NaN; refreshLiveHemoValues(document.querySelector('#hemoBody'))`);
  assert.ok(!h.live('sbp').includes('<b>'));
  a.run('APP.cursor=60000');
  assert.ok(a.run('hemoLiveBeat()!=null'),'the case endpoint can use the last recorded sample');
});

test('playback pages one full sweep at the right edge, at every supported sweep width', () => {
  const h=physiologyPlayback(), a=h.a;
  for(const win of [2000,4000,8000,15000,30000]){
    a.run(`APP.playing=false; HV.win=${win}; HV.anchor=0; APP.cursor=${win-100}; renderPhysPane();
      APP.playing=true; APP.lastFrame=2000; APP.speed=1;`);
    h.setNow(2100); a.run('tick(2100)');
    assert.equal(a.run('HV.anchor'),win);
    assert.equal(h.nodes['#hemoWave']._hv.t0,win);
    assert.equal(h.nodes['#hemoWave']._hv.t1,win*2);
  }
  a.run('HV.win=2000; HV.anchor=0; APP.cursor=0; APP.lastFrame=2100; APP.speed=20');
  h.setNow(2350); a.run('tick(2350)');
  assert.equal(a.run('HV.anchor'),4000,'fast playback can skip multiple complete pages');
  a.run('HV.win=8000; HV.anchor=48000; seek(56000,true)');
  assert.equal(a.run('HV.anchor'),52000,'the final page stays inside the recording');
  a.run('APP.playing=false; HV.anchor=8000; seek(16000,true)');
  assert.equal(a.run('HV.anchor'),8000,'a paused cursor at the edge does not move the view');
});

test('playback refreshes ventilation, venous pressure and device comparisons over the selected window', () => {
  const h=physiologyPlayback(), a=h.a;
  a.run(`var cvp={...art,name:'IBP 2',kind:'ibp2',segs:[{t0:0,n:7500,
    data:Float32Array.from({length:7500},(_,i)=>i<3750?8:18)}]};
    M.channels[cvp.name]=cvp; M.ibpSite[2]='CVP';
    M.vents=[0,5000,10000,15000,20000,25000,30000,33000,36000,39000,42000,45000,48000,51000,54000,57000];
    M.trends=[{t:10000,ibp:[{ch:1,sys:120,dia:70,map:87}]},
      {t:45000,ibp:[{ch:1,sys:180,dia:100,map:127}]}];
    HV.scope=30000; APP.cursor=29000; renderPhysPane();`);
  let markup=h.sections.get('haemo').innerHTML;
  assert.ok(markup.includes('data-hemo-device="sbp">120'));
  assert.match(markup,/Ventilation<\/div><div class="v">12/);
  assert.match(markup,/CVP<\/div><div class="v">8/);
  a.run('seek(59999,true)');
  markup=h.sections.get('haemo').innerHTML;
  assert.ok(markup.includes('data-hemo-device="sbp">180'));
  assert.match(markup,/Ventilation<\/div><div class="v">20/);
  assert.match(markup,/CVP<\/div><div class="v">18/);
});

function eventPanelHarness() {
  const media={matches:false,addEventListener(type,fn){this.onchange=fn;}}, frames=[];
  const classes=new Set(), attrs={}, toggleAttrs={};
  const document={activeElement:null};
  const hide={}, toggle={setAttribute:(k,v)=>{toggleAttrs[k]=v;}, classList:{toggle(){}},
    focus(){document.activeElement=toggle;}};
  const panel={classList:{contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},
    setAttribute:(k,v)=>{attrs[k]=v;},contains:n=>n===hide};
  const nodes={'#side':panel,'#btnSide':toggle,'#btnHideEvents':hide,
    '#app':{classList:{contains:()=>true}},'#hemoWave':{},'#hemoScrub':{}};
  document.querySelector=s=>nodes[s]||null;
  const a=app({document,window:{matchMedia:()=>media},requestAnimationFrame:fn=>frames.push(fn)});
  a.run(`var redraws=[]; layoutReviewPane=()=>redraws.push('layout');
    drawHemoWave=()=>redraws.push('wave'); drawHemoScrub=()=>redraws.push('scrub');
    drawTimeline=()=>redraws.push('timeline'); APP.view='hemo'; wireEventPanel();`);
  return {a,media,frames,classes,attrs,toggleAttrs,document,hide,toggle};
}

test('the event-list icon hides and restores the desktop list, remember the choice and resize Physiology', () => {
  const h=eventPanelHarness(), a=h.a;
  assert.equal(h.toggleAttrs['aria-label'],'Hide event list');
  assert.equal(h.toggleAttrs['aria-expanded'],'true');
  a.run('APP.cursor=12345; APP.playing=true');
  h.document.activeElement=h.hide; h.toggle.onclick();
  assert.equal(h.classes.has('collapsed'),true);
  assert.equal(h.attrs['aria-hidden'],'true');
  assert.equal(h.toggleAttrs['aria-label'],'Show event list');
  assert.equal(h.document.activeElement,h.toggle,'focus stays in the visible interface');
  assert.equal(a.run('JSON.parse(localStorage.getItem(CFG_KEY)).eventsVisible'),false);
  a.run('CFG.eventsVisible=true; cfgLoad(); syncEventPanel()');
  assert.equal(h.classes.has('collapsed'),true,'saved visibility survives settings reload');
  h.frames.shift()();
  assert.deepEqual(Array.from(a.run('redraws')),['layout','wave','scrub','timeline']);
  assert.equal(a.run('APP.cursor'),12345); assert.equal(a.run('APP.playing'),true);
  h.toggle.onclick();
  assert.equal(h.classes.has('collapsed'),false);
  assert.equal(h.toggleAttrs['aria-expanded'],'true');
  assert.equal(a.run('JSON.parse(localStorage.getItem(CFG_KEY)).eventsVisible'),true);
});

test('a desktop-hidden event list can reopen on mobile without changing the desktop preference', () => {
  const h=eventPanelHarness(), a=h.a;
  h.toggle.onclick();
  h.media.matches=true; h.media.onchange();
  assert.equal(h.toggleAttrs['aria-label'],'Show event list');
  h.toggle.onclick();
  assert.equal(h.classes.has('mobopen'),true);
  assert.equal(h.classes.has('collapsed'),false);
  assert.equal(h.toggleAttrs['aria-expanded'],'true');
  assert.equal(a.run('CFG.eventsVisible'),false);
  h.toggle.onclick();
  assert.equal(h.classes.has('mobopen'),false);
  assert.equal(h.toggleAttrs['aria-expanded'],'false');
  h.media.matches=false; h.media.onchange();
  assert.equal(h.classes.has('collapsed'),true);
  h.toggle.onclick();
  assert.equal(h.classes.has('collapsed'),false);
});

test('vitals NIBP cycle grid follows the case interval and lands on cuff readings', () => {
  const a = app();
  // 5-min cycles, switched to 15 min at +4:27; readings at +4:31, +15:26, +31:15; one aborted cycle at +45
  a.run(`M.durMs = 50*60000; M.nibpAuto = [{t:0,min:5},{t:266500,min:15}];
    M._nibp = [{t:271000},{t:926000},{t:1875000}];`);
  assert.deepEqual(Array.from(a.run('nibpCycleGrid()')), [271000, 926000, 1875000, 2700000]);
  a.run('M.nibpAuto = []');
  assert.equal(a.run('nibpCycleGrid()'), null);
  assert.equal(a.run('parseEvery("device")'), 'device');
  assert.equal(a.run('parseEvery("300000")'), 300000);
});

test('every invasive line with data is shown unless it was deliberately unticked', () => {
  const a = app();
  a.run(`M.params = ['hr_dev','nibp','ibp1','ibp2','ibp3'].map(id=>({id}));
    M.paramById = Object.fromEntries(M.params.map(p=>[p.id,p]));
    localStorage.setItem(SEL_KEY, JSON.stringify(['hr_dev','nibp'])); selLoad();`);
  assert.equal(a.run('SEL.ids.join()'), 'hr_dev,nibp,ibp1,ibp2,ibp3');
  a.run(`refreshParamViews = ()=>{}; selToggle('ibp2', false); selLoad();`);
  assert.equal(a.run('SEL.ids.join()'), 'hr_dev,nibp,ibp1,ibp3');
  a.run(`delete M.paramById.ibp3; M.params = M.params.filter(p=>p.id!=='ibp3'); selLoad();`);
  assert.equal(a.run('SEL.ids.join()'), 'hr_dev,nibp,ibp1');
});

test('vitals list adds a row when a shown invasive line was zeroed, and only when asked', () => {
  const a = app();
  a.run(`M.params = ['nibp','ibp1','ibp2'].map(id=>({id, label:id, sub:{sys:[],dia:[],map:[]}}));
    M.paramById = Object.fromEntries(M.params.map(p=>[p.id,p]));
    SEL.ids = ['nibp','ibp1']; M.durMs = 600000; M.nibpAuto = [{t:0,min:5}]; M._nibp = [{t:1}];
    M.events = [{kind:'annotation', t:95000, name:'IBP Probe1 Zeroed'},
                {kind:'annotation', t:96000, name:'IBP Probe2 Zeroed'},
                {kind:'annotation', t:97000, name:'IBP Probe1 Connected'}];
    VIT.every = 'device'; VIT.showZero = true;`);
  const z = a.run('JSON.stringify(vitalRows().filter(r=>r.zero).map(r=>[r.t, r.cells.map(c=>c.txt)]))');
  assert.equal(z, JSON.stringify([[95000, ['', 'zeroed']]]));
  a.run('VIT.showZero = false');
  assert.equal(a.run('vitalRows().some(r=>r.zero)'), false);
});

test('pacer pulses come from bit 2 of ECG sample status, merged across leads', () => {
  const a = app();
  const wave = (name, status) => ({WaveRec:{WaveType:name==='IBP'?18:3, WaveTypeVar:name, SampleTime:4000,
    UnpackedSamples: status.map(() => 10), SampleStatus: status}});
  a.run(`buildModel(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}},
    {DataChannels:{DataChannel:[{ChanType:3,Scalar:1,ScalarType:1},{ChanType:18,Scalar:10,ScalarType:2}]}},
    {ContinWaveRec:{StdHdr:{ElapsedTime:0}, Waveform:[
      ${JSON.stringify(wave('12-Lead II', [0,0,2,8,8,0,0,0,0,1]))},
      ${JSON.stringify(wave('12-Lead III', [0,0,10,8,8,0,0,0,0,1]))},
      ${JSON.stringify(wave('IBP', [0,0,0,0,0,2,0,0,0,0]))}]}}
  ]}]}}),null,'synthetic.json')`);
  assert.deepEqual(Array.from(a.run('M.pace')), [8]);
});

test('off-scale readings and alarm flags are kept, and shown instead of a stale value', () => {
  const a = app();
  a.run(`buildModel(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:120}},
    {TrendRpt:{StdHdr:{ElapsedTime:0},Trend:{Hr:{TrendData:{DataState:'valid',Val:70,Alarm:0}}}}},
    {TrendRpt:{StdHdr:{ElapsedTime:30},Trend:{Hr:{TrendData:{DataState:'---',Val:16,Alarm:1}},
      Ibp:{'@ChanNum':1,Sys:{TrendData:{DataState:'+++',Val:303}},Dia:{TrendData:{DataState:'valid',Val:60}},
        Map:{TrendData:{DataState:'valid',Val:80,Alarm:1}}}}}}
  ]}]}}),null,'synthetic.json')`);
  assert.equal(a.run('JSON.stringify(M.trends[1].fl.hr)'), JSON.stringify({range:'low', alarm:true, raw:16}));
  a.run(`M.paramById = {hr_dev:{id:'hr_dev', label:'HR', pts:[{t:0,v:70},{t:30000,v:null}]},
    ibp1:{id:'ibp1', label:'P1', sub:{sys:[{t:30000,v:null}], dia:[{t:30000,v:60}], map:[{t:30000,v:80}]}}};
    M.params = Object.values(M.paramById); SEL.ids = ['hr_dev','ibp1']; VIT.every = 'trend'; VIT.showZero = false;`);
  const last = JSON.parse(a.run('JSON.stringify(vitalRows()[1].cells.map(c=>[c.txt,c.alarm,c.range]))'));
  assert.deepEqual(last, [['---', true, 'low'], ['+++/60 (80)', true, 'high']]);
});

test('ECG scale comes from the file, and recalibrating leaves 12-lead traces alone', () => {
  const a = app();
  a.run(`buildModel(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}},
    {DataChannels:{DataChannel:[{ChanType:3,Scalar:2500,ScalarType:1}]}},
    {ContinWaveRec:{StdHdr:{ElapsedTime:0}, Waveform:{WaveRec:{WaveType:3, WaveTypeVar:'12-Lead II',
      SampleTime:4000, UnpackedSamples:[0,400,0,-400]}}}}
  ]}]}}),null,'synthetic.json')`);
  assert.equal(a.run('M.ecgCountsPerMv'), 400);
  assert.equal(a.run('M.ecgCalSource'), 'file');
  assert.equal(a.run('M.channels["12-Lead II"].segs[0].data[1]'), 1);
  a.run(`M.snapshots=[{kind:'Ecg12LeadRec', traces:[{isEcg:true, data:Float32Array.from([1])}]}]; applyEcgCal(200)`);
  assert.equal(a.run('M.channels["12-Lead II"].segs[0].data[1]'), 2);
  assert.equal(a.run('M.snapshots[0].traces[0].data[0]'), 1);
});

test('QRS axis prefers the device value and ignores its not-measured sentinel', () => {
  const a = app();
  assert.equal(a.run(`ecgAxis({interpretation:{QrsAxis:55}, traces:[]}).degrees`), 55);
  assert.equal(a.run(`ecgAxis({interpretation:{QrsAxis:-2147483648}, traces:[]})`), null);
});

test('an R-R interval across a recording gap is not reported as a pause', () => {
  const a = app();
  // 60 bpm beats in two segments separated by a 30 s gap
  a.run(`(()=>{ const hz=250, mk=(t0,s)=>{ const n=s*hz, d=new Float32Array(n);
      for(let i=0;i<n;i++){ const ph=(i%hz); d[i]= ph<6 ? (ph<3?ph:6-ph)*0.4 : 0; } return {t0, n, data:d}; };
    globalThis.CH={hz, isEcg:true, segs:[mk(0,20), mk(50000,20)]}; })()`);
  const pauses = a.run('JSON.stringify(ecgRhythm(ecgBeats(CH)).pauses)');
  assert.equal(pauses, '[]');
});

test('a pressure shows one reading, never parts of two', () => {
  const a = app();
  const r = JSON.parse(a.run(`JSON.stringify(paramAt({sub:{
    sys:[{t:0,v:73},{t:60000,v:141}], dia:[{t:0,v:48},{t:60000,v:null}], map:[{t:0,v:56},{t:60000,v:null}]}}, 60000))`));
  assert.deepEqual([r.sys, r.dia, r.map], [141, null, null]);
});

test('vitals leave a cell empty once its value is stale, and still show a mean-only pressure', () => {
  const a = app();
  a.run(`M.durMs=600000; M.trends=[]; M.nibpAuto=[]; M._nibp=[];
    M.paramById={spo2:{id:'spo2', label:'SpO2', pts:[{t:0,v:95}]},
      ibp2:{id:'ibp2', label:'CVP', sub:{sys:[{t:0,v:null}], dia:[{t:0,v:null}], map:[{t:0,v:9}]}}};
    M.params=Object.values(M.paramById); SEL.ids=['spo2','ibp2']; VIT.every=60000; VIT.showZero=false; VIT.onlyChanges=false;
    firstValidTime=()=>0;`);
  const rows = JSON.parse(a.run('JSON.stringify(vitalRows().map(r=>[r.t, r.cells.map(c=>c.txt)]))'));
  assert.deepEqual(rows[0], [0, ['95', '--/-- (9)']]);
  assert.deepEqual(rows[2], [120000, ['', '']]);
});

test('flush-test damping matches a known second-order response', () => {
  const a = app();
  a.run(`(()=>{ const hz=1000, zeta=0.10, fn=15, wn=2*Math.PI*fn, wd=wn*Math.sqrt(1-zeta*zeta);
    const d=[]; for(let i=0;i<500;i++) d.push(100); for(let i=0;i<300;i++) d.push(300);
    for(let i=0;i<1500;i++){ const t=i/hz; d.push(100+150*Math.exp(-zeta*wn*t)*Math.cos(wd*t)); }
    M.events=[]; globalThis.FT=flushTests({hz, segs:[{t0:0, n:d.length, data:Float32Array.from(d)}]}); })()`);
  const r = JSON.parse(a.run('JSON.stringify(FT[0])'));
  assert.ok(Math.abs(r.zeta-0.10) < 0.02, 'zeta '+r.zeta);
  assert.ok(Math.abs(r.fn-15) < 1.5, 'fn '+r.fn);
});

test('device times are read as wall clock, not local time, and odd records do not stop loading', () => {
  const a = app();
  assert.equal(a.run(`devTime('2026-11-01T01:30:00')`), Date.UTC(2026,10,1,1,30,0));
  assert.equal(a.run(`fmtClock(devTime('2026-11-01T01:30:05'))`), '01:30:05');
  a.run(`buildModel(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    null, {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}},
    {ContinWaveRec:{StdHdr:{ElapsedTime:0}, Waveform:[null]}},
    {DisplayInfo:{StdHdr:{DevDateTime:'2020-01-01T00:20:00'}, ParmNibpAutoModeInterval:15}},
    {DisplayInfo:{StdHdr:{DevDateTime:'2020-01-01T00:00:00'}, ParmNibpAutoModeInterval:5}},
    {DisplayInfo:{StdHdr:{DevDateTime:'2020-01-01T00:05:00'}, ParmNibpAutoModeInterval:15}}
  ]}]}}),null,'synthetic.json')`);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(M.nibpAuto.map(x=>[x.t,x.min]))')), [[0,5],[300000,15]]);
});

test('CPR periods: empty containers mean none, and compression fraction uses time in arrest', () => {
  const a = app();
  const xml = '<CaseReview><CprPeriodsMode>1</CprPeriodsMode><UserCprPeriods />' +
    '<CprPausePeriods><CprPausePeriod Start="720" End="760"/></CprPausePeriods>' +
    '<RoscPeriods><RoscPeriod Start="900" End="2100"/></RoscPeriods></CaseReview>';
  a.run(`globalThis.X=${JSON.stringify(xml)};`);
  assert.equal(a.run(`parsePeriods(X,'UserCprPeriods').length`), 0);
  assert.equal(a.run(`parsePeriods(X,'CprPeriods').length`), 0);
  assert.equal(a.run(`JSON.stringify(parsePeriods(X,'RoscPeriods'))`), JSON.stringify([{t0:900000,t1:2100000}]));
  // 10 min of CPR (600-1200 s) with one 40 s pause, then ROSC from 1200 s
  a.run(`M.durMs=3000000; M.cpr={periods:[{t0:600000,t1:1200000}], pauses:[{t0:720000,t1:760000}],
    rosc:[{t0:1200000,t1:2400000}], autopulse:[], resq:[], comps:[], shocks:[]};`);
  assert.equal(+a.run('cprMetrics().ccf.toFixed(1)'), 93.3);
  a.run(`M.cpr.pauses=[];`);
  assert.equal(+a.run('cprMetrics().ccf.toFixed(1)'), 100);
});

test('ventilation marks come from one source, never two merged', () => {
  const a = app();
  const v = (s0, n) => Array.from({length:n}, (_, i) => `<Ventilation second="${s0+i*5}" ms="0"/>`).join('');
  const xml = `<CaseReview><EtCO2Ventilations>${v(10,20)}</EtCO2Ventilations>` +
    `<ImpedanceVentilations>${v(11,20)}</ImpedanceVentilations></CaseReview>`;
  a.run(`buildModel(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:200}}]}]}}), ${JSON.stringify(xml)}, 'synthetic.json')`);
  assert.equal(a.run('M.vents.length'), 20);
  assert.equal(a.run('M.ventSource'), 'EtCO2Ventilations');
});

test('unrecorded stretches are found and named, and display changes become events', () => {
  const a = app();
  a.run(`M.displayHistory=[{t:0, names:['12-Lead II']}, {t:5000, names:['12-Lead I']}];
    globalThis.CH={name:'12-Lead II', hz:250, segs:[{t0:0, n:1250, data:new Float32Array(1250)}, {t0:9000, n:250, data:new Float32Array(250)}]};`);
  assert.equal(a.run('JSON.stringify(recordingGaps(CH,0,10000))'), JSON.stringify([{t0:5000,t1:9000}]));
  assert.equal(a.run('gapLabel(CH,7000)'), 'not on monitor screen');
  a.run(`M.displayHistory=[{t:0, names:['12-Lead II']}];`);
  assert.equal(a.run('gapLabel(CH,7000)'), 'not recorded');
  a.run(`buildModel(JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:[
    {CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}},
    {TraceConfigs:{StdHdr:{ElapsedTime:1}, TraceConfig:[{AssignedChan:3}]}},
    {TraceConfigs:{StdHdr:{ElapsedTime:30}, TraceConfig:[{AssignedChan:16}]}}
  ]}]}}),null,'synthetic.json')`);
  assert.equal(a.run(`M.events.filter(e=>e.kind==='display').map(e=>e.detail.split('.')[0]).join()`), 'Lead II → SpO₂ pleth');
});

test('every cited source has a link, and every result source exists', () => {
  const a = app();
  const bad = JSON.parse(a.run(`JSON.stringify(Object.entries(SOURCES).filter(([k,s])=>
    !s.cite || !s.use || !['https://doi.org/10.','https://www.fda.gov/','https://physionet.org/'].some(p=>(s.url||'').startsWith(p))).map(([k])=>k))`));
  assert.deepEqual(bad, []);
  const missing = JSON.parse(a.run(`JSON.stringify([
    ...SIG_DEFS.flatMap(d=>[].concat(d.ref||[])), ...Object.values(SIG_REFS).flat(), ...Object.values(HEMO_REFS).flat()
  ].filter(k=>!SOURCES[k]))`));
  assert.deepEqual(missing, []);
  assert.ok(a.run(`sourcesHtml('gardner').includes('href="https://doi.org/10.1097/00000542-198103000-00010"')`));
});

test('paired samples are drawn once per pair, and only when smoothing is on', () => {
  const a = app();
  const pts = held => JSON.parse(a.run(`(()=>{const o=[]; eachDrawPoint(Float32Array.from([69,69,71,71,73,NaN,76,76]),0,7,${held},(i,v)=>o.push([i,v===v?v:null])); return JSON.stringify(o);})()`));
  assert.deepEqual(pts(true), [[0.5,69],[2.5,71],[4,73],[5,null],[6.5,76]]);
  assert.equal(pts(false).length, 8);
});

test('every measure the viewer can show has an explanation, and every explanation cites known sources', () => {
  const a = app();
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'case-viewer.html'), 'utf8');
  const trend = [...html.matchAll(/add\(\{id:'([a-z0-9_]+)', group/g)].map(m=>m[1]);
  const ids = JSON.parse(a.run('JSON.stringify(SIG_DEFS.map(d=>d.id).concat(HEMO_DEFS.map(d=>d.id)))')).concat(trend, ['ibp1','ibp2','ibp3']);
  const missing = JSON.parse(a.run(`JSON.stringify(${JSON.stringify(ids)}.filter(id=>!GLOSS_BY_ID[id]))`));
  assert.deepEqual(missing, []);
  assert.equal(a.run(`GLOSSARY.flatMap(g=>(g.src||[]).filter(k=>!SOURCES[k])).length`), 0);
  assert.ok(a.run(`infoBtn('rpp').includes('data-gloss="rpp"')`));
  assert.equal(a.run(`infoBtn('no_such_measure')`), '');
});

test('every explainer link exists, and a settings backup round-trips without device-only or annotation keys', () => {
  const m = new Map();
  const a = app({localStorage: {getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length(){ return m.size; }}});
  assert.equal(a.run(`GLOSSARY.filter(g=>g.read && !(EXPLAIN[g.read] && EXPLAIN[g.read].url.startsWith('https://'))).length`), 0);
  a.run(`localStorage.setItem('zollviewer:cfg','{"win":12000}'); localStorage.setItem('zollviewer:recent','[1]');
    localStorage.setItem('zollviewer:dirName','x'); localStorage.setItem('zollviewer:ann:case1','[]');`);
  const plain = JSON.parse(a.run('JSON.stringify(settingsKeys(false))'));
  assert.ok(plain.includes('zollviewer:cfg'));
  assert.ok(!plain.some(k=>/recent|dirName|ann:/.test(k)));
  assert.ok(JSON.parse(a.run('JSON.stringify(settingsKeys(true))')).includes('zollviewer:ann:case1'));
});

test('march-out calipers repeat the exact interval both ways, and presses pick resize, slide or new', () => {
  const a = app();
  const t = JSON.parse(a.run('JSON.stringify(marchTimes(1000, 1800, 0, 4000))'));
  assert.deepEqual(t, [2600, 3400, 200]);
  /* whole multiples of the interval, so a long walk never drifts */
  const far = JSON.parse(a.run('JSON.stringify(marchTimes(0.1, 0.3, 0, 1000).slice(0,400))'));
  assert.ok(Math.abs(far[far.length-1] - (0.3 + far.length*0.2)) < 1e-9);
  assert.equal(a.run('marchTimes(5, 5, 0, 100).length'), 0);
  assert.equal(a.run('marchTimes(0, 1, 0, 1e9).length'), 400);
  assert.equal(a.run(`calHit(102, 100, 200, 6)`), 'a');
  assert.equal(a.run(`calHit(197, 100, 200, 6)`), 'b');
  assert.equal(a.run(`calHit(150, 100, 200, 6)`), 'move');
  assert.equal(a.run(`calHit(250, 100, 200, 6)`), null);
});

test('the formula index lists every entry, abbreviations too, in A–Z order with symbols last', () => {
  const a = app();
  const ix = JSON.parse(a.run('JSON.stringify(formulaIndex())'));
  const keys = JSON.parse(a.run('JSON.stringify(GLOSSARY.map(g=>g.key))'));
  assert.deepEqual([...new Set(ix.map(e=>e.key))].sort(), [...keys].sort());
  const L = ix.map(e=>e.letter);
  assert.deepEqual(L, [...L].sort((x,y)=>(x==='#')-(y==='#') || x.localeCompare(y)));
  assert.ok(ix.some(e=>e.label==='MAP' && e.see && e.letter==='M'));
  assert.equal(a.run(`fmLetter('τ')`), '#');
  assert.equal(a.run(`fmLetter('Écart')`), 'E');
});

test('case details list everything in full and leave out what was not recorded', () => {
  const a = app();
  const html = a.run(`(()=>{ Object.assign(M, {caseId:'C1', fileName:'c1.zol', t0Wall:Date.UTC(2026,0,1,10), durMs:600000,
    device:{serial:'SN1', sw:'1.0', dept:'Agency', unit:''}, patient:{PatientId:'P9', Age:'45', Weight:{'#text':'150','@Units':'lb'}},
    summary:{shocks:2}, channels:{}, trends:[], events:[], snapshots:[], pace:[]});
    return caseDetailsHtml(); })()`);
  for (const s of ['C1', 'SN1', 'Agency', 'P9', '45 y', '150 lb', 'Shocks', '10:00']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('>Unit<'));
  assert.ok(!html.includes('Pacer pulses'));
});

test('sticky notes keep their trace and height through save and import, and bad placement is dropped', () => {
  const a = app();
  const out = JSON.parse(a.run(`(()=>{ M.durMs=60000; return JSON.stringify(normalizeAnnotations([
    {id:'n1', t0:5000, t1:5000, ch:'II', yf:0.4, text:'ST change', color:'#ffb020'},
    {id:'n2', t0:6000, t1:6000, ch:{bad:1}, yf:7, text:'x'},
    {id:'r1', t0:1000, t1:9000, text:'range'}])); })()`));
  const n1 = out.find(x=>x.id==='n1'), n2 = out.find(x=>x.id==='n2'), r1 = out.find(x=>x.id==='r1');
  assert.equal(n1.ch, 'II'); assert.equal(n1.yf, 0.4);
  assert.ok(!('ch' in n2) && !('yf' in n2));
  assert.equal(a.run(`annIsNote(${JSON.stringify(n1)})`), true);
  assert.equal(a.run(`annIsNote(${JSON.stringify(r1)})`), false);
});

test('parameter alarm boxes: monitor flag or a still-crossed limit is red, a sensor alert is yellow until it recovers', () => {
  const a = app();
  assert.deepEqual(JSON.parse(a.run(`JSON.stringify(techAlertTargets('IBP Probe2 Disconnected'))`)).ids, ['ibp2']);
  assert.ok(JSON.parse(a.run(`JSON.stringify(techAlertTargets('SPO2 Check Probe').ids)`)).includes('spo2'));
  assert.equal(a.run(`techAlertTargets('NIBP Reading Started')`), null);
  const st = JSON.parse(a.run(`(()=>{
    const pts=(arr)=>arr.map(([t,v])=>({t,v}));
    const spo2={id:'spo2', pts:pts([[0,97],[30000,null],[60000,null],[90000,96],[120000,85],[150000,93]])};
    const hr={id:'hr_dev', pts:pts([[0,80],[30000,80],[60000,80],[90000,80],[120000,80],[150000,80]])};
    Object.assign(M, {durMs:200000, paramById:{spo2, hr_dev:hr}, _almIdx:null,
      trends:[0,30000,60000,90000,120000,150000].map(t=>({t, fl: t===30000 ? {hr:{alarm:true}} : null})),
      events:[
        {t:25000, name:'SPO2 Probe Disconnect', kind:'annotation'},
        {t:118000, name:'Alarm: SpO2 event 227', kind:'alarm', value:85, limits:{LowLimVal:90, HighLimVal:100}}]});
    const s=(p,t)=>paramAlarmState(M.paramById[p],t);
    return JSON.stringify({hrFlag:s('hr_dev',35000), hrClear:s('hr_dev',65000), spo2Probe:s('spo2',40000),
      spo2Back:s('spo2',95000), spo2Low:s('spo2',125000), spo2Recovered:s('spo2',155000)});
  })()`));
  assert.deepEqual(st, {hrFlag:'crit', hrClear:null, spo2Probe:'warn', spo2Back:null, spo2Low:'crit', spo2Recovered:null});
});

test('the changelog is dated, newest first, and its seen-marker never travels in a settings backup', () => {
  const a = app();
  const log = JSON.parse(a.run('JSON.stringify(CHANGELOG)'));
  assert.ok(log.length >= 2 && log.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.items.length));
  assert.deepEqual(log.map(e=>e.date), [...log.map(e=>e.date)].sort().reverse());
  assert.ok(a.run('DEVICE_ONLY_KEYS').includes('zollviewer:logSeen'));
  assert.ok(a.run('changelogHtml()').includes('<time datetime="'+log[0].date+'"'));
});

test('a pressure row grows its scale in round steps to fit values past the monitor scale, and keeps it otherwise', () => {
  const a = app();
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(fitRange([0,180], 40, 170))')), [0,180]);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(fitRange([0,180], 40, 186))')), [0,200]);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(fitRange([0,180], -30, 303))')), [-40,320]);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(fitRange([0,100], 50, 101))')), [0,120]);
});

test('a fast-flush test is measured on pressures stored as identical sample pairs', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    const hz=125, n=hz*6, d=new Float32Array(n);
    for(let i=0;i<n;i++){ const t=i/hz; let p=90;
      if(t>=1 && t<2.2) p=300;
      if(t>=2.2){ const x=t-2.2; p=90+45*Math.exp(-x/0.07)*Math.cos(2*Math.PI*11*x); }
      d[i]=p; }
    for(let i=1;i<n;i+=2) d[i]=d[i-1];               /* identical pairs, as the monitor stores them */
    M.events=[]; M.deviceLog=[];
    const f=flushTests({hz, segs:[{t0:0, n, data:d}]});
    return JSON.stringify(f.map(x=>({t:x.t, fn:+x.fn.toFixed(1), zeta:+x.zeta.toFixed(2)})));
  })()`));
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].t - 2200) < 20);
  assert.ok(r[0].fn > 8 && r[0].fn < 14, 'natural frequency ' + r[0].fn);
  assert.ok(r[0].zeta > 0.05 && r[0].zeta < 0.5, 'damping ' + r[0].zeta);
});

test('PR and QT stay on their own waves at 100/min (no T wave taken for P, no P wave taken for T end)', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    const hz=250, rr=0.6, n=hz*12, d=new Float32Array(n), G=(x,m,s)=>Math.exp(-0.5*((x-m)/s)**2);
    const Rs=[]; for(let t=0.5;t<11.5;t+=rr) Rs.push(t);
    for(let i=0;i<n;i++){ const t=i/hz; let v=0;
      for(const R of Rs){ const x=t-R; if(x<-0.4||x>0.6) continue;
        v+=0.15*G(x,-0.155,0.022)-0.08*G(x,-0.036,0.009)+1.1*G(x,0,0.0135)-0.25*G(x,0.036,0.011)+0.32*G(x,0.227,0.04); }
      d[i]=v; }
    const ch={hz, segs:[{t0:0, n, data:d}]};
    const out=[];
    for(let k=2;k<Rs.length-1;k++){
      const R=Rs[k]*1000, Rp=Rs[k-1]*1000;
      const tp=tWave(ch, Rp+45, R-45, Rp-45);
      const p=pWave(ch, R-45, Rp+45, tp&&tp.off);
      const t=tWave(ch, R+45, Rs[k+1]*1000-45, R-45);
      out.push({pr: p ? (R-45)-p.on : null, qt: t&&t.off ? t.off-(R-45) : null});
    }
    return JSON.stringify(out);
  })()`));
  const med = xs => { const s = xs.filter(x=>x!=null).sort((x,y)=>x-y); return s[s.length>>1]; };
  const pr = med(r.map(x=>x.pr)), qt = med(r.map(x=>x.qt));
  assert.ok(pr > 130 && pr < 180, 'PR ' + pr);          /* built at 160 ms */
  assert.ok(qt > 320 && qt < 370, 'QT ' + qt);          /* tangent end of a 360 ms QT */
});

test('CPR summary: pauses binned by length, peri-shock pauses, depth and rate split three ways', () => {
  const a = app();
  const S = JSON.parse(a.run(`(()=>{
    const comps=[]; let t=10000;
    for(let i=0;i<120;i++){ comps.push({t, depth: i<30?1.7:i<100?2.2:2.6, rate: i<60?110:130, relVel:400}); t+=500;
      if(i===40) t+=3000; if(i===80) t+=7000; if(i===100) t+=14000; }
    M.events=[]; M.durMs=200000;
    M.cpr={comps, periods:[], pauses:[], rosc:[], autopulse:[], resq:[], vents:[], shocks:[{t:comps[80].t+3000, label:'Shock'}]};
    return JSON.stringify(cprSummary());
  })()`));
  assert.deepEqual(S.pauseBins, [1, 1, 1]);
  assert.equal(S.shocks[0].pre, 3000);
  assert.equal(S.shocks[0].post, 4500);
  assert.equal(Math.round(S.depth[0]), 25);   /* 30 of 120 too shallow */
  assert.equal(Math.round(S.depth[2]), 17);   /* 20 of 120 too deep */
  assert.equal(Math.round(S.rate[2]), 50);    /* 60 of 120 too fast */
});

test('CPR targets follow the monitor mode and age (ACLS, PALS, NRP), and the settings', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    const grp=(mode, age, evMode)=>{ M.patient={PatientMode:mode, Age:age};
      M.events=evMode?[{t:0, name:'Patient Mode '+evMode}]:[]; M.cpr={comps:[{t:5000}]}; CFG.cprT=null; syncCprTargets();
      return [CPR_TARGET.group, CPR_TARGET.depthLo, CPR_TARGET.depthHi, CPR_TARGET.rateLo, CPR_TARGET.rateHi]; };
    const out={adult:grp('Adult',58), child:grp('Pediatric',6), infant:grp('Pediatric',0.5), newborn:grp('Pediatric',0.01),
      switched:grp('Adult',6,'Pediatric')};
    M.patient={PatientMode:'Adult'}; M.events=[];
    CFG.cprT={unit:'cm', pre:3, pauseMin:3, quality:70}; syncCprTargets();
    out.cfg=[cprDFmt(2,2), CPR_TARGET.pre, CPR_TARGET.pauseMin, cprGoalGrade(60,70), cprGoalGrade(50,70)];
    CFG.cprT=null; syncCprTargets();
    out.defaults=[CPR_TARGET.pre, CPR_TARGET.post, CPR_TARGET.fraction, CPR_TARGET.unit];
    return JSON.stringify(out);
  })()`));
  assert.deepEqual(r.adult, ['adult', 2.0, 2.4, 100, 120]);
  assert.deepEqual(r.child, ['child', 1.8, 2.2, 100, 120]);
  assert.deepEqual(r.infant, ['infant', 1.3, 1.7, 100, 120]);
  assert.deepEqual(r.newborn, ['newborn', 1.0, 1.4, 85, 95]);
  assert.deepEqual(r.switched, ['child', 1.8, 2.2, 100, 120]);   /* a Patient Mode event before CPR wins */
  assert.deepEqual(r.cfg, ['5.1 cm', 3, 3, 'mid', 'bad']);
  assert.deepEqual(r.defaults, [10, 10, 60, 'in']);
});

test('case features: vitals and waveforms present, events, alarms by parameter and direction', () => {
  const a = app();
  const F = JSON.parse(a.run(`(()=>{
    M.params=[{id:'hr_dev',label:'HR',origin:'device',pts:[{t:0,v:80}]},{id:'spo2',label:'SpO2',origin:'device',pts:[{t:0,v:null}]}];
    M.channels={a:{name:'12-Lead II',nValid:10},b:{name:'CO2 mmHg, Waveform',nValid:0}};
    M.snapshots=[{is12:true},{is12:false},{is12:false}]; M.pace=[]; M.summary={shocks:1, pacerTime:0};
    M.cpr={comps:[{t:1}], periods:[], rosc:[{t0:60000,t1:90000}], shocks:[{t:5}]}; M.t0Wall=0; M.deviceLog=[];
    M.events=[
      {kind:'alarm', name:'Alarm: heart rate event 320', value:150, limits:{LowLimVal:50,HighLimVal:140}},
      {kind:'alarm', name:'Alarm: heart rate event 320', value:155, limits:{LowLimVal:50,HighLimVal:140}},
      {kind:'alarm', name:'Alarm: SpO2 event 227', value:85, limits:{LowLimVal:90,HighLimVal:100}},
      {kind:'aed', name:'AED analysis: SHOCK ADVISED'}];
    return JSON.stringify(caseFeatures());
  })()`));
  assert.deepEqual(F.vitals, ['HR']);
  assert.deepEqual(F.waves, ['II']);
  const ev = Object.fromEntries(F.events);
  assert.equal(ev['CPR'], 'Yes'); assert.equal(ev['Shocks delivered'], '1'); assert.equal(ev['Shock advised'], '1');
  assert.equal(ev['12-leads'], '1'); assert.equal(ev['Snapshots'], '2');
  assert.deepEqual(F.alarms, [['HR','High ×2'], ['SpO₂','Low']]);
});

test('case library: tags, reviewed mark and unopened filter, and search across tags', () => {
  const m = new Map();
  const a = app({localStorage: {getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length(){ return m.size; }}});
  const r = JSON.parse(a.run(`(()=>{
    LIB.files=[{path:'a.zol',name:'a.zol',serial:'X1',caseTime:3},{path:'b.zol',name:'b.zol',serial:'X2',caseTime:2},{path:'c.zol',name:'c.zol',serial:'X3',caseTime:1}];
    LIB.q=''; LIB.filter='all';
    metaSet('a.zol',{tags:['Station 14','QA'], reviewed:true});
    metaSet('b.zol',{tags:['QA'], opened:123});
    const names=()=>libRows().map(x=>x.path).join(',');
    const out={};
    LIB.tag='QA'; out.tagQA=names(); LIB.tag='';
    LIB.reviewed='yes'; out.reviewed=names(); LIB.reviewed='no'; out.notReviewed=names(); LIB.reviewed='all';
    LIB.unopened=true; out.unopened=names(); LIB.unopened=false;
    LIB.q='station'; out.search=names(); LIB.q='';
    out.allTags=metaTagsAll();
    return JSON.stringify(out);
  })()`));
  assert.equal(r.tagQA, 'a.zol,b.zol');
  assert.equal(r.reviewed, 'a.zol');
  assert.equal(r.notReviewed, 'b.zol,c.zol');
  assert.equal(r.unopened, 'a.zol,c.zol');
  assert.equal(r.search, 'a.zol');
  assert.deepEqual(r.allTags, ['QA', 'Station 14']);
});

test('CPR trend report: per-case results grouped by month, quarter and year', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    const T=(y,m)=>Date.UTC(y,m-1,15);
    const cases=[
      {caseTime:T(2025,1), arrest:true, rosc:true, quality:50, depth:2.1, rate:110, ccf:80, pre:4, post:6},
      {caseTime:T(2025,1), arrest:true, rosc:false, quality:70, depth:2.3, rate:120, ccf:60, pre:6, post:null},
      {caseTime:T(2025,2), arrest:false},
      {caseTime:T(2025,5), arrest:true, rosc:true, quality:90, depth:2.2, rate:105, ccf:90},
      {error:'unreadable'}];
    return JSON.stringify({month:rptAggregate(cases,'month'), quarter:rptAggregate(cases,'quarter'), year:rptAggregate(cases,'year')});
  })()`));
  assert.deepEqual(r.month.map(x=>x.period), ['2025-01','2025-02','2025-05']);
  const jan = r.month[0];
  assert.equal(jan.arrests, 2); assert.equal(jan.rosc, 1);
  assert.equal(jan.quality, 60); assert.equal(jan.pre, 5); assert.equal(jan.post, 6);
  assert.equal(r.month[1].arrests, 0); assert.equal(r.month[1].quality, null);
  assert.deepEqual(r.quarter.map(x=>[x.period, x.cases, x.arrests]), [['2025 Q1',3,2],['2025 Q2',1,1]]);
  assert.deepEqual(r.year.map(x=>[x.period, x.cases, x.arrests, x.rosc]), [['2025',4,3,2]]);
});

test('12-lead: ST-J at the J point across all leads (deep S in V2 does not end the QRS), and frontal axes', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    const hz=500, n=hz*10, G=(x,m,s)=>Math.exp(-0.5*((x-m)/s)**2);
    const W={I:[.08,-.03,.55,-.08,.18], II:[.15,-.08,1.1,-.25,.32], V2:[.08,0,.5,-1.3,.35]};
    const Rs=[]; for(let t=0.6;t<9.6;t+=0.75) Rs.push(t);
    const lead=(w,st)=>Float32Array.from({length:n},(_,i)=>{ const t=i/hz; let v=0;
      for(const R of Rs){ const x=t-R; if(x<-0.4||x>0.6) continue;
        v+=w[0]*G(x,-0.155,0.022)+w[1]*G(x,-0.036,0.009)+w[2]*G(x,0,0.0135)+w[3]*G(x,0.036,0.011)+w[4]*G(x,0.247,0.04);
        if(st && x>0.02 && x<0.159) v+=st*Math.min(1,(x-0.02)/0.02); }
      return v; });
    const I=lead(W.I), II=lead(W.II), V2=lead(W.V2,0.18);
    const snap={is12:true, traces:[{lead:'I',hz,data:I},{lead:'II',hz,data:II},{lead:'V2',hz,data:V2},
      {lead:'aVF',hz,data:Float32Array.from(II,(v,i)=>v-I[i]/2)}]};
    const m=twelveMeasure(snap);
    return JSON.stringify({I:m.stj.I, II:m.stj.II, V2:m.stj.V2, qrs:m.axes.QRS, p:m.axes.P, t:m.axes.T});
  })()`));
  assert.ok(Math.abs(r.I) < 0.3 && Math.abs(r.II) < 0.3, 'limb leads near 0: ' + r.I + ' ' + r.II);
  assert.ok(Math.abs(r.V2 - 1.8) < 0.6, 'V2 ST-J ' + r.V2);       /* built at 0.18 mV = 1.8 mm; was -12 before the fix */
  assert.ok(r.qrs > 40 && r.qrs < 65, 'QRS axis ' + r.qrs);
  assert.ok(r.p > 40 && r.p < 70 && r.t > 40 && r.t < 65, 'P/T axes ' + r.p + ' ' + r.t);
});

test('CPR perfusion proxy: builds toward the quality delivered (tau 5 s), decays fast in a pause (tau 3.6 s), no reset at a shock', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    syncCprTargets();
    const comps=[]; let t=1000;
    for(let i=0;i<60;i++){ comps.push({t, rate:110, depth:2.2, relVel:420}); t+=545; }   /* good, ~33 s */
    const endGood=t-545;
    t+=8000;                                                                              /* 8 s pause */
    const resume=t;
    for(let i=0;i<60;i++){ comps.push({t, rate:110, depth:1.7, relVel:420}); t+=545; }   /* 0.3 in short: q = 0.5 */
    const endShallow=t-545;
    for(let i=0;i<20;i++){ comps.push({t, rate:110, depth:2.6, relVel:420}); t+=545; }   /* deeper than target: q = 1 */
    const endDeep=t-545;
    const shockT=endDeep+3000;
    M.cpr={comps, periods:[], pauses:[], rosc:[], shocks:[{t:shockT}]};
    const span=60000/110+500;
    return JSON.stringify({
      after5s: cprPerfAt(1000+5000), after10s: cprPerfAt(1000+10000), endGood: cprPerfAt(endGood+10),
      pause5: cprPerfAt(endGood+span+5000), pause5ratio: cprPerfAt(endGood+span+5000)/cprPerfAt(endGood+span),
      jitter: cprPerfAt(endGood+span-1)/cprPerfAt(endGood+10),
      shallow: cprPerfAt(endShallow+10), deep: cprPerfAt(endDeep+10),
      preShock: cprPerfAt(shockT-1), postShock: cprPerfAt(shockT+1),
      deepScore: cprCompScore({rate:110, depth:2.9, relVel:420}), lowRelease: cprCompScore({rate:110, depth:2.2, relVel:0}), noRelease: cprCompScore({rate:110, depth:2.2}) });
  })()`));
  assert.ok(r.after5s > 0.55 && r.after5s < 0.7, 'after 5 s: ' + r.after5s);          /* 1-e^-1 = 0.63 */
  assert.ok(r.after10s > 0.8 && r.after10s < 0.9, 'after 10 s: ' + r.after10s);       /* 0.86 */
  assert.ok(r.endGood > 0.97, 'full with sustained good CPR: ' + r.endGood);
  assert.ok(Math.abs(r.pause5ratio - 0.25) < 0.02, 'a quarter left 5 s into a pause: ' + r.pause5ratio);
  assert.ok(r.jitter > 0.99, 'no drop between compressions at a normal rate: ' + r.jitter);
  assert.ok(Math.abs(r.shallow - 0.5) < 0.03, 'settles at quality 0.5: ' + r.shallow);
  assert.ok(r.deepScore === 1 && r.deep > r.shallow + 0.4, 'deeper than target is not penalised: ' + r.deepScore + ' ' + r.deep);
  assert.ok(Math.abs(r.postShock - r.preShock) < 0.01 && r.preShock > 0, 'a shock is not a reset: ' + r.preShock + ' -> ' + r.postShock);
  assert.ok(Math.abs(r.lowRelease - 0.65) < 1e-9 && r.noRelease === 1, 'release factor: ' + r.lowRelease + ' ' + r.noRelease);
});

test('sample cases: the built-in generator makes a readable, anonymous case, the same every time', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    const x=synthCase(false), y=synthCase(false);
    let same=x.zol.length===y.zol.length; for(let i=0;same && i<x.zol.length;i+=997) same = x.zol[i]===y.zol[i];
    const {json,xml}=splitZol(x.zol.buffer);
    buildModel(json, xml, 'synthetic-cardiac.zol');
    const text=new TextDecoder().decode(x.zol);
    return JSON.stringify({same, mb:x.zol.length/1048576, caseId:M.caseId, durMin:Math.round(M.durMs/60000),
      sheet:/what the viewer should find/.test(x.sheet), samples:SAMPLES.length,
      serial:(()=>{ const all=[...text.matchAll(/"[A-Za-z]*SerialNumber":"([^"]*)"/g)].map(m=>m[1]); return all.length>0 && all.every(v=>v==='SIM00000001'); })(), neuro:synthCase(true).sheet.includes('synthetic-neuro.zol'),
      treats:cprTreatments().map(e=>e.name)});
  })()`));
  assert.equal(r.same, true);
  assert.ok(r.mb > 15 && r.mb < 25, 'size ' + r.mb);
  assert.equal(r.caseId, 'SIM-CARDIAC-0001');
  assert.equal(r.durMin, 30);
  assert.equal(r.sheet, true); assert.equal(r.samples, 3); assert.equal(r.serial, true); assert.equal(r.neuro, true);
  /* treatments for the CPR timeline: logged ones only, not device actions */
  assert.deepEqual(r.treats, ['IV Access', 'Epinephrine', 'Amiodarone', 'Intubation', 'Other']);
});

function sampleModel(a, opts) {
  a.run(`(()=>{ const x=synthCase(false, null, ${opts}); const {json,xml}=splitZol(x.zol.buffer);
    buildModel(json, xml, 'sample.zol'); syncCprTargets(); globalThis.sheet=x.sheet; })()`);
}
test('the child sample: Pediatric mode, child CPR targets, the adult-derived warning and child alarm limits', () => {
  const a = app();
  sampleModel(a, '{child:true}');
  const r = JSON.parse(a.run(`JSON.stringify({caseId:M.caseId, group:CPR_TARGET.group, lo:CPR_TARGET.depthLo, hi:CPR_TARGET.depthHi,
    bsa:+hemoPatient().bsa.toFixed(2), depth:+(M.cpr.comps.reduce((s,c)=>s+c.depth,0)/M.cpr.comps.length).toFixed(2),
    hr:[100,800,1300].map(s=>trendAt(s*1000).hr),
    alarms:M.events.filter(e=>/^Alarm/.test(e.name)).map(e=>e.name),
    sheet:sheet.includes('--child') && sheet.includes('Child (PALS)')})`));
  assert.equal(r.caseId, 'SIM-CHILD-0001');
  assert.equal(r.group, 'child'); assert.equal(r.lo, 1.8); assert.equal(r.hi, 2.2);
  assert.equal(r.bsa, 0.92);
  assert.ok(r.depth > 1.85 && r.depth < 2.05, 'compressions near the child target: ' + r.depth);
  assert.ok(r.hr[0] > 98 && r.hr[0] < 112 && r.hr[1] < 70 && r.hr[2] > 135, 'child heart rates: ' + r.hr);
  /* the child limits (HR 70-170, arterial 70-140, NIBP below 70) all trip somewhere in the story */
  for (const k of ['heart rate event 319', 'heart rate event 320', 'invasive pressure low limit', 'invasive pressure high limit', 'pressure event 197'])
    assert.ok(r.alarms.some(n => n.includes(k)), 'alarm ' + k + ' in ' + r.alarms);
  assert.equal(r.sheet, true);
  /* the CPR page shows its adult-derived warning whenever the group is not adult */
  assert.ok(a.run('drawCprDash.toString()').includes(`CPR_TARGET.group!=='adult' ? '<div class="dashwarn">Adult-derived model`));
});
test('a sample with the New Patient marker partway through excludes the earlier patient everywhere', () => {
  const a = app();
  sampleModel(a, '{newPatientAt:650}');
  const r = JSON.parse(a.run(`JSON.stringify({start:M.caseStartMs, stats:M.boundaryStats,
    firstSample:Math.min(...Object.values(M.channels).flatMap(c=>c.segs.map(s=>s.t0))),
    firstTrend:M.trends[0].t, snaps:M.snapshots.map(s=>s.start!=null?s.start:s.t),
    early:M.events.filter(e=>e.t<650000).map(e=>e.name), nibp:M.trends.filter(r=>r.nibpTime && devTime(r.nibpTime)-M.t0Wall<650000).length,
    cpr:M.cpr.comps.length, sheet:/--new-patient-at 650/.test(sheet)})`));
  assert.equal(r.start, 650000);
  assert.ok(r.stats.waveSamples > 0 && r.stats.trends > 0 && r.stats.snapshots === 2, JSON.stringify(r.stats));
  assert.ok(r.firstSample >= 650000, 'first sample ' + r.firstSample);
  assert.ok(r.firstTrend >= 650000, 'first trend ' + r.firstTrend);
  assert.ok(r.snaps.every(t => t >= 650000), 'snapshots ' + r.snaps);
  assert.deepEqual(r.early, []);
  assert.equal(r.nibp, 0, 'no cuff reading from the earlier patient');
  assert.ok(r.cpr > 250, 'the arrest after the marker is kept');
  assert.equal(r.sheet, true);
});

test('monitor waveform choices survive absent channels, case changes and settings reloads', () => {
  const nodes={'#monitorLeadList':{innerHTML:''}};
  const inputs=[{dataset:{ch:'12-Lead I'},checked:false}, {dataset:{ch:'12:12-Lead I'},checked:true}];
  const a=app({document:{querySelector:s=>nodes[s]||null,
    querySelectorAll:s=>s==='#monitorLeadList input'?inputs:[]}});
  a.run(`drawMonitor=()=>{}; M.channels={'12-Lead I':{name:'12-Lead I',kind:'ecg',nValid:1}};
    M.monitorExtra=[{name:'12-Lead I',kind:'ecg',nValid:1,captureOnly:true,hz:1,segs:[{t0:0,n:1}]}];
    restoreMonitorChoices(); renderMonitorChoices();`);
  inputs[0].onchange(); inputs[1].onchange();
  a.run(`M.channels={Other:{name:'Other',kind:'other',nValid:1}}; M.monitorExtra=[]; restoreMonitorChoices();`);
  assert.equal(a.run('APP.hidden.size'),0,'new channels remain visible by default');
  a.run(`CFG.monitorChoices=null; cfgLoad();
    M.channels={'12-Lead I':{name:'12-Lead I',kind:'ecg',nValid:1}};
    M.monitorExtra=[{name:'12-Lead I',captureOnly:true}]; restoreMonitorChoices();`);
  assert.equal(a.run(`APP.hidden.has('12-Lead I')`),true);
  /* a 12-lead-only lead is a one-off look at that acquisition: ticking it is not carried into the next case */
  assert.equal(a.run(`APP.hidden.has('12:12-Lead I')`),true,'12-lead-only leads start hidden in each case');
  assert.equal(a.run(`'12:12-Lead I' in (CFG.monitorChoices||{})`),false,'12-lead-only ticks are not saved');
});

test('SpO2 events and burden exclude recording gaps and report unobserved recovery', () => {
  const a=app();
  a.run('M.trends=[{t:0,spo2:85},{t:1000,spo2:85},{t:601000,spo2:97}]');
  const r=JSON.parse(a.run('JSON.stringify(spo2Analysis())'));
  assert.equal(r.totalMs,1000); assert.equal(r.unknownMs,600000);
  assert.equal(r.burden[90],1000); assert.equal(r.events[0].durS,1);
  assert.equal(r.events[0].censored,true); assert.equal(r.maxFall,null);
});

test('SpO2 invalid readings and skipped sampling intervals split low episodes', () => {
  const a=app();
  a.run(`M.trends=[{t:0,spo2:85},{t:30000,spo2:85},{t:60000,spo2:null},
    {t:90000,spo2:84},{t:120000,spo2:97},{t:240000,spo2:83},{t:270000,spo2:96}];`);
  const r=JSON.parse(a.run('JSON.stringify(spo2Analysis())'));
  assert.equal(r.totalMs,90000); assert.equal(r.burden[90],90000);
  assert.deepEqual(r.events.map(e=>[e.start,e.durS,e.censored]),
    [[0,30,true],[90000,30,false],[240000,30,false]]);
  assert.equal(r.gapMs,45000);
});

test('SpO2 analysis clips supported intervals to the window and never extrapolates', () => {
  const a=app();
  a.run(`M.trends=[{t:0,spo2:85},{t:30000,spo2:86},{t:60000,spo2:97}];`);
  let r=JSON.parse(a.run('JSON.stringify(spo2Analysis({t0:15000,t1:45000}))'));
  assert.equal(r.totalMs,30000); assert.equal(r.events[0].start,15000);
  assert.equal(r.events[0].durS,30); assert.equal(r.events[0].censored,true);
  r=JSON.parse(a.run('JSON.stringify(spo2Analysis({t0:45000,t1:120000}))'));
  assert.equal(r.totalMs,15000); assert.equal(r.unknownMs,60000);
  assert.equal(r.events[0].durS,15); assert.equal(r.events[0].censored,false);
  a.run('M.trends=[{t:0,spo2:85}]');
  assert.equal(a.run('spo2Analysis({t0:0,t1:60000}).totalMs'),0);
});

function boundaryRecords() {
  const hdr=t=>({ElapsedTime:t});
  const wave=t=>({StdHdr:hdr(t),Waveform:{WaveRec:{WaveType:3,WaveTypeVar:'12-Lead II',
    SampleTime:1000000,UnpackedSamples:[100,200,300,400,500,600],SampleStatus:[2,0,0,0,2,0]}}});
  return [{CaseSummary:{StartTime:'2020-01-01T00:00:00',ElapsedTime:60}},
    {DataChannels:{DataChannel:[{ChanType:3,Scalar:10000,ScalarType:1}]}},
    {AnnotationEvt:{StdHdr:hdr(10),'@EvtName':'New Patient'}},
    {AnnotationEvt:{StdHdr:hdr(5),'@EvtName':'Self-test passed'}},
    {AnnotationEvt:{StdHdr:hdr(5),'@EvtName':'Epinephrine',TreatmentSummary:1}},
    {ContinWaveRec:wave(7)},
    {TrendRpt:{StdHdr:hdr(9),Trend:{Hr:{Val:199}}}},
    {TrendRpt:{StdHdr:hdr(12),Trend:{Hr:{Val:70},Nibp:{Time:'2020-01-01T00:00:05',
      Sys:{Val:200},Dia:{Val:100},Map:{Val:140}}}}},
    {SnapshotRpt:wave(9)}, {SnapshotRpt:wave(12)}, {SnapshotRpt:wave(30)},
    {CPRRecord:{StdHdr:hdr(5),Compressions:[{Depth:2,Offset:0},{Depth:2,Offset:6000}]}},
    {DefibTrace:{StdHdr:{DevDateTime:'2020-01-01T00:00:05'},CurrEnergy:100}},
    {DefibTrace:{StdHdr:{DevDateTime:'2020-01-01T00:00:20'},CurrEnergy:120}}];
}
function modelFromRecords(a,recs,xml=null){
  a.ctx.fixture=JSON.stringify({ZOLL:{FullDisclosure:[{FullDisclosureRecord:recs}]}});
  a.ctx.fixtureXml=xml; a.run(`buildModel(fixture,fixtureXml,'boundary.json')`);
}
test('patient boundaries trim samples, trends, snapshots, vents, pacing and CPR before analysis', () => {
  const a=app();
  modelFromRecords(a,boundaryRecords(),`<CaseReview><EtCO2Ventilations>
    <Ventilation second="5" ms="0"/><Ventilation second="12" ms="0"/><Ventilation second="17" ms="0"/>
    </EtCO2Ventilations><CprPeriods><CprPeriod Start="5" End="20"/></CprPeriods>
    <CprPausePeriods><CprPausePeriod Start="2" End="6"/></CprPausePeriods></CaseReview>`);
  assert.equal(a.run('M.caseStartMs'),10000);
  assert.equal(a.run(`JSON.stringify(Array.from(M.channels['12-Lead II'].segs[0].data))`),'[4,5,6]');
  assert.equal(a.run(`M.channels['12-Lead II'].segs[0].t0`),10000);
  assert.equal(a.run(`M.channels['12-Lead II'].nValid`),3);
  assert.equal(a.run('M.trends.length'),1); assert.equal(a.run('M.trends[0].nsys'),null);
  assert.equal(a.run('M.snapshots.length'),1); assert.equal(a.run('M.snapshots[0].t'),30000);
  assert.equal(a.run('M.events.find(e=>e.kind==="snapshot").snapIdx'),0);
  assert.equal(a.run('M.boundaryStats.snapshots'),2);
  assert.equal(a.run('JSON.stringify(M.vents)'),'[12000,17000]');
  assert.equal(a.run('JSON.stringify(M.pace)'),'[11000]');
  assert.equal(a.run('JSON.stringify(M.cpr.periods)'),'[{"t0":10000,"t1":20000}]');
  assert.equal(a.run('M.cpr.pauses.length'),0);
  assert.equal(a.run('JSON.stringify(M.cpr.comps.map(c=>c.t))'),'[11000]');
  assert.equal(a.run('JSON.stringify(M.cpr.shocks.map(c=>c.t))'),'[20000]');
  assert.equal(a.run('M.events.some(e=>e.t<10000)'),false);
  assert.equal(a.run('M.deviceLog.some(e=>e.name==="Self-test passed")'),true);
});

test('multiple patient segments are rejected and boundary state resets on the next file', () => {
  const a=app(), recs=boundaryRecords();
  recs.push({AnnotationEvt:{StdHdr:{ElapsedTime:40},'@EvtName':'New Patient'}});
  assert.throws(()=>modelFromRecords(a,recs),/multiple New Patient/);
  modelFromRecords(a,[{CaseSummary:{StartTime:'2020-01-02T00:00:00',ElapsedTime:60}}]);
  assert.equal(a.run('M.caseStartMs'),0); assert.equal(a.run('M.clockDriftMsPerMin'),0);
});

test('rapid pause and resume invalidates old animation callbacks', () => {
  const h=physiologyPlayback(), a=h.a;
  a.run('APP.cursor=15000; setPlaying(true); setPlaying(false); setPlaying(true)');
  const old=h.frames.shift(), current=h.frames.shift();
  old(2100); assert.equal(a.run('APP.cursor'),15000);
  current(2100); assert.equal(a.run('APP.cursor'),15100);
  a.run('setPlaying(true)'); assert.equal(h.frames.length,1,'only one playback loop is scheduled');
});

test('opening an event pins the strip at its start until the playhead reaches its usual place, then scrolls normally', () => {
  const a = app();
  const r = JSON.parse(a.run(`(()=>{
    APP.cursor=15000; APP.monitorAnchor=15000;
    const pinned=followWindow(8000,'monitorAnchor').t0;          /* event at the left edge */
    APP.cursor=19000; const holding=followWindow(8000,'monitorAnchor').t0;   /* still holding */
    APP.cursor=21000; const released=followWindow(8000,'monitorAnchor');     /* reached 3/4: normal */
    return JSON.stringify({pinned, holding, releasedT0:released.t0, anchorAfter:APP.monitorAnchor});
  })()`));
  assert.equal(r.pinned, 15000); assert.equal(r.holding, 15000);
  assert.equal(r.releasedT0, 15000);      /* continuous: no jump at the hand-over */
  assert.equal(r.anchorAfter, null);
});
