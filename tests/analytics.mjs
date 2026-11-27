import assert from 'node:assert/strict';
import{buildAnalytics,validateRule,currentStock,currentPhysicalRows}from'../analytics.js';
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
a=buildAnalytics(records.map(r=>r.id==='r'?rule('r',16,20):r),{warehouse:'GALPÃO 2'});assert.equal(a.kpis.useful_sheets,4);assert.equal(a.replenishment[0].useful_sheets,16);assert.equal(a.replenishment[0].needed_sheets,4);assert.equal(a.charts.evolution.length,0,'G2 was not part of any completed scope; do not manufacture a zero point');
a=buildAnalytics(records,{type:'Laminado'});assert.equal(a.kpis.useful_m2,0);assert.equal(a.replenishment.length,0);
a=buildAnalytics(records,{color:'verde'});assert.equal(a.kpis.physical_sheets,0);
a=buildAnalytics(records,{thickness_mm:8});assert.equal(a.kpis.physical_sheets,0);
a=buildAnalytics(records,{from:'2026-11-21',to:'2026-11-30'});assert.equal(a.charts.evolution.length,1);assert.equal(a.charts.evolution[0].date,'2026-11-25');assert.equal(a.kpis.useful_sheets,16,'date range does not change current position');
// Case variants do not split the SKU or duplicate rule alerts.
a=buildAnalytics([box('a','sealed',2,0),rule('old',3,10),{...rule('new',5,20,{type:'COMUM',color:'INCOLOR'}),updated_at:'2026-11-26T12:00:00Z'}]);assert.equal(a.replenishment.length,1);assert.equal(a.replenishment[0].id,'new');assert.equal(a.replenishment[0].needed_sheets,18);assert.equal(a.meta.provisional,true);assert.equal(a.meta.last_closed_date,null);
a=buildAnalytics([rule('off',10,20,{enabled:false})]);assert.equal(a.kpis.replenishment_count,0);assert.equal(a.replenishment[0].needed_sheets,0);
a=buildAnalytics([rule('zero',0,0)]);assert.equal(a.replenishment[0].triggered,false);
a=buildAnalytics([rule('empty',0,10)]);assert.equal(a.replenishment[0].triggered,true);assert.equal(a.replenishment[0].needed_m2,20);
a=buildAnalytics(records.filter(r=>r.id!=='draft'));assert.equal(a.meta.provisional,true,'G2 has sealed stock but no completed local reference');
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

