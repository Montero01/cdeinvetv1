import assert from 'node:assert/strict';
const {parseHTML}=await import('linkedom').catch(()=>import(process.env.CDE_QA_LINKEDOM||'/workspace/work/academy-icons-qa/node_modules/linkedom/esm/index.js'));
const {document}=parseHTML('<html><body></body></html>');globalThis.document=document;
const C=await import('../charts.js');
const hostile='<img src=x onerror=alert(1)>';
const cases=[
 ['type',[{label:hostile,value:123.5},{label:'Laminado',value:0}]],
 ['warehouse',[{label:hostile,sealed_m2:20,loose_m2:10},{label:'Galpão 2',sealed_m2:0,loose_m2:4}]],
 ['condition',[{label:'Úteis',value:9},{label:hostile,value:1}]],
 ['evolution',[{date:'2026-11-20',useful_m2:60},{date:'2026-11-21',useful_m2:null},{date:'2026-11-22',useful_m2:90}]]
];
for(const[kind,data]of cases){const host=C.renderInventoryChart(kind,data);assert.equal(host.querySelectorAll('svg[role=img]').length,1,kind);assert(host.querySelector('svg title')?.textContent);assert.equal(host.querySelector('img'),null,'chart labels must be text');assert.equal(host.querySelector('script'),null);assert(!/NaN|Infinity|undefined/.test(host.outerHTML));assert(/var\(--chart-/.test(host.outerHTML),'theme uses CSS chart tokens');}
const one=C.renderLine([{date:'2026-11-26',useful_m2:4}]);assert.equal(one.querySelectorAll('circle').length,1);assert.equal(one.querySelector('polyline'),null);assert(!/NaN|Infinity/.test(one.outerHTML));
const gap=C.renderLine([{date:'2026-11-20',useful_m2:1},{date:'2026-11-21',useful_m2:2},{date:'2026-11-22',useful_m2:null},{date:'2026-11-23',useful_m2:3},{date:'2026-11-24',useful_m2:4}]);assert.equal(gap.querySelectorAll('polyline').length,2,'unknown snapshot must break line');assert.match(gap.textContent,/sem base detalhada/);
const full=C.renderDonut([{label:'Úteis',value:5},{label:'Avariadas',value:0}]);assert.equal(full.querySelectorAll('circle').length,1,'single complete ring must render');assert(!/NaN|Infinity/.test(full.outerHTML));
for(const kind of ['type','warehouse','condition','evolution']){const empty=C.renderInventoryChart(kind,[]);assert.equal(empty.querySelector('svg'),null);assert(empty.textContent.length>5);}
for(const value of [null,undefined,NaN,Infinity]){const empty=C.renderBars([{label:'Desconhecido',value}]);assert.equal(empty.querySelector('svg'),null);}
console.log('PASS: quatro SVGs acessíveis e locais, tema por tokens, texto seguro, base vazia/zeros, donut integral, linha com uma data e lacunas sem valores inventados. Sem pixels de navegador.');
