/** Inventory calculations. No financial values or invoice origin are inferred. */
export const templateHeaders=Object.freeze(['Nota Fiscal','Tipo','Cor','Espessura mm','Largura mm','Altura mm','Chapas','Avarias','Galpão','Link Foto']);
const fields=['invoice','type','color','thickness_mm','width_mm','height_mm','sheets','damaged','warehouse','photo_url'];
const unwrap=value=>value?.data && typeof value.data==='object'?{...value.data,id:value.id??value.data.id}:value||{};
const round=value=>Math.round((value+Number.EPSILON)*1e6)/1e6;
function fail(message){throw new Error(message);}
function numeric(value,label,{integer=false,min=0,max=100000}={}){
 if(value&&typeof value==='object'){if('f'in value)fail(`${label}: fórmulas não são aceitas.`);value=value.v;}
 if(typeof value==='string'){
  value=value.trim();
  // A single decimal separator is accepted. Grouped thousands are intentionally rejected.
  if(!/^\d+(?:[.,]\d{1,3})?$/.test(value))fail(`${label}: informe um número sem separador de milhar.`);
  value=Number(value.replace(',','.'));
 }
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isSafeInteger(value))||Math.abs(value*1000-Math.round(value*1000))>1e-7)fail(`${label}: informe ${integer?'um inteiro':'um número'} entre ${min} e ${max}.`);
 return value;
}
function text(value,label,max=120){
 if(value&&typeof value==='object'){if('f'in value)fail(`${label}: fórmulas não são aceitas.`);value=value.v;}
 if(value===undefined||value===null)fail(`${label}: preenchimento obrigatório.`);
 value=String(value).trim().normalize('NFC');
 if(!value||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))fail(`${label}: use de 1 a ${max} caracteres válidos.`);
 if(/^[=+@]/.test(value))fail(`${label}: fórmulas não são aceitas.`);
 return value;
}
/** Normalize one physical box. `sheets` includes damaged sheets; damaged is a subset. */
export function validateBox(raw){
 raw=unwrap(raw);
 const out={invoice:text(raw.invoice,'Nota Fiscal',80),type:text(raw.type,'Tipo'),color:text(raw.color,'Cor'),thickness_mm:numeric(raw.thickness_mm,'Espessura mm',{min:0.001,max:100}),width_mm:numeric(raw.width_mm,'Largura mm',{min:0.001,max:20000}),height_mm:numeric(raw.height_mm,'Altura mm',{min:0.001,max:20000}),sheets:numeric(raw.sheets,'Chapas',{integer:true,min:1}),damaged:numeric(raw.damaged==null||raw.damaged===''?0:raw.damaged,'Avarias',{integer:true}),warehouse:text(raw.warehouse,'Galpão'),photo_url:'',notes:String(raw.notes??'').normalize('NFC').slice(0,2000)};
 if(out.damaged>out.sheets)fail('Avarias: não podem superar a quantidade de chapas da caixa.');
 if(raw.photo_url){
  let value=raw.photo_url;
  if(typeof value==='object'){if('f'in value)fail('Link Foto: fórmulas não são aceitas.');value=value.v;}
  value=String(value).trim();
  if(value){let url;try{url=new URL(value);}catch(_){fail('Link Foto: informe um endereço HTTPS válido.');}
   if(url.protocol!=='https:'||url.username||url.password||url.href.length>2000)fail('Link Foto: use um endereço HTTPS sem credenciais.');
   out.photo_url=url.href;
  }
 }
 return out;
}
/** XLSX sheet_to_json objects or data-row arrays (without header); no records are inserted if errors exist. */
export function parseImport(rows){
 const errors=[],items=[];
 if(!Array.isArray(rows)||!rows.length)return{items,errors:[{row:1,message:'A planilha está vazia.'}]};
 if(rows.length>500)return{items,errors:[{row:1,message:'Importe até 500 caixas por arquivo.'}]};
 rows.forEach((row,index)=>{
  try{
   if(!row||typeof row!=='object')fail('Linha inválida.');
   if(!Array.isArray(row)&&Object.values(row).some(v=>v&&typeof v==='object'&&'f'in v))fail('Fórmulas não são aceitas. Substitua as fórmulas pelos valores.');
   const raw={};fields.forEach((key,i)=>{raw[key]=Array.isArray(row)?row[i]:(row[templateHeaders[i]]??row[key]);});
   raw.notes=Array.isArray(row)?'':(row['Observações']??row.notes??'');
   items.push(validateBox(raw));
  }catch(error){errors.push({row:index+2,message:error.message});}
 });
 return{items,errors};
}
/** Exact glass specification; warehouse and invoice do not identify a glass SKU. */
export function sku(raw){const s=unwrap(raw);return JSON.stringify([String(s.type??'').trim().normalize('NFC').toLocaleLowerCase('pt-BR'),String(s.color??'').trim().normalize('NFC').toLocaleLowerCase('pt-BR'),Number(s.thickness_mm),Number(s.width_mm),Number(s.height_mm)]);}
export function area(raw,quantity=1){const s=unwrap(raw);const width=numeric(s.width_mm,'Largura mm',{min:0.001,max:20000}),height=numeric(s.height_mm,'Altura mm',{min:0.001,max:20000});return round(width*height/1e6*numeric(quantity,'Quantidade',{min:0,max:1000000000}));}
/** Caller supplies which sealed boxes belong to the selected date/snapshot. */
export function summarize(boxes=[],loose=[]){
 const out={boxes:boxes.length,sheets_box:0,sheets_loose:0,sheets_total:0,sheets_good:0,sheets_damaged:0,m2_box:0,m2_loose:0,m2_total:0,m2_good:0,m2_damaged:0};
 for(const[group,isLoose]of [[boxes,false],[loose,true]])for(const row of group){
  const s=unwrap(row),quantity=numeric(isLoose?s.quantity:s.sheets,'Quantidade',{integer:true,min:0}),damaged=numeric(s.damaged??0,'Avarias',{integer:true,min:0});
  if(damaged>quantity)fail('Avarias não podem superar a quantidade física.');
  const m2=area(s,quantity),badM2=area(s,damaged);
  out.sheets_total+=quantity;out.sheets_damaged+=damaged;out.m2_total+=m2;out.m2_damaged+=badM2;
  out[isLoose?'sheets_loose':'sheets_box']+=quantity;out[isLoose?'m2_loose':'m2_box']+=m2;
 }
 out.sheets_good=out.sheets_total-out.sheets_damaged;out.m2_good=out.m2_total-out.m2_damaged;
 for(const key of ['m2_total','m2_good','m2_damaged','m2_box','m2_loose'])out[key]=round(out[key]);
 return out;
}
/**
 * Compare grouped loose sheets against confirmed opened box capacity.
 * No FIFO allocation, invoice link, consumption or loss is invented.
 * Pass snapshot boxes. Prior opened boxes are historical references only. Unscanned
 * boxes stay pending until a human decision; missing boxes are never opened.
 */
