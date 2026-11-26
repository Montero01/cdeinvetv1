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
assert.equal(a.charts.by_type.length,1);assert.equal(a.charts.by_type[0].value,32);assert.equal(a.charts.by_warehouse.length,2);assert.deepEqual(a.charts.by_warehouse[0],{label:'Galpão 1',sealed_m2:16,loose_m2:8});assert.deepEqual(a.charts.condition,[{label:'Chapas úteis',value:16},{label:'Chapas avariadas',value:3}]);assert.deepEqual(a.charts.evolution.map(p=>[p.date,p.useful_m2]),[['2026-11-20',34],['2026-11-25',34]]);
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
console.log('PASS: BI quatro séries, estoque útil sem duplicidade, última contagem fechada, reposição global e limites, filtros, histórico sem valores inventados.');
