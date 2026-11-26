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
function latestClosed(rows){return rows.filter(r=>r.kind==='inventory'&&r.data?.status==='closed').sort((a,b)=>String(b.work_date??'').localeCompare(String(a.work_date??''))||String(b.created_at??'').localeCompare(String(a.created_at??''))||String(b.id??'').localeCompare(String(a.id??'')));}
function physicalRows(rows,last){
 return[...rows.filter(r=>r.kind==='box'&&r.data?.status==='sealed').map(r=>({id:r.id,...dims(r.data),warehouse:catalogText(r.data.warehouse),source:'sealed',quantity:numeric(r.data.sheets),damaged:numeric(r.data.damaged)})),...rows.filter(r=>r.kind==='loose'&&last&&r.parent_id===last.id).map(r=>({id:r.id,...dims(r.data),warehouse:catalogText(r.data.warehouse),source:'loose',quantity:numeric(r.data.quantity),damaged:numeric(r.data.damaged)}))];
}
function aggregateStock(items){
 const groups=new Map();
 for(const s of items){const key=sku(s)+'|'+normalized(s.warehouse);if(!groups.has(key))groups.set(key,{key,sku:sku(s),...dims(s),warehouse:s.warehouse,sealed_sheets:0,loose_sheets:0,physical_sheets:0,damaged_sheets:0,useful_sheets:0,sealed_useful_sheets:0,loose_useful_sheets:0,physical_m2:0,damaged_m2:0,useful_m2:0,sealed_useful_m2:0,loose_useful_m2:0});
  const g=groups.get(key),good=s.quantity-s.damaged,a=sheetArea(s);
  g.physical_sheets+=s.quantity;g.damaged_sheets+=s.damaged;g.useful_sheets+=good;g.physical_m2+=s.quantity*a;g.damaged_m2+=s.damaged*a;g.useful_m2+=good*a;g[s.source==='sealed'?'sealed_sheets':'loose_sheets']+=s.quantity;g[s.source==='sealed'?'sealed_useful_sheets':'loose_useful_sheets']+=good;g[s.source==='sealed'?'sealed_useful_m2':'loose_useful_m2']+=good*a;
 }
 return [...groups.values()].map(g=>{for(const k of ['physical_m2','damaged_m2','useful_m2','sealed_useful_m2','loose_useful_m2'])g[k]=round(g[k]);return g;});
}
function historicalPoint(inv,filters){
 const summary=inv.data.summary||{},hasFilters=['warehouse','type','color','thickness_mm','thickness'].some(k=>filters[k]!==undefined&&filters[k]!=='');
 if(Array.isArray(summary.groups)){
  const groups=summary.groups.filter(s=>matches(s,filters));
  let useful=0,physical=0,usefulSheets=0,physicalSheets=0;for(const s of groups){const q=numeric(s.sheets??s.total_sheets),damaged=numeric(s.damaged??s.damaged_sheets);physical+=s.m2!==undefined?numeric(s.m2):q*sheetArea(s);useful+=(q-damaged)*sheetArea(s);usefulSheets+=q-damaged;physicalSheets+=q;}
  return{date:inv.work_date,id:inv.id,useful_m2:round(useful),physical_m2:round(physical),useful_sheets:usefulSheets,physical_sheets:physicalSheets,available:true,available_sheets:true};
 }
 // A total damage percentage cannot determine damaged m² when sheet sizes differ.
 const usable=summary.useful_m2??summary.total_useful_m2;
 const physicalSheets=summary.total_sheets??summary.physical_sheets;
 const knownDamage=summary.damaged_sheets??(summary.sealed_damaged!==undefined&&summary.loose_damaged!==undefined?numeric(summary.sealed_damaged)+numeric(summary.loose_damaged):undefined);
 const usefulSheets=summary.useful_sheets??summary.total_useful_sheets??(physicalSheets!==undefined&&knownDamage!==undefined?numeric(physicalSheets)-numeric(knownDamage):undefined);
 return{date:inv.work_date,id:inv.id,useful_m2:!hasFilters&&usable!==undefined?numeric(usable):null,physical_m2:!hasFilters&&summary.total_m2!==undefined?numeric(summary.total_m2):null,useful_sheets:!hasFilters&&usefulSheets!==undefined?numeric(usefulSheets):null,physical_sheets:!hasFilters&&physicalSheets!==undefined?numeric(physicalSheets):null,available:!hasFilters&&usable!==undefined,available_sheets:!hasFilters&&usefulSheets!==undefined};
}
/**
 * Current position = sealed boxes now + loose count from only the latest CLOSED
 * inventory. Drafts are never stock. Date filters affect historical evolution;
 * warehouse filters affect stock charts, never the GLOBAL replenishment rule.
 */
