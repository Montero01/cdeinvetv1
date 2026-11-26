import assert from 'node:assert/strict';
const {parseHTML}=await import('linkedom').catch(()=>import(process.env.CDE_QA_LINKEDOM||'/workspace/work/academy-icons-qa/node_modules/linkedom/esm/index.js'));
const {document}=parseHTML('<html><body></body></html>');globalThis.document=document;
const C=await import('../charts.js');
const hostile='<img src=x onerror=alert(1)>';
const cases=[
 ['type',[{label:hostile,value:123.5},{label:'Laminado',value:0}]],
 ['warehouse',[{label:hostile,sealed_m2:20,loose_m2:10},{label:'Galpão 2',sealed_m2:0,loose_m2:4}]],
 ['condition',[{label:'Úteis',value:9},{label:hostile,value:1}]],
 ['purchase',[{label:hostile,needed_sheets:14,needed_m2:38}]],
 ['evolution',[{date:'2026-11-20',useful_m2:60},{date:'2026-11-21',useful_m2:null},{date:'2026-11-22',useful_m2:90}]]
];
for(const[kind,data]of cases){const host=C.renderInventoryChart(kind,data);assert.equal(host.querySelectorAll('svg[role=img]').length,1,kind);assert(host.querySelector('svg title')?.textContent);assert.equal(host.querySelector('img'),null,'chart labels must be text');assert.equal(host.querySelector('script'),null);assert(!/NaN|Infinity|undefined/.test(host.outerHTML));assert(/var\(--chart-/.test(host.outerHTML),'theme uses CSS chart tokens');}
const one=C.renderLine([{date:'2026-11-26',useful_m2:4}]);assert.equal(one.querySelectorAll('circle').length,1);assert.equal(one.querySelector('polyline'),null);assert(!/NaN|Infinity/.test(one.outerHTML));
const gap=C.renderLine([{date:'2026-11-20',useful_m2:1},{date:'2026-11-21',useful_m2:2},{date:'2026-11-22',useful_m2:null},{date:'2026-11-23',useful_m2:3},{date:'2026-11-24',useful_m2:4}]);assert.equal(gap.querySelectorAll('polyline').length,2,'unknown snapshot must break line');assert.match(gap.textContent,/sem base detalhada/);
const full=C.renderDonut([{label:'Úteis',value:5},{label:'Avariadas',value:0}]);assert.equal(full.querySelectorAll('circle').length,1,'single complete ring must render');assert(!/NaN|Infinity/.test(full.outerHTML));
for(const kind of ['type','warehouse','condition','evolution','purchase']){const empty=C.renderInventoryChart(kind,[]);assert.equal(empty.querySelector('svg'),null);assert(empty.textContent.length>5);}
for(const value of [null,undefined,NaN,Infinity]){const empty=C.renderBars([{label:'Desconhecido',value}]);assert.equal(empty.querySelector('svg'),null);}
const metricData=[{label:'Comum',value:56,useful_sheets:18}];const metricBars=C.renderInventoryChart('type',metricData,{metric:'sheets'});assert.match(metricBars.querySelector('rect title').textContent,/18 chapas úteis/);assert(!metricBars.querySelector('rect title').textContent.includes('56'));const areaBars=C.renderInventoryChart('type',metricData,{metric:'m2'});assert.match(areaBars.querySelector('rect title').textContent,/56 m² úteis/);
const metricStack=C.renderInventoryChart('warehouse',[{label:'Galpão 1',sealed_m2:36,loose_m2:20,sealed_sheets:12,loose_sheets:6}],{metric:'sheets'});assert.match(metricStack.querySelectorAll('rect title')[0].textContent,/12 chapas úteis/);assert.match(metricStack.querySelectorAll('rect title')[1].textContent,/6 chapas úteis/);
const quantityHistory=[{date:'2026-11-20',useful_m2:50,useful_sheets:1},{date:'2026-11-21',useful_m2:50,useful_sheets:2},{date:'2026-11-22',useful_m2:100,useful_sheets:null},{date:'2026-11-23',useful_m2:50,useful_sheets:3},{date:'2026-11-24',useful_m2:50,useful_sheets:4}];const quantityGap=C.renderInventoryChart('evolution',quantityHistory,{metric:'sheets'});assert.equal(quantityGap.querySelectorAll('polyline').length,2);assert.equal(quantityGap.querySelectorAll('circle').length,4);assert.match(quantityGap.textContent,/sem base detalhada/);assert([...quantityGap.querySelectorAll('circle title')].every(n=>/chapas úteis/.test(n.textContent)));assert(![...quantityGap.querySelectorAll('circle title')].some(n=>n.textContent.includes('100')),'unknown quantity cannot be inferred from its known m²');
assert.equal(C.renderInventoryChart('evolution',[{date:'2026-11-20',useful_m2:50,useful_sheets:null}],{metric:'sheets'}).querySelector('svg'),null);
const suggested=C.renderInventoryChart('purchase',[{label:'Comum',needed_sheets:14,needed_m2:38}],{metric:'m2'});assert.match(suggested.querySelector('rect title').textContent,/Comum: 14 chapas a comprar/);assert(!suggested.querySelector('rect title').textContent.includes('38'),'suggested purchase chart is strictly quantity');
console.log('PASS: cinco SVGs acessíveis e locais, tema por tokens, texto seguro, base vazia/zeros, donut integral, linha com uma data e lacunas sem valores inventados, unidades quantitativas independentes de m² e compra sugerida em chapas. Sem pixels de navegador.');
