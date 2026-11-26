import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import * as Utils from '../utils.js';
const linkedomPath=process.env.CDE_QA_LINKEDOM||'/workspace/work/academy-icons-qa/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import('linkedom').catch(()=>import(linkedomPath));
const base=new URL('../',import.meta.url),html=fs.readFileSync(new URL('index.html',base),'utf8');
const appSource=fs.readFileSync(new URL('app.js',base),'utf8').replace("import * as U from './utils.js';","const U=__utils;");
const flush=async()=>{for(let n=0;n<15;n++)await new Promise(r=>setTimeout(r,0));};
const sample={invoice:'NF 123',type:'Comum',color:'Incolor',thickness_mm:6,width_mm:2000,height_mm:3000,sheets:20,damaged:1,warehouse:'Galpão 1',status:'sealed'};
const IDs=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const catalogs=['Galpão 1','Galpão 2'].map((w,i)=>({id:'warehouse'+i,kind:'catalog',data:{category:'warehouse',value:w},created_at:'2026-11-26T10:00:00Z'}));
const boxes=IDs.map((id,i)=>({id,kind:'box',work_date:'2026-11-26',data:{...sample,code:'CDE-'+(i+1),warehouse:i===1?'Galpão 2':'Galpão 1'},created_by:'vitor',created_by_name:'Vitor Amaral',created_at:'2026-11-26T10:00:00Z'}));
async function setup({allowed=true,loggedIn=true,hash='',records=[...catalogs,...boxes]}={}){
 const {window}=parseHTML(html),document=window.document;let all=structuredClone(records),calls=[],signed=loggedIn,failNext=false,cameraControls,stops=0,labels=[];
 const loc={href:'https://example.test/cdeinvetv1/'+hash,_hash:hash},listeners={};Object.defineProperty(loc,'hash',{get(){return this._hash;},set(v){this._hash=v?('#'+String(v).replace(/^#/,'')):'';}});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._v??this.querySelector('option')?.value??'';},set(v){this._v=String(v);}});
 window.Element.prototype.getClientRects=()=>[{width:44,height:44}];
 window.Element.prototype.focus=function(){document._activeElement=this;};
 Object.defineProperty(document,'activeElement',{configurable:true,get(){return document._activeElement||document.body;}});
 const ctxProfile={id:'vitor',full_name:'Vitor <img src=x onerror=alert(1)> Amaral',sector:'PRODUÇÃO',position:null,role:'employee'};
 const db={auth:{getUser:async()=>({data:{user:signed?{id:'vitor'}:null}}),signInWithPassword:async arg=>{calls.push({auth:'login',arg});signed=true;return{};},signOut:async()=>{signed=false;return{};},onAuthStateChange(fn){listeners.auth=fn;return{data:{subscription:{unsubscribe(){}}}};}},rpc:async(name,args)=>{calls.push({name,args});if(name==='invd_context')return{data:{allowed,can_manage:true,profile:ctxProfile}};if(name==='invd_list')return{data:all.slice(args.p_offset,args.p_offset+args.p_limit)};if(name==='invd_command'){
   if(failNext){failNext=false;return{error:{message:'Falha de rede simulada'}};}
   const {p_action:a,p_payload:p}=args,id=webcrypto.randomUUID(),parent=p.inventory_id;
   if(a==='box_create'){const ids=p.items.map(item=>{const id=webcrypto.randomUUID();all.push({id,kind:'box',data:{...item,status:'sealed',code:'CDE-'+id},created_at:'2026-11-26T11:00:00Z'});return id;});return{data:{id:ids[0],ids}};}
   if(a==='catalog_add')all.push({id,kind:'catalog',data:p,created_at:'2026-11-26T11:00:00Z'});
   if(a==='inventory_start'){all.push({id,kind:'inventory',work_date:p.date,data:{status:'active',expected:all.filter(r=>r.kind==='box'&&r.data.status==='sealed').map(r=>r.id),warehouses:['Galpão 1','Galpão 2']},created_at:'2026-11-26T11:00:00Z'});return{data:{id}};}
   if(a==='inventory_scan'){const b=all.find(r=>r.kind==='box'&&(r.id===p.code||r.data.code===p.code));if(!b)return{error:{message:'Caixa fora deste inventário'}};if(!all.some(r=>r.kind==='scan'&&r.parent_id===parent&&r.data.box_id===b.id))all.push({id,kind:'scan',parent_id:parent,data:{box_id:b.id},created_at:'2026-11-26T11:00:00Z'});return{data:{id,box_id:b.id}};}
   if(a==='inventory_loose')all.push({id,kind:'loose',parent_id:parent,data:p,created_at:'2026-11-26T11:00:00Z'});
   if(a==='inventory_decide'){all=all.filter(r=>!(r.kind==='decision'&&r.parent_id===parent&&r.data.box_id===p.box_id));all.push({id,kind:'decision',parent_id:parent,data:p,created_at:'2026-11-26T11:00:00Z'});}
   if(a==='inventory_finish'){const inv=all.find(r=>r.id===parent);if(p.confirmed_warehouses.length!==2)return{error:{message:'Confirme todos os galpões'}};inv.data.status='closed';all.filter(r=>r.kind==='decision'&&r.parent_id===parent&&r.data.outcome==='opened').forEach(d=>all.find(b=>b.id===d.data.box_id).data.status='opened');}
   if(a==='inventory_loose_remove')all=all.filter(r=>r.id!==p.id);
   return{data:{id:parent||id}};
  }return{data:null};}};
 window.INV_CONFIG={url:'https://example.test',key:'public-test-key',pdiUrl:'https://example.test/pdi'};window.supabase={createClient:()=>db};
 let workbook={SheetNames:['Entradas'],Sheets:{Entradas:{}}},importRows=[];const xlsx={read:()=>workbook,utils:{sheet_to_json:()=>importRows}};
 const storage=new Map(),storageApi={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const QR=function(host,opts){labels.push({kind:'QR',opts});host.append(document.createElement('canvas'));};QR.CorrectLevel={M:1};
 const barcode=(host,text)=>{labels.push({kind:'Code128',text});host.setAttribute('data-value',text);};
 const ZXingBrowser={BrowserMultiFormatReader:class{decodeFromVideoDevice(device,video,callback){cameraControls={stop(){stops++;}};this.callback=callback;listeners.camera=callback;return Promise.resolve(cameraControls);}}};
 const locationApi=loc;const context=vm.createContext({window,document,Node:window.Node,HTMLElement:window.HTMLElement,Event:window.Event,URL,Blob,Intl,Date,crypto:webcrypto,location:locationApi,localStorage:storageApi,supabase:window.supabase,QRCode:QR,JsBarcode:barcode,ZXingBrowser,navigator:{vibrate(){}},XLSX:xlsx,print(){},console,__utils:Utils,setTimeout:fn=>setTimeout(fn,0),clearTimeout});window.QRCode=QR;window.JsBarcode=barcode;window.ZXingBrowser=ZXingBrowser;
 vm.runInContext(appSource,context);await flush();
 const main=document.getElementById('main-content'),modal=()=>document.querySelector('.app-modal');
 async function click(text,host=main){const b=[...host.querySelectorAll('button')].find(n=>n.textContent===text);assert(b,'Missing button '+text);b.click();await flush();return b;}
 async function route(value){loc.hash='#'+value;window.dispatchEvent(new window.Event('hashchange'));await flush();}
 function set(name,value){const control=modal()?.querySelector(`[name="${name}"]`)||document.querySelector(`[name="${name}"]`);assert(control,'Missing field '+name);control.value=String(value);return control;}
 async function submit(form=modal()?.querySelector('form')){assert(form,'Missing form');form.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();}
 return{window,document,main,modal,calls,click,route,set,submit,fail:()=>failNext=true,records:()=>all,labels,stops:()=>stops,emitCamera:async(code)=>{listeners.camera({getText:()=>code},null,cameraControls);await flush();},loc,setWorkbook:(book,data)=>{workbook=book;importRows=data;}};
}
const unauth=await setup({loggedIn:false});assert.equal(unauth.document.getElementById('app-screen').hidden,true);assert.equal(unauth.calls.filter(x=>x.name==='invd_list').length,0);
const denied=await setup({allowed:false});assert.equal(denied.document.getElementById('app-screen').hidden,true);assert.match(denied.document.getElementById('login-error').textContent,/autorização/);assert.equal(denied.calls.filter(x=>x.name==='invd_list').length,0);
const app=await setup();assert.equal(app.document.getElementById('app-screen').hidden,false);assert.equal(app.document.getElementById('viewer-name').querySelector('img'),null,'profile name rendered safely');assert.equal(app.document.querySelectorAll('.nav-button').length,6);
await app.click('☰ Menu',app.document);assert.equal(app.document.getElementById('menu-toggle').getAttribute('aria-expanded'),'true');await app.click('× Fechar',app.document);assert.equal(app.document.body.classList.contains('menu-open'),false);
app.document.getElementById('theme-button').click();assert.equal(app.document.documentElement.dataset.theme,'dark');app.document.getElementById('theme-button').click();assert.equal(app.document.documentElement.dataset.theme,'light');
await app.route('item='+IDs[0]);assert(app.main.textContent.includes('NF 123'));assert.equal(app.labels.find(x=>x.kind==='QR').opts.text,'https://example.test/cdeinvetv1/#item='+IDs[0]);assert.equal(app.labels.find(x=>x.kind==='Code128').text,'CDE-1');
await app.route('entries');await app.click('Nova entrada');for(const[key,val]of Object.entries({...sample,notes:'Conferido por Vitor'}))if(key!=='status')app.set(key,val);app.fail();await app.submit();assert(app.modal());const first=app.calls.filter(x=>x.args?.p_action==='box_create').at(-1);assert.match(app.modal().textContent,/Falha de rede/);await app.submit();const second=app.calls.filter(x=>x.args?.p_action==='box_create').at(-1);assert.equal(first.args.p_request_id,second.args.p_request_id,'same UUID on network retry');assert.equal(app.modal(),null);assert.equal(second.args.p_payload.items.length,1);assert.equal(second.args.p_payload.items[0].notes,'Conferido por Vitor','entry notes preserved');
await app.route('daily');await app.click('Iniciar inventário diário');await app.submit();assert.equal(app.modal(),null);assert.equal(app.records().filter(r=>r.kind==='inventory').length,1);assert(app.main.textContent.includes('Caixas esperadas'));
// Physical route order intentionally crosses glass/warehouse groups; no forced grouping.
for(const code of ['CDE-2','CDE-1','CDE-2']){app.document.getElementById('scan-code').value=code;await app.submit(app.main.querySelector('.scan-form'));}
assert.equal(app.records().filter(r=>r.kind==='scan').length,2,'duplicate barcode does not duplicate physical count');
await app.click('Registrar avulsas');for(const[key,val]of Object.entries({...sample,quantity:7,notes:'Avulsas na parede A'}))if(!['status','invoice','sheets'].includes(key))app.set(key,val);await app.submit();assert.equal(app.records().filter(r=>r.kind==='loose').length,1);assert.equal(app.records().find(r=>r.kind==='loose').data.quantity,7);
const closeButton=[...app.main.querySelectorAll('button')].find(n=>n.textContent==='Concluir inventário');assert.equal(closeButton.disabled,true,'not inferred open merely because unscanned');
await app.click('Validar');app.set('outcome','opened');await app.submit();assert(app.records().some(r=>r.kind==='decision'&&r.data.outcome==='opened'));
await app.click('Abrir câmera');assert(app.modal());app.fail();await app.emitCamera('CDE-1');assert(app.modal().textContent.includes('Falha de rede'));const cameraFailure=app.calls.filter(x=>x.args?.p_action==='inventory_scan').at(-1);await app.click('Tentar leitura novamente',app.modal());await app.emitCamera('CDE-1');const cameraRetry=app.calls.filter(x=>x.args?.p_action==='inventory_scan').at(-1);assert.equal(cameraFailure.args.p_request_id,cameraRetry.args.p_request_id);await app.click('Fechar',app.modal());assert.equal(app.stops(),1,'camera controls stopped on close');
while([...app.main.querySelectorAll('button')].some(n=>n.textContent==='Validar')){await app.click('Validar');app.set('outcome','opened');await app.submit();}
const finishForm=[...app.main.querySelectorAll('form')].find(f=>f.textContent.includes('Concluir inventário'));await app.submit(finishForm);assert(app.main.textContent.includes('Confirme todos os galpões'));finishForm.querySelectorAll('input[type=checkbox]').forEach(n=>n.checked=true);await app.submit(finishForm);assert.equal(app.records().find(r=>r.kind==='inventory').data.status,'closed');
await app.route('entries');const fileInput=app.document.getElementById('import-file');let file={name:'entrada.xlsx',size:100,arrayBuffer:async()=>new ArrayBuffer(1)};Object.defineProperty(fileInput,'files',{configurable:true,get:()=>[file]});const excel=Object.fromEntries(Utils.templateHeaders.map((h,i)=>[h,['NF XYZ','Comum','Incolor',6,2000,3000,20,0,'Galpão 1',''][i]]));
app.setWorkbook({SheetNames:['Entradas'],Sheets:{Entradas:{A2:{f:'1+1',v:2}}}},[excel]);fileInput.dispatchEvent(new app.window.Event('change'));await flush();assert(app.main.querySelector('.import-preview').textContent.includes('fórmulas'));assert.equal([...app.main.querySelector('.import-preview').querySelectorAll('button')].length,0);
app.setWorkbook({SheetNames:['Entradas'],Sheets:{Entradas:{}}},[excel,{...excel,Chapas:0}]);fileInput.dispatchEvent(new app.window.Event('change'));await flush();assert(app.main.querySelector('.import-preview').textContent.includes('Nenhuma entrada foi salva'));assert.equal(app.main.querySelector('.import-preview').querySelector('button'),null);
app.setWorkbook({SheetNames:['Entradas'],Sheets:{Entradas:{}}},[excel]);fileInput.dispatchEvent(new app.window.Event('change'));await flush();assert(app.main.querySelector('.import-preview').textContent.includes('1 caixa(s) para conferir'));await app.click('Confirmar 1 entrada(s)',app.main.querySelector('.import-preview'));assert(app.records().some(r=>r.kind==='box'&&r.data.invoice==='NF XYZ'));
await app.route('items');const search=app.main.querySelector('input[type=search]');search.value='NAO EXISTE';search.dispatchEvent(new app.window.Event('input'));assert(app.main.textContent.includes('Nenhuma caixa encontrada.'));
console.log('PASS: DOM mock login/denial/XSS, theme/menu, item QR+Code128, entry retry UUID, daily start/random warehouse scans/duplicates, loose/manual decision, camera retry/stop, whole import rejects formula/invalid row, finish warehouse confirmations and filters. Not real browser pixels, real login, camera hardware or SQL validation.');