export function buildAnalytics(rows,filters={}){
 if(!Array.isArray(rows))throw new Error('Registros do inventário inválidos.');
 const closed=latestClosed(rows),last=closed[0]??null,has_active=rows.some(r=>r.kind==='inventory'&&r.data?.status==='active');
 const provisional=has_active||!last;
 const physical=physicalRows(rows,last),groups=aggregateStock(physical.filter(s=>matches(s,filters))),global=aggregateStock(physical.filter(s=>matches(s,filters,{warehouse:false})));
 const kpis={useful_sheets:0,sealed_useful_sheets:0,loose_useful_sheets:0,useful_m2:0,sealed_useful_m2:0,loose_useful_m2:0,damaged_sheets:0,damaged_m2:0,physical_sheets:0,physical_m2:0,damaged_percent:0,replenishment_count:0,replenishment_sheets:0,replenishment_m2:0};
 const byType=new Map(),byWarehouse=new Map();
 for(const g of groups){for(const k of ['useful_sheets','sealed_useful_sheets','loose_useful_sheets','useful_m2','sealed_useful_m2','loose_useful_m2','damaged_sheets','damaged_m2','physical_sheets','physical_m2'])kpis[k]+=g[k];const tk=normalized(g.type),wk=normalized(g.warehouse);if(!byType.has(tk))byType.set(tk,{label:g.type,value:0,useful_sheets:0});byType.get(tk).value+=g.useful_m2;byType.get(tk).useful_sheets+=g.useful_sheets;if(!byWarehouse.has(wk))byWarehouse.set(wk,{label:g.warehouse,sealed_m2:0,loose_m2:0,sealed_sheets:0,loose_sheets:0});byWarehouse.get(wk).sealed_m2+=g.sealed_useful_m2;byWarehouse.get(wk).loose_m2+=g.loose_useful_m2;byWarehouse.get(wk).sealed_sheets+=g.sealed_useful_sheets;byWarehouse.get(wk).loose_sheets+=g.loose_useful_sheets;}
 kpis.damaged_percent=kpis.physical_sheets?round(100*kpis.damaged_sheets/kpis.physical_sheets):0;
 // Keep one rule per exact SKU. Valid storage guarantees uniqueness; latest wins
 // defensively if the caller supplies duplicated rows or mixed-case versions.
 const ruleMap=new Map();for(const row of rows.filter(r=>r.kind==='reorder_rule').sort((a,b)=>String(a.updated_at??a.created_at??'').localeCompare(String(b.updated_at??b.created_at??''))||String(a.id??'').localeCompare(String(b.id??'')))){const rule=validateRule(row);ruleMap.set(sku(rule),{id:row.id,...rule});}
 const replenishment=[],replenishmentByType=new Map();
 for(const rule of ruleMap.values()){
  if(!matches(rule,filters,{warehouse:false}))continue;
  const useful_sheets=global.filter(g=>g.sku===sku(rule)).reduce((n,g)=>n+g.useful_sheets,0),triggered=rule.enabled&&useful_sheets<=rule.minimum_sheets&&rule.target_sheets>useful_sheets,needed_sheets=triggered?Math.max(rule.target_sheets-useful_sheets,0):0;
  const needed_m2=round(needed_sheets*sheetArea(rule));replenishment.push({...rule,spec:dims(rule),useful_sheets,needed_sheets,needed_m2,triggered,provisional,scope:'all_warehouses'});
  if(triggered){const typeKey=normalized(rule.type);if(!replenishmentByType.has(typeKey))replenishmentByType.set(typeKey,{label:rule.type,value:0,needed_sheets:0,needed_m2:0});const purchase=replenishmentByType.get(typeKey);purchase.value+=needed_sheets;purchase.needed_sheets+=needed_sheets;purchase.needed_m2+=needed_m2;kpis.replenishment_count++;kpis.replenishment_sheets+=needed_sheets;kpis.replenishment_m2+=needed_m2;}
 }
 for(const k of ['useful_m2','sealed_useful_m2','loose_useful_m2','damaged_m2','physical_m2','replenishment_m2'])kpis[k]=round(kpis[k]);
 const evolution=closed.filter(inv=>(!filters.from||inv.work_date>=filters.from)&&(!filters.to||inv.work_date<=filters.to)).sort((a,b)=>String(a.work_date).localeCompare(String(b.work_date))||String(a.created_at??'').localeCompare(String(b.created_at??''))).map(inv=>historicalPoint(inv,filters));
 return{kpis,meta:{provisional,incomplete:provisional,has_active,last_closed_date:last?.work_date??null,last_closed_id:last?.id??null,history_incomplete:evolution.some(p=>!p.available||!p.available_sheets),history_m2_incomplete:evolution.some(p=>!p.available),history_quantity_incomplete:evolution.some(p=>!p.available_sheets),replenishment_scope:'all_warehouses',stock_reference:'sealed_now_and_last_closed_loose'},groups,replenishment,charts:{replenishment_by_type:[...replenishmentByType.values()].map(x=>({...x,needed_m2:round(x.needed_m2)})).sort((a,b)=>b.value-a.value||String(a.label).localeCompare(String(b.label),'pt-BR')),by_type:[...byType.values()].map(x=>({...x,value:round(x.value)})).sort((a,b)=>b.value-a.value),by_warehouse:[...byWarehouse.values()].map(x=>({...x,sealed_m2:round(x.sealed_m2),loose_m2:round(x.loose_m2)})).sort((a,b)=>String(a.label).localeCompare(String(b.label),'pt-BR')),condition:[{label:'Chapas úteis',value:kpis.useful_sheets},{label:'Chapas avariadas',value:kpis.damaged_sheets}],evolution}};
}