// Independent warehouse inventories retain their own latest loose baseline.
const G1='Galpão 1',G2='Galpão 2',G3='Galpão 3';
const scopedInv=(id,date,warehouses,groups=[],extra={})=>({id,kind:'inventory',work_date:date,created_at:date+'T08:00:00Z',data:{status:'closed',warehouses,closed_at:date+'T12:00:00Z',summary:{groups,missing_boxes:0,scope_warehouses:warehouses},...extra}});
const sg=(warehouse,sheets,damaged=0,extra={})=>({...s,warehouse,sheets,damaged,m2:sheets*2,...extra});
let scoped=[scopedInv('g1d1','2026-11-20',[G1]),loose('g1l','g1d1',10,2),scopedInv('g2d2','2026-11-21',[G2]),loose('g2l','g2d2',7,1,{warehouse:G2})];
assert.equal(buildAnalytics(scoped).kpis.physical_sheets,17);assert.equal(currentStock(scoped).loose.length,2);assert.equal(currentPhysicalRows(scoped).items.length,2);
scoped.push(scopedInv('g3d3','2026-11-22',[G3]));assert.equal(buildAnalytics(scoped).kpis.physical_sheets,17,'empty G3 snapshot must not erase G1/G2 loose stock');
scoped.push(scopedInv('g1d4','2026-11-23',[G1]));assert.equal(buildAnalytics(scoped).kpis.physical_sheets,7,'new empty G1 count clears only G1');
assert.equal(currentStock(scoped).references.find(r=>r.warehouse===G2).inventory_id,'g2d2');
// Evolution is per-local scope: separate sites never masquerade as global points.
const evo=buildAnalytics([scopedInv('one','2026-11-20',[G1],[sg(G1,10)]),scopedInv('two','2026-11-21',[G2],[sg(G2,20)])]);
assert.deepEqual(evo.charts.evolution.map(p=>[p.warehouse,p.physical_sheets]),[[G1,10],[G2,20]]);assert.equal(evo.charts.variation.length,0);assert.equal(evo.kpis.total_average_daily_reduction,null);
const move=(id,action,source,quantity,damaged,from_warehouse,to_warehouse,created_at,extra={})=>({id,kind:'stock_move',created_at,data:{...s,action,source,quantity,damaged,from_warehouse,...(to_warehouse?{to_warehouse}:{}),...extra}});
const base=[scopedInv('base1','2026-11-20',[G1]),loose('base-l1','base1',10,2),scopedInv('base2','2026-11-20',[G2]),loose('base-l2','base2',5,1,{warehouse:G2})];
const transfer=move('t','transfer','loose',2,0,G1,G2,'2026-11-20T14:00:00Z');
let moved=currentStock([...base,transfer]);assert.equal(moved.items.reduce((n,r)=>n+r.quantity,0),15);assert.equal(moved.loose.find(r=>r.data.warehouse===G1).data.quantity,8);assert.equal(moved.loose.find(r=>r.data.warehouse===G2).data.quantity,7);
const repack=move('r','repack','loose',3,1,G1,null,'2026-11-20T15:00:00Z');
const repackedBox=box('rbox','sealed',3,1,{source:'repack'});
let repacked=buildAnalytics([...base,transfer,repack,repackedBox]);assert.equal(repacked.kpis.physical_sheets,15);assert.equal(repacked.kpis.damaged_sheets,3);assert.equal(repacked.kpis.useful_sheets,12);
const writeoff=move('w','writeoff','loose',1,1,G2,null,'2026-11-20T16:00:00Z');
let written=buildAnalytics([...base,transfer,repack,repackedBox,writeoff]);assert.equal(written.kpis.physical_sheets,14);assert.equal(written.kpis.damaged_sheets,2);assert.equal(written.kpis.useful_sheets,12,'writing off a damaged sheet does not subtract a useful sheet twice');
const boxWriteoff=move('wb','writeoff','box',1,0,G1,null,'2026-11-20T17:00:00Z',{box_id:'rbox'});
let boxWritten=buildAnalytics([...base,transfer,repack,{...repackedBox,data:{...repackedBox.data,sheets:2}},writeoff,boxWriteoff]);assert.equal(boxWritten.kpis.physical_sheets,13,'box row already reflects its writeoff; do not subtract box ledger twice');
// A newer source baseline already contains the source half of a transfer; target still needs the event.
let asymmetric=currentStock([...base,transfer,scopedInv('later1','2026-11-21',[G1]),loose('new-l1','later1',8,2)]);assert.equal(asymmetric.items.reduce((n,r)=>n+r.quantity,0),15);
let reset=currentStock([...base,transfer,scopedInv('later2','2026-11-21',[G2])]);assert.equal(reset.loose.some(r=>r.data.warehouse===G2),false);assert.equal(reset.loose.find(r=>r.data.warehouse===G1).data.quantity,8);
// Current box location is authoritative; transfer ledger only adjusts loose when source=loose.
const transferredBox=box('tb','sealed',4,1,{warehouse:G2});assert.equal(buildAnalytics([transferredBox,move('bt','transfer','box',4,1,G1,G2,'2026-11-21T12:00:00Z')]).kpis.physical_sheets,4);
// Repack boxes never become external receipts in historical interval arithmetic.
const prev=scopedInv('v1','2026-11-20',[G1],[sg(G1,100)]);
const next=scopedInv('v2','2026-11-22',[G1],[sg(G1,106)]);
const external=box('receipt','sealed',5,0,{received_at:'2026-11-21T09:00:00Z',received_warehouse:G1,received_sheets:20,warehouse:G2});external.created_at='2026-11-21T09:00:00Z';
const internal=box('internal','sealed',30,0,{source:'repack'});internal.created_at='2026-11-21T10:00:00Z';
const incomingMove=move('tin','transfer','box',4,0,G2,G1,'2026-11-21T10:30:00Z');
const outgoingMove=move('tout','transfer','loose',3,0,G1,G2,'2026-11-21T10:35:00Z');
const manualMove=move('manual','writeoff','box',10,0,G1,null,'2026-11-21T11:00:00Z',{box_id:'receipt'});
const intervalBI=buildAnalytics([prev,next,external,internal,incomingMove,outgoingMove,manualMove]);const point=intervalBI.charts.variation[0];
assert.equal(point.entries_sheets,20,'immutable receipt quantity and original warehouse survive current box changes');assert.equal(point.transfers_in_sheets,4);assert.equal(point.transfers_out_sheets,3);assert.equal(point.confirmed_manual_sheets,10);assert.equal(point.expected_physical_sheets,111);assert.equal(point.delta_sheets,-5);assert.equal(point.apparent_reduction,5);assert.equal(point.total_estimated_reduction,15);assert.equal(intervalBI.kpis.manual_average_daily_writeoff,5);assert.equal(intervalBI.kpis.apparent_average_daily_reduction,2.5);assert.equal(intervalBI.kpis.total_average_daily_reduction,7.5);
// Immutable original entry date prevents repacks or later row edits from creating receipt spikes.
const oldReceipt=box('oldr','sealed',40,0,{received_at:'2026-11-19T09:00:00Z',received_warehouse:G1,received_sheets:50});oldReceipt.created_at='2026-11-21T10:00:00Z';assert.equal(buildAnalytics([prev,next,oldReceipt]).charts.variation[0].entries_sheets,0);
// Missing/unknown/zero-day intervals are omitted, never invented as zero reductions.
const missingNext={...next,data:{...next.data,summary:{...next.data.summary,missing_boxes:1,missing_by_warehouse:[{warehouse:G1,boxes:1}]}}};
assert.equal(buildAnalytics([prev,missingNext]).charts.variation.length,0);assert.equal(buildAnalytics([prev,missingNext]).meta.variation_excluded_intervals[0].reason,'unresolved_missing_boxes');
const localKnown={...next,data:{...next.data,summary:{...next.data.summary,missing_boxes:1,missing_by_warehouse:[{warehouse:G2,boxes:1}]}}};assert.equal(buildAnalytics([prev,localKnown]).charts.variation.length,1,'a reliable per-site missing map does not contaminate another location');
const inconsistentMissing={...next,data:{...next.data,summary:{...next.data.summary,missing_boxes:1,missing_by_warehouse:[]}}};assert.equal(buildAnalytics([prev,inconsistentMissing]).charts.variation.length,0,'incomplete missing map must not imply no missing boxes');
assert.equal(buildAnalytics([prev,{...next,work_date:prev.work_date}]).charts.variation.length,0);assert.equal(buildAnalytics([prev,{...next,data:{...next.data,closed_at:undefined}}]).charts.variation.length,0);
// Colour and thickness distributions sum useful stock; normalized labels remain one group.
const distributions=buildAnalytics([box('d1','sealed',10,2),box('d2','sealed',5,1,{color:' INCOLOR ',thickness_mm:8}),box('d3','sealed',3,0,{color:'Verde',thickness_mm:6})]);
assert.equal(distributions.charts.by_color.find(r=>r.label==='Incolor').useful_sheets,12);assert.equal(distributions.charts.by_color.find(r=>r.label==='Incolor').value,24);assert.deepEqual(distributions.charts.by_thickness.map(r=>[r.label,r.useful_sheets]),[['6 mm',11],['8 mm',4]]);
console.log('PASS: escopos independentes, ledger avulso/caixa sem dupla baixa, quantidades úteis por cor/espessura, variação física ajustada e médias observadas.');
