/** Inventory BI: physical stock snapshots, never inferred consumption or sales. */
import {sku,validateBox,catalogText,catalogKey} from './utils.js?v=20261126-catalog';
const data=row=>row?.data??row??{};
const normalized=catalogKey;
const round=value=>Math.round((value+Number.EPSILON)*1e6)/1e6;
const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
const dims=spec=>({type:catalogText(spec.type),color:catalogText(spec.color),thickness_mm:Number(spec.thickness_mm),width_mm:Number(spec.width_mm),height_mm:Number(spec.height_mm)});
const sheetArea=s=>Number(s.width_mm)*Number(s.height_mm)/1e6;
const count=value=>{if(value===undefined||value===null||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))throw new Error('Informe o estoque mínimo e o alvo.');if(typeof value==='string'&&!/^\d+$/.test(value.trim()))throw new Error('Use quantidades inteiras sem separador de milhar.');const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>1000000)throw new Error('Mínimo e alvo devem ser inteiros entre 0 e 1.000.000.');return n;};
/** Global per-SKU thresholds; target is a stock quantity, never a purchase forecast. */
export function validateRule(raw){
 const s=data(raw),spec=validateBox({...s,invoice:'REGRA',warehouse:'GLOBAL',sheets:1,damaged:0});
 const minimum_sheets=count(s.minimum_sheets),target_sheets=count(s.target_sheets);
 if(target_sheets<minimum_sheets)throw new Error('O estoque alvo deve ser maior ou igual ao estoque mínimo.');
 if(s.enabled!==undefined&&typeof s.enabled!=='boolean')throw new Error('Informe se a regra está ativa ou inativa.');
 return{...dims(spec),minimum_sheets,target_sheets,enabled:s.enabled??true};
}
function matches(s,filters,{warehouse=true}={}){
 for(const key of ['type','color'])if(filters[key]!==undefined&&filters[key]!==''&&normalized(s[key])!==normalized(filters[key]))return false;
 const thickness=filters.thickness_mm??filters.thickness;
 if(thickness!==undefined&&thickness!==''&&Number(s.thickness_mm)!==Number(String(thickness).replace(',','.')))return false;
 if(warehouse&&filters.warehouse!==undefined&&filters.warehouse!==''&&normalized(s.warehouse)!==normalized(filters.warehouse))return false;
 return true;
}
function closedSort(a,b){return String(b.work_date??'').localeCompare(String(a.work_date??''))||String(b.data?.closed_at??b.updated_at??b.created_at??'').localeCompare(String(a.data?.closed_at??a.updated_at??a.created_at??''))||String(b.id??'').localeCompare(String(a.id??''));}
function latestClosed(rows){return rows.filter(r=>r.kind==='inventory'&&r.data?.status==='closed').sort(closedSort);}
function inventoryWarehouses(inv,rows){
 const explicit=inv.data?.warehouses??inv.data?.summary?.scope_warehouses;
 const candidates=Array.isArray(explicit)&&explicit.length?explicit:[...(inv.data?.summary?.groups??[]).map(g=>g.warehouse),...rows.filter(r=>r.kind==='loose'&&r.parent_id===inv.id).map(r=>r.data.warehouse)];
 return [...new Map(candidates.filter(Boolean).map(w=>[normalized(w),catalogText(w)])).values()];
}
/** Current physical balances: immutable local counts plus subsequent loose movements. */
export function currentStock(rows){
 const closed=latestClosed(rows),last=closed[0]??null,locations=new Map(),issues=[];
 const add=w=>{if(w)locations.set(normalized(w),catalogText(w));};
 for(const r of rows){if(r.kind==='catalog'&&r.data?.category==='warehouse')add(r.data.value);if(r.data?.warehouse)add(r.data.warehouse);if(r.kind==='stock_move'){add(r.data.from_warehouse);add(r.data.to_warehouse);}if(r.kind==='inventory')for(const w of inventoryWarehouses(r,rows))add(w);}
 const references=[...locations].map(([key,warehouse])=>{
  const inv=closed.find(i=>inventoryWarehouses(i,rows).some(w=>normalized(w)===key));
  const has_active=rows.some(i=>i.kind==='inventory'&&i.data?.status==='active'&&inventoryWarehouses(i,rows).some(w=>normalized(w)===key));
  return{warehouse,inventory_id:inv?.id??null,work_date:inv?.work_date??null,closed_at:inv?.data?.closed_at??null,has_reference:!!inv,has_active,older_than_latest_reference:!!inv&&String(inv.work_date)<String(last?.work_date??'')};
 }).sort((a,b)=>a.warehouse.localeCompare(b.warehouse,'pt-BR'));
 const refs=new Map(references.map(r=>[normalized(r.warehouse),r]));
 const boxes=rows.filter(r=>r.kind==='box'&&r.data?.status==='sealed');
 const balances=new Map();
 function change(s,warehouse,quantity,damaged){const key=sku(s)+'|'+normalized(warehouse);if(!balances.has(key))balances.set(key,{...dims(s),warehouse:catalogText(warehouse),quantity:0,damaged:0,key});const b=balances.get(key);b.quantity+=quantity;b.damaged+=damaged;}
 for(const r of rows.filter(r=>r.kind==='loose'&&refs.get(normalized(r.data?.warehouse))?.inventory_id===r.parent_id))change(r.data,r.data.warehouse,numeric(r.data.quantity),numeric(r.data.damaged));
 function afterBaseline(row,warehouse){
  const ref=refs.get(normalized(warehouse)),timestamp=Date.parse(row.created_at);
  if(!Number.isFinite(timestamp)){issues.push({code:'invalid_move_timestamp',id:row.id,warehouse});return false;}
  if(!ref?.has_reference)return true;
  const baseline=Date.parse(ref.closed_at);if(!Number.isFinite(baseline)){issues.push({code:'unknown_local_baseline_timestamp',id:row.id,warehouse});return false;}
  return timestamp>baseline;
 }
 for(const row of rows.filter(r=>r.kind==='stock_move'&&r.data?.source==='loose')){
  const s=row.data,q=numeric(s.quantity),d=numeric(s.damaged);
  if(['repack','writeoff','transfer'].includes(s.action)&&afterBaseline(row,s.from_warehouse))change(s,s.from_warehouse,-q,-d);
  if(s.action==='transfer'&&s.to_warehouse&&afterBaseline(row,s.to_warehouse))change(s,s.to_warehouse,q,d);
 }
 const loose=[];for(const b of balances.values()){
  if(b.quantity<0||b.damaged<0||b.damaged>b.quantity){issues.push({code:'inconsistent_loose_balance',warehouse:b.warehouse,key:b.key,quantity:b.quantity,damaged:b.damaged});continue;}
  if(b.quantity===0)continue;loose.push({id:'derived-'+b.key,kind:'loose',derived:true,data:{...dims(b),warehouse:b.warehouse,quantity:b.quantity,damaged:b.damaged}});
 }
 const items=[...boxes.map(r=>({id:r.id,...dims(r.data),warehouse:catalogText(r.data.warehouse),source:'sealed',quantity:numeric(r.data.sheets),damaged:numeric(r.data.damaged)})),...loose.map(r=>({id:r.id,...dims(r.data),warehouse:catalogText(r.data.warehouse),source:'loose',quantity:r.data.quantity,damaged:r.data.damaged}))];
 return{items,boxes,loose,references,latest_closed:last,issues};
}
// Retain the earlier public helper used by overview callers.
export const currentPhysicalRows=currentStock;
function aggregateStock(items){
 const groups=new Map();
 for(const s of items){const key=sku(s)+'|'+normalized(s.warehouse);if(!groups.has(key))groups.set(key,{key,sku:sku(s),...dims(s),warehouse:s.warehouse,sealed_sheets:0,loose_sheets:0,physical_sheets:0,damaged_sheets:0,useful_sheets:0,sealed_useful_sheets:0,loose_useful_sheets:0,physical_m2:0,damaged_m2:0,useful_m2:0,sealed_useful_m2:0,loose_useful_m2:0});
  const g=groups.get(key),good=s.quantity-s.damaged,a=sheetArea(s);
  g.physical_sheets+=s.quantity;g.damaged_sheets+=s.damaged;g.useful_sheets+=good;g.physical_m2+=s.quantity*a;g.damaged_m2+=s.damaged*a;g.useful_m2+=good*a;g[s.source==='sealed'?'sealed_sheets':'loose_sheets']+=s.quantity;g[s.source==='sealed'?'sealed_useful_sheets':'loose_useful_sheets']+=good;g[s.source==='sealed'?'sealed_useful_m2':'loose_useful_m2']+=good*a;
 }
 return [...groups.values()].map(g=>{for(const k of ['physical_m2','damaged_m2','useful_m2','sealed_useful_m2','loose_useful_m2'])g[k]=round(g[k]);return g;});
}
function historicalPoint(inv,filters,warehouse=null){
 const summary=inv.data.summary||{},scoped=warehouse?{...filters,warehouse}:filters,hasFilters=['warehouse','type','color','thickness_mm','thickness'].some(k=>scoped[k]!==undefined&&scoped[k]!=='');
 if(Array.isArray(summary.groups)){
  const groups=summary.groups.filter(s=>matches(s,scoped));
  let useful=0,physical=0,usefulSheets=0,physicalSheets=0;for(const s of groups){const q=numeric(s.sheets??s.total_sheets),damaged=numeric(s.damaged??s.damaged_sheets);physical+=s.m2!==undefined?numeric(s.m2):q*sheetArea(s);useful+=(q-damaged)*sheetArea(s);usefulSheets+=q-damaged;physicalSheets+=q;}
  return{date:inv.work_date,id:inv.id,warehouse,useful_m2:round(useful),physical_m2:round(physical),useful_sheets:usefulSheets,physical_sheets:physicalSheets,available:true,available_sheets:true};
 }
 const usable=summary.useful_m2??summary.total_useful_m2,physicalSheets=summary.total_sheets??summary.physical_sheets;
 const knownDamage=summary.damaged_sheets??(summary.sealed_damaged!==undefined&&summary.loose_damaged!==undefined?numeric(summary.sealed_damaged)+numeric(summary.loose_damaged):undefined);
 const usefulSheets=summary.useful_sheets??summary.total_useful_sheets??(physicalSheets!==undefined&&knownDamage!==undefined?numeric(physicalSheets)-numeric(knownDamage):undefined);
 return{date:inv.work_date,id:inv.id,warehouse,useful_m2:!hasFilters&&usable!==undefined?numeric(usable):null,physical_m2:!hasFilters&&summary.total_m2!==undefined?numeric(summary.total_m2):null,useful_sheets:!hasFilters&&usefulSheets!==undefined?numeric(usefulSheets):null,physical_sheets:!hasFilters&&physicalSheets!==undefined?numeric(physicalSheets):null,available:!hasFilters&&usable!==undefined,available_sheets:!hasFilters&&usefulSheets!==undefined};
}
function missingAt(inv,warehouse){
 const summary=inv.data?.summary??{},per=summary.missing_by_warehouse;
 if(Array.isArray(per)){const total=per.reduce((sum,r)=>sum+numeric(r.missing_boxes??r.boxes??r.count??r.missing),0);if(total<numeric(summary.missing_boxes))return numeric(summary.missing_boxes);const row=per.find(r=>normalized(r.warehouse)===normalized(warehouse));return row?numeric(row.missing_boxes??row.boxes??row.count??row.missing):0;}
 if(per&&typeof per==='object'){const entry=Object.entries(per).find(([w])=>normalized(w)===normalized(warehouse));return entry?numeric(typeof entry[1]==='object'?(entry[1].missing_boxes??entry[1].boxes??entry[1].count):entry[1]):0;}
 return numeric(summary.missing_boxes);
}
function elapsedDays(previous,current){const a=Date.parse(previous+'T00:00:00Z'),b=Date.parse(current+'T00:00:00Z');return Number.isFinite(a)&&Number.isFinite(b)?(b-a)/86400000:NaN;}
function intervalAnalysis(rows,closed,filters){
 const byWarehouse=new Map(),points=[],excluded=[];
 for(const inv of [...closed].reverse())for(const warehouse of inventoryWarehouses(inv,rows)){
  if(filters.warehouse&&normalized(filters.warehouse)!==normalized(warehouse))continue;
  const key=normalized(warehouse);if(!byWarehouse.has(key))byWarehouse.set(key,[]);byWarehouse.get(key).push({inv,warehouse});
 }
 for(const entries of byWarehouse.values())for(let i=1;i<entries.length;i++){
  const{inv:prev,warehouse}=entries[i-1],curr=entries[i].inv;
  if(filters.from&&curr.work_date<filters.from||filters.to&&curr.work_date>filters.to)continue;
  const base={date:curr.work_date,previous_date:prev.work_date,warehouse,previous_id:prev.id,id:curr.id},days=elapsedDays(prev.work_date,curr.work_date);
  const skip=reason=>excluded.push({...base,reason});
  if(!Number.isFinite(days)||days<=0){skip('non_positive_calendar_interval');continue;}
  const a=Date.parse(prev.data?.closed_at),b=Date.parse(curr.data?.closed_at);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a){skip('missing_or_invalid_close_timestamps');continue;}
  if(missingAt(prev,warehouse)>0||missingAt(curr,warehouse)>0){skip('unresolved_missing_boxes');continue;}
  const before=historicalPoint(prev,filters,warehouse),after=historicalPoint(curr,filters,warehouse);
  if(before.physical_sheets===null||after.physical_sheets===null){skip('missing_physical_snapshot');continue;}
  const incoming=rows.filter(r=>r.kind==='box'&&r.data?.source!=='repack'&&normalized(r.data?.received_warehouse??r.data?.warehouse)===normalized(warehouse)&&matches(r.data,filters,{warehouse:false})&&Date.parse(r.data?.received_at??r.created_at)>a&&Date.parse(r.data?.received_at??r.created_at)<=b);
  // Receipt metadata is immutable: current box balances may have changed later.
  const entries_sheets=incoming.reduce((sum,r)=>sum+numeric(r.data.received_sheets??r.data.sheets),0);
  const moves=rows.filter(r=>r.kind==='stock_move'&&matches(r.data,filters,{warehouse:false})&&Date.parse(r.created_at)>a&&Date.parse(r.created_at)<=b);
  let transfers_in_sheets=0,transfers_out_sheets=0,confirmed_manual_sheets=0;
  for(const r of moves){const m=r.data,q=numeric(m.quantity);if(m.action==='transfer'){if(normalized(m.to_warehouse)===normalized(warehouse))transfers_in_sheets+=q;if(normalized(m.from_warehouse)===normalized(warehouse))transfers_out_sheets+=q;}else if(m.action==='writeoff'&&normalized(m.from_warehouse)===normalized(warehouse))confirmed_manual_sheets+=q;}
  // Physical quantity includes avarias. Repack is neutral and never a receipt.
  const expected=before.physical_sheets+entries_sheets+transfers_in_sheets-transfers_out_sheets-confirmed_manual_sheets,delta=after.physical_sheets-expected,apparent_reduction=Math.max(0,-delta);
  points.push({...base,elapsed_days:days,previous_physical_sheets:before.physical_sheets,current_physical_sheets:after.physical_sheets,entries_sheets,transfers_in_sheets,transfers_out_sheets,confirmed_manual_sheets,expected_physical_sheets:expected,delta_sheets:delta,variation_sheets:delta,apparent_reduction,total_estimated_reduction:confirmed_manual_sheets+apparent_reduction});
 }
 points.sort((a,b)=>a.date.localeCompare(b.date)||a.warehouse.localeCompare(b.warehouse,'pt-BR'));
 const totalDays=points.reduce((sum,p)=>sum+p.elapsed_days,0),reductions=points.reduce((sum,p)=>sum+p.apparent_reduction,0),manual=points.reduce((sum,p)=>sum+p.confirmed_manual_sheets,0),rates=new Map();
 for(const p of points){const key=normalized(p.warehouse);if(!rates.has(key))rates.set(key,{warehouse:p.warehouse,elapsed_days:0,apparent_reduction:0,confirmed_manual_sheets:0,total_estimated_reduction:0,intervals:0});const r=rates.get(key);r.elapsed_days+=p.elapsed_days;r.apparent_reduction+=p.apparent_reduction;r.confirmed_manual_sheets+=p.confirmed_manual_sheets;r.total_estimated_reduction+=p.total_estimated_reduction;r.intervals++;}
 return{points,excluded,totalDays,reductions,manual,totalReduction:reductions+manual,average:totalDays?round(reductions/totalDays):null,manualAverage:totalDays?round(manual/totalDays):null,totalAverage:totalDays?round((manual+reductions)/totalDays):null,rates:[...rates.values()].map(r=>({...r,daily_rate:round(r.apparent_reduction/r.elapsed_days),manual_daily_rate:round(r.confirmed_manual_sheets/r.elapsed_days),total_daily_rate:round(r.total_estimated_reduction/r.elapsed_days)}))};
}
/**
 * Current position = sealed boxes now + loose count from only the latest CLOSED
 * inventory per warehouse. Drafts are never stock. Date filters affect historical evolution;
 * warehouse filters affect stock charts, never the GLOBAL replenishment rule.
 */
