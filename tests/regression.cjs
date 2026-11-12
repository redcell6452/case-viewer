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
test('optional inputs are collapsed, labeled, and limited to data relevant to the case', () => {
  const a=app();
  assert.equal(a.run('renderCaseInputs()'),'');
  arterialCase(a);
  const markup=a.run('renderCaseInputs()');
  assert.ok(markup.includes('<details class="caseinputs" id="caseInputs">'));
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
