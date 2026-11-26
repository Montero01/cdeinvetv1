/** Safe photo display sources. No proxy, public-sharing change, upload or auth-token transfer. */
export function photoSource(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.length>2000)throw new Error('Informe um link válido para a foto do item.');
 let url;try{url=new URL(raw.trim());}catch{throw new Error('O link da foto não é válido.');}
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('A foto deve usar um link HTTPS sem credenciais.');
 if(url.origin==='https://drive.google.com'){
  if(/\/folders(?:\/|$)/.test(url.pathname))throw new Error('O link é de uma pasta. Informe o link do arquivo da foto.');
  const match=url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{1,200})(?:\/|$)/);
  const id=match?.[1]||url.searchParams.get('id');
  if(!id||!/^[A-Za-z0-9_-]{1,200}$/.test(id))throw new Error('Não foi possível identificar o arquivo do Google Drive neste link.');
  // resourcekey may be required to open a link-shared Drive file. Preserve only it.
  const preview=new URL('https://drive.google.com/file/d/'+encodeURIComponent(id)+'/preview');
  const resourceKey=url.searchParams.get('resourcekey');if(resourceKey&&/^[A-Za-z0-9_-]{1,200}$/.test(resourceKey))preview.searchParams.set('resourcekey',resourceKey);
  return{kind:'drive',src:preview.href,original:url.href};
 }
 return{kind:'image',src:url.href,original:url.href};
}
/** The entry timestamp is the receiving record, displayed in the operation's Manaus timezone. */
export function formatEntryDate(value){
 if(value===undefined||value===null||value==='')return'—';
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
  const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)return'—';
  return value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4);
 }
 const date=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(date.getTime()))return'—';
 return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Manaus',day:'2-digit',month:'2-digit',year:'numeric'}).format(date);
}
