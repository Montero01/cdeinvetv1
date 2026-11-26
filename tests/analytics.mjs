import assert from 'node:assert/strict';
import{buildAnalytics,validateRule}from'../analytics.js';
const s={type:'Comum',color:'Incolor',thickness_mm:6,width_mm:1000,height_mm:2000,warehouse:'Galpão 1'};
const box=(id,status,sheets=10,damaged=2,extra={})=>({id,kind:'box',data:{...s,status,sheets,damaged,...extra}});
const loose=(id,parent,quantity=5,damaged=1,extra={})=>({id,kind:'loose',parent_id:parent,data:{...s,quantity,damaged,...extra}});
const group={...s,sheets:20,damaged:3,m2:40};
const inv=(id,date,groups=[group],status='closed')=>({id,kind:'inventory',work_date:date,created_at:date+'T12:00:00Z',data:{status,summary:{groups,total_m2:groups.reduce((n,g)=>n+g.m2,0)}}});
const rule=(id,minimum_sheets=12,target_sheets=20,extra={})=>({id,kind:'reorder_rule',data:{...s,minimum_sheets,target_sheets,enabled:true,...extra}});
const records=[box('a','sealed'),box('b','sealed',4,0,{warehouse:'Galpão 2',type:'COMUM'}),box('o','opened',999),box('m','missing',999),inv('i1','2026-11-20'),loose('l1','i1',70),inv('i2','2026-11-25'),loose('l2','i2'),inv('draft','2026-11-26',[],'active'),loose('ld','draft',100),rule('r')];
let a=buildAnalytics(records);
assert.equal(a.kpis.useful_sheets,16);assert.equal(a.kpis.useful_m2,32);assert.equal(a.kpis.sealed_useful_m2,24);assert.equal(a.kpis.loose_useful_m2,8);assert.equal(a.kpis.physical_sheets,19);assert.equal(a.kpis.damaged_sheets,3);assert.equal(a.kpis.damaged_percent,15.789474);assert.equal(a.meta.last_closed_id,'i2');assert.equal(a.meta.provisional,true);assert.equal(a.meta.has_active,true);assert.equal(a.replenishment[0].triggered,false);assert.equal(a.replenishment[0].needed_sheets,0);
assert.equal(a.charts.by_type.length,1);assert.equal(a.charts.by_type[0].value,32);assert.equal(a.charts.by_warehouse.length,2);assert.deepEqual(a.charts.by_warehouse[0],{label:'Galpão 1',sealed_m2:16,loose_m2:8,sealed_sheets:8,loose_sheets:4});assert.deepEqual(a.charts.condition,[{label:'Chapas úteis',value:16},{label:'Chapas avariadas',value:3}]);assert.deepEqual(a.charts.evolution.map(p=>[p.date,p.useful_m2]),[['2026-11-20',34],['2026-11-25',34]]);
// Threshold is inclusive and excludes damaged sheets; target is final stock, not additive.
a=buildAnalytics(records.map(r=>r.id==='r'?rule('r',16,20):r));assert.equal(a.replenishment[0].triggered,true);assert.equal(a.kpis.replenishment_count,1);assert.equal(a.kpis.replenishment_sheets,4);assert.equal(a.kpis.replenishment_m2,8);
// Warehouse filter changes charts, never global replenishment availability.
a=buildAnalytics(records.map(r=>r.id==='r'?rule('r',16,20):r),{warehouse:'GALPÃO 2'});assert.equal(a.kpis.useful_sheets,4);assert.equal(a.replenishment[0].useful_sheets,16);assert.equal(a.replenishment[0].needed_sheets,4);assert.equal(a.charts.evolution[0].useful_m2,0);
a=buildAnalytics(records,{type:'Laminado'});assert.equal(a.kpis.useful_m2,0);assert.equal(a.replenishment.length,0);
a=buildAnalytics(records,{color:'verde'});assert.equal(a.kpis.physical_sheets,0);
a=buildAnalytics(records,{thickness_mm:8});assert.equal(a.kpis.physical_sheets,0);
a=buildAnalytics(records,{from:'2026-11-21',to:'2026-11-30'});assert.equal(a.charts.evolution.length,1);assert.equal(a.charts.evolution[0].date,'2026-11-25');assert.equal(a.kpis.useful_sheets,16,'date range does not change current position');
// Case variants do not split the SKU or duplicate rule alerts.
a=buildAnalytics([box('a','sealed',2,0),rule('old',3,10),{...rule('new',5,20,{type:'COMUM',color:'INCOLOR'}),updated_at:'2026-11-26T12:00:00Z'}]);assert.equal(a.replenishment.length,1);assert.equal(a.replenishment[0].id,'new');assert.equal(a.replenishment[0].needed_sheets,18);assert.equal(a.meta.provisional,true);assert.equal(a.meta.last_closed_date,null);
a=buildAnalytics([rule('off',10,20,{enabled:false})]);assert.equal(a.kpis.replenishment_count,0);assert.equal(a.replenishment[0].needed_sheets,0);
a=buildAnalytics([rule('zero',0,0)]);assert.equal(a.replenishment[0].triggered,false);
a=buildAnalytics([rule('empty',0,10)]);assert.equal(a.replenishment[0].triggered,true);assert.equal(a.replenishment[0].needed_m2,20);
a=buildAnalytics(records.filter(r=>r.id!=='draft'));assert.equal(a.meta.provisional,false);
// Latest day is selected by date, not insertion order. Previous loose is never summed.
a=buildAnalytics([inv('old','2026-11-20'),inv('latest','2026-11-25'),loose('x','latest',3,0),loose('y','old',999,0)]);assert.equal(a.kpis.useful_sheets,3);
// Different sheet sizes require per-group damage area; percentage shortcuts are wrong.
a=buildAnalytics([inv('sizes','2026-11-25',[{...group,sheets:10,damaged:2,m2:20},{...group,width_mm:2000,sheets:10,damaged:0,m2:40}])]);assert.equal(a.charts.evolution[0].useful_m2,56);
// No filled days, trend forecasting, consumption or invented useful history.
a=buildAnalytics([{id:'old',kind:'inventory',work_date:'2026-10-01',data:{status:'closed',summary:{total_m2:100,sealed_damaged:3}}}]);assert.equal(a.charts.evolution.length,1);assert.equal(a.charts.evolution[0].useful_m2,null);assert.equal(a.meta.history_incomplete,true);
assert.deepEqual(validateRule({...s,minimum_sheets:'0',target_sheets:'10',enabled:false}),{type:'Comum',color:'Incolor',thickness_mm:6,width_mm:1000,height_mm:2000,minimum_sheets:0,target_sheets:10,enabled:false});
for(const patch of [{minimum_sheets:-1},{minimum_sheets:1.5},{minimum_sheets:'1,5'},{target_sheets:0,minimum_sheets:1},{target_sheets:1000001},{enabled:'false'}])assert.throws(()=>validateRule({...s,minimum_sheets:0,target_sheets:10,...patch}));
assert.throws(()=>validateRule({...s,minimum_sheets:null,target_sheets:10}),/./);
// Catalog spacing/case/NFC differences must not split stock or invalidate a rule.
const normalizedRows=[box('format-a','sealed',10,2,{type:'Habitat  Neutro',color:'Fumê',warehouse:'Galpão\u00A0 1'}),box('format-b','sealed',5,1,{type:' HABITAT\tNeutro\u200B ',color:'FUME\u0302',warehouse:' GALPÃO  1 '}),rule('format-rule',15,20,{type:'habitat\u00A0neutro',color:'fume\u0302'})];
const beforeNormalization=JSON.stringify(normalizedRows);
const normalizedBI=buildAnalytics(normalizedRows,{type:'HABITAT Neutro',color:' Fumê ',warehouse:'galpão 1'});
assert.equal(normalizedBI.charts.by_type.length,1);assert.equal(normalizedBI.charts.by_type[0].label,'Habitat Neutro');assert.equal(normalizedBI.charts.by_warehouse.length,1);assert.equal(normalizedBI.kpis.useful_sheets,12);assert.equal(normalizedBI.replenishment[0].useful_sheets,12);assert.equal(normalizedBI.replenishment[0].needed_sheets,8);assert.equal(JSON.stringify(normalizedRows),beforeNormalization,'normalization never changes source IDs or rows');
assert.equal(buildAnalytics(normalizedRows,{color:'Fume'}).kpis.useful_sheets,0,'accents identify different catalog names');
assert.equal(buildAnalytics(normalizedRows,{type:'HabitatNeutro'}).kpis.useful_sheets,0,'do not fuzzy-join product words');
assert.equal(buildAnalytics(normalizedRows,{type:'Habitat Neutro Solar'}).replenishment.length,0);
assert.equal(validateRule({...s,type:' Habitat  Neutro ',color:'Fume\u0302',minimum_sheets:1,target_sheets:2}).type,'Habitat Neutro');
console.log('PASS: BI cinco séries, estoque útil sem duplicidade, última contagem fechada, reposição global e limites, filtros, histórico sem valores inventados.');