export function reconcile(boxes=[],scans=[],loose=[],decisions=[]){
 const groups=new Map(),scanned=new Set(scans.map(row=>typeof row==='string'?row:unwrap(row).box_id)),decisionMap=new Map(decisions.map(row=>{const s=unwrap(row);return[s.box_id,s];}));
 function group(raw){const s=unwrap(raw),key=sku(s);if(!groups.has(key))groups.set(key,{key,type:s.type,color:s.color,thickness_mm:Number(s.thickness_mm),width_mm:Number(s.width_mm),height_mm:Number(s.height_mm),box_count:0,expected_sheets:0,expected_m2:0,loose_sheets:0,loose_m2:0,loose_damaged:0,delta:0,ambiguous_origin:false,boxes:[],prior_opened_boxes:[],reference_history_sheets:0,pending_boxes:[],missing_boxes:[],sealed_confirmed:[],loose:[]});return groups.get(key);}
 for(const row of boxes){const s=unwrap(row),g=group(s),decision=decisionMap.get(s.id);if(scanned.has(s.id)){g.sealed_confirmed.push(s);continue;}
  if(decision?.outcome==='sealed'){g.sealed_confirmed.push(s);continue;}
  if(decision?.outcome==='missing'){g.missing_boxes.push(s);continue;}
  if(decision?.outcome==='opened'){g.boxes.push(s);g.box_count++;g.expected_sheets+=numeric(s.sheets,'Chapas',{integer:true,min:0});g.expected_m2+=area(s,s.sheets);}else if(s.status==='opened'){g.prior_opened_boxes.push(s);g.reference_history_sheets+=numeric(s.sheets,'Chapas',{integer:true,min:0});}else g.pending_boxes.push(s);
 }
 for(const row of loose){const s=unwrap(row),g=group(s);g.loose.push(s);g.loose_sheets+=numeric(s.quantity,'Quantidade avulsa',{integer:true,min:0});g.loose_damaged+=numeric(s.damaged??0,'Avarias avulsas',{integer:true,min:0});if((s.damaged??0)>s.quantity)fail('Avarias avulsas não podem superar a quantidade física.');g.loose_m2+=area(s,s.quantity);}
 for(const g of groups.values()){g.candidate_capacity=g.expected_sheets;g.delta=g.loose_sheets-g.expected_sheets;g.expected_m2=round(g.expected_m2);g.loose_m2=round(g.loose_m2);g.ambiguous_origin=g.loose_sheets>0&&(g.boxes.length!==1||g.prior_opened_boxes.length>0||g.pending_boxes.length>0||g.missing_boxes.length>0);g.origin_status=g.loose_sheets===0?'sem_avulsas':g.boxes.length===0?'sem_caixa_confirmada':g.ambiguous_origin?'varias_candidatas':'candidata_unica';}
 return [...groups.values()];
}
/** Excel-safe semicolon CSV, UTF-8 BOM, quoted cells and CRLF records. */
export function csv(rows){
 if(!Array.isArray(rows)||!rows.length)return'\uFEFF';
 let table=rows;
 if(!Array.isArray(rows[0])){const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];table=[headers,...rows.map(row=>headers.map(key=>row[key]??''))];}
 function cell(value){let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
 return'\uFEFF'+table.map(row=>row.map(cell).join(';')).join('\r\n');
}