export function buildAnalytics(rows,filters={}){
 if(!Array.isArray(rows))throw new Error('Registros do inventário inválidos.');
 const closed=latestClosed(rows),last=closed[0]??null,has_active=rows.some(r=>r.kind==='inventory'&&r.data?.status==='active');
 const current=currentPhysicalRows(rows),selectedReferences=current.references.filter(r=>!filters.warehouse||normalized(r.warehouse)===normalized(filters.warehouse));
 const provisional=has_active||!last||selectedReferences.some(r=>!r.has_reference)||current.issues.length>0;
 const replenishmentProvisional=has_active||!last||current.references.some(r=>!r.has_reference)||current.issues.length>0;
 const physical=current.items,groups=aggregateStock(physical.filter(s=>matches(s,filters))),global=aggregateStock(physical.filter(s=>matches(s,filters,{warehouse:false})));
 const kpis={useful_sheets:0,sealed_useful_sheets:0,loose_useful_sheets:0,useful_m2:0,sealed_useful_m2:0,loose_useful_m2:0,damaged_sheets:0,damaged_m2:0,physical_sheets:0,physical_m2:0,damaged_percent:0,replenishment_count:0,replenishment_sheets:0,replenishment_m2:0,apparent_average_daily_reduction:null,manual_average_daily_writeoff:null,total_average_daily_reduction:null};
 const byType=new Map(),byColor=new Map(),byThickness=new Map(),byWarehouse=new Map();
 for(const g of groups){for(const k of ['useful_sheets','sealed_useful_sheets','loose_useful_sheets','useful_m2','sealed_useful_m2','loose_useful_m2','damaged_sheets','damaged_m2','physical_sheets','physical_m2'])kpis[k]+=g[k];const tk=normalized(g.type),wk=normalized(g.warehouse);if(!byType.has(tk))byType.set(tk,{label:g.type,value:0,useful_sheets:0});byType.get(tk).value+=g.useful_m2;byType.get(tk).useful_sheets+=g.useful_sheets;for(const[map,key,label]of [[byColor,normalized(g.color),g.color],[byThickness,String(Number(g.thickness_mm)),String(Number(g.thickness_mm))+' mm']]){if(!map.has(key))map.set(key,{label,value:0,useful_sheets:0});map.get(key).value+=g.useful_m2;map.get(key).useful_sheets+=g.useful_sheets;}if(!byWarehouse.has(wk))byWarehouse.set(wk,{label:g.warehouse,sealed_m2:0,loose_m2:0,sealed_sheets:0,loose_sheets:0});byWarehouse.get(wk).sealed_m2+=g.sealed_useful_m2;byWarehouse.get(wk).loose_m2+=g.loose_useful_m2;byWarehouse.get(wk).sealed_sheets+=g.sealed_useful_sheets;byWarehouse.get(wk).loose_sheets+=g.loose_useful_sheets;}
 kpis.damaged_percent=kpis.physical_sheets?round(100*kpis.damaged_sheets/kpis.physical_sheets):0;
 // Keep one rule per exact SKU. Valid storage guarantees uniqueness; latest wins
 // defensively if the caller supplies duplicated rows or mixed-case versions.
 const ruleMap=new Map();for(const row of rows.filter(r=>r.kind==='reorder_rule').sort((a,b)=>String(a.updated_at??a.created_at??'').localeCompare(String(b.updated_at??b.created_at??''))||String(a.id??'').localeCompare(String(b.id??'')))){const rule=validateRule(row);ruleMap.set(sku(rule),{id:row.id,...rule});}
 const replenishment=[],replenishmentByType=new Map();
 for(const rule of ruleMap.values()){
  if(!matches(rule,filters,{warehouse:false}))continue;
  const useful_sheets=global.filter(g=>g.sku===sku(rule)).reduce((n,g)=>n+g.useful_sheets,0),triggered=rule.enabled&&useful_sheets<=rule.minimum_sheets&&rule.target_sheets>useful_sheets,needed_sheets=triggered?Math.max(rule.target_sheets-useful_sheets,0):0;
  const needed_m2=round(needed_sheets*sheetArea(rule));replenishment.push({...rule,spec:dims(rule),useful_sheets,needed_sheets,needed_m2,triggered,provisional:replenishmentProvisional,scope:'all_warehouses'});
  if(triggered){const typeKey=normalized(rule.type);if(!replenishmentByType.has(typeKey))replenishmentByType.set(typeKey,{label:rule.type,value:0,needed_sheets:0,needed_m2:0});const purchase=replenishmentByType.get(typeKey);purchase.value+=needed_sheets;purchase.needed_sheets+=needed_sheets;purchase.needed_m2+=needed_m2;kpis.replenishment_count++;kpis.replenishment_sheets+=needed_sheets;kpis.replenishment_m2+=needed_m2;}
 }
 for(const k of ['useful_m2','sealed_useful_m2','loose_useful_m2','damaged_m2','physical_m2','replenishment_m2'])kpis[k]=round(kpis[k]);
 const evolution=[];for(const inv of [...closed].reverse()){
  if(filters.from&&inv.work_date<filters.from||filters.to&&inv.work_date>filters.to)continue;
  const scope=inventoryWarehouses(inv,rows).filter(w=>!filters.warehouse||normalized(w)===normalized(filters.warehouse));
  if(scope.length)for(const warehouse of scope)evolution.push(historicalPoint(inv,filters,warehouse));
  else if(!filters.warehouse&&!inventoryWarehouses(inv,rows).length)evolution.push({...historicalPoint(inv,filters),scope_unknown:true});
 }
 const variation=intervalAnalysis(rows,closed,filters);kpis.apparent_average_daily_reduction=variation.average;kpis.manual_average_daily_writeoff=variation.manualAverage;kpis.total_average_daily_reduction=variation.totalAverage;
 return{kpis,meta:{provisional,incomplete:provisional,has_active,last_closed_date:last?.work_date??null,last_closed_id:last?.id??null,history_incomplete:evolution.some(p=>!p.available||!p.available_sheets),history_m2_incomplete:evolution.some(p=>!p.available),history_quantity_incomplete:evolution.some(p=>!p.available_sheets),replenishment_scope:'all_warehouses',replenishment_provisional:replenishmentProvisional,stock_reference:'sealed_now_and_last_closed_loose_per_warehouse',warehouse_references:selectedReferences,variation_days:variation.totalDays,variation_comparable_intervals:variation.points.length,variation_excluded_intervals:variation.excluded,stock_issues:current.issues,variation_apparent_reduction:variation.reductions,variation_confirmed_manual:variation.manual,variation_total_estimated:variation.totalReduction,variation_average_unit:'chapas/local/dia',variation_formula:'sum(confirmed_manual_sheets+apparent_reduction)/sum(elapsed_calendar_days_per_warehouse)',daily_reduction_by_warehouse:variation.rates,evolution_scope:'per_warehouse'},groups,replenishment,charts:{by_color:[...byColor.values()].map(x=>({...x,value:round(x.value)})).sort((a,b)=>b.value-a.value),by_thickness:[...byThickness.values()].map(x=>({...x,value:round(x.value)})).sort((a,b)=>Number(a.label.split(' ')[0])-Number(b.label.split(' ')[0])),variation:variation.points,replenishment_by_type:[...replenishmentByType.values()].map(x=>({...x,needed_m2:round(x.needed_m2)})).sort((a,b)=>b.value-a.value||String(a.label).localeCompare(String(b.label),'pt-BR')),by_type:[...byType.values()].map(x=>({...x,value:round(x.value)})).sort((a,b)=>b.value-a.value),by_warehouse:[...byWarehouse.values()].map(x=>({...x,sealed_m2:round(x.sealed_m2),loose_m2:round(x.loose_m2)})).sort((a,b)=>String(a.label).localeCompare(String(b.label),'pt-BR')),condition:[{label:'Chapas úteis',value:kpis.useful_sheets},{label:'Chapas avariadas',value:kpis.damaged_sheets}],evolution}};
}