// Quantity series are useful sheet counts, never m² divided by a guessed size.
const quantityBI=buildAnalytics(records);
assert.equal(quantityBI.kpis.sealed_useful_sheets,12);assert.equal(quantityBI.kpis.loose_useful_sheets,4);assert.equal(quantityBI.charts.by_type[0].useful_sheets,16);
assert.deepEqual(quantityBI.charts.evolution.map(x=>[x.date,x.useful_sheets,x.physical_sheets]),[['2026-11-20',17,20],['2026-11-25',17,20]]);
const historyWithoutQty=buildAnalytics([{id:'history',kind:'inventory',work_date:'2026-11-01',data:{status:'closed',summary:{useful_m2:500,total_m2:550}}}]);
assert.equal(historyWithoutQty.charts.evolution[0].useful_m2,500);assert.equal(historyWithoutQty.charts.evolution[0].useful_sheets,null);assert.equal(historyWithoutQty.charts.evolution[0].physical_sheets,null);assert.equal(historyWithoutQty.charts.evolution[0].available_sheets,false);assert.equal(historyWithoutQty.meta.history_quantity_incomplete,true);assert.equal(historyWithoutQty.meta.history_m2_incomplete,false);assert.equal(historyWithoutQty.meta.history_incomplete,true);
const historyKnownQty=buildAnalytics([{id:'history',kind:'inventory',work_date:'2026-11-01',data:{status:'closed',summary:{total_sheets:30,sealed_damaged:2,loose_damaged:1,total_m2:200}}}]);
assert.equal(historyKnownQty.charts.evolution[0].useful_sheets,27);assert.equal(historyKnownQty.charts.evolution[0].physical_sheets,30);assert.equal(historyKnownQty.charts.evolution[0].useful_m2,null);
const quantitySizes=buildAnalytics([inv('sizes','2026-11-25',[{...group,sheets:10,damaged:2,m2:20},{...group,width_mm:2000,sheets:10,damaged:0,m2:40}])]);
assert.equal(quantitySizes.charts.evolution[0].useful_sheets,18);assert.equal(quantitySizes.charts.evolution[0].useful_m2,56);
// Suggested replenishment intentionally aggregates exact SKU needs only by type.
const purchaseRecords=[box('first','sealed',2,1),rule('type-a',3,10),rule('type-b',2,5,{type:' COMUM ',color:'Verde',width_mm:2000}),rule('disabled',100,200,{type:'Laminado',enabled:false}),rule('none-needed',0,20,{type:'Espelho'}),box('enough','sealed',30,0,{type:'Espelho'})];
const purchaseBI=buildAnalytics(purchaseRecords);
assert.deepEqual(purchaseBI.charts.replenishment_by_type,[{label:'Comum',value:14,needed_sheets:14,needed_m2:38}]);
assert.equal(purchaseBI.kpis.replenishment_sheets,14);assert.equal(purchaseBI.kpis.replenishment_count,2);
const filteredPurchase=buildAnalytics(purchaseRecords,{color:'Verde',warehouse:'Outro galpão'});assert.equal(filteredPurchase.charts.replenishment_by_type[0].value,5);assert.equal(filteredPurchase.replenishment[0].needed_sheets,5);
assert.equal(buildAnalytics(purchaseRecords,{}).charts.replenishment_by_type[0].value,14,'banner uses a separate unfiltered analytics result');
assert.equal(buildAnalytics([rule('disabled',100,200,{enabled:false})]).charts.replenishment_by_type.length,0);
console.log('PASS: séries em quantidade, reposição por tipo, filtros globais e lacunas de histórico sem inferência.');
