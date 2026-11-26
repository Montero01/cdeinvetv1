/* Local SVG charts: no external rendering service or data transfer. */
const NS='http://www.w3.org/2000/svg';
const colors=['var(--chart-blue,#315f86)','var(--chart-teal,#527f80)','var(--chart-slate,#8b9eae)','var(--chart-warning,#9b7544)'];
const fmt=(value,d=2)=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:d});
const valid=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
const node=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=String(text);return n;};
const html=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function chart(label,height){const s=node('svg',{class:'inv-chart',viewBox:`0 0 640 ${height}`,role:'img','aria-label':label});s.append(node('title',{},label));return s;}
const text=(svg,x,y,value,attrs={})=>svg.append(node('text',{x,y,fill:'var(--chart-label,#617187)','font-size':14,...attrs},value));
function empty(message='Sem dados para este recorte.'){return html('p','chart-empty',message);}
function legend(entries){const wrap=html('div','chart-legend');for(const entry of entries){const item=html('span','chart-legend-item');const swatch=html('i','legend-swatch');swatch.style.backgroundColor=entry.color;item.append(swatch,html('span','',entry.label));wrap.append(item);}return wrap;}
function tooltip(parent,label){parent.append(node('title',{},label));}
export function renderBars(data=[]){
 const rows=data.filter(r=>valid(r.value)&&Number(r.value)>=0);if(!rows.length||!rows.some(r=>Number(r.value)>0))return empty('Nenhum m² útil registrado neste recorte.');
 const wrap=html('div','chart-visual chart-scroll'),height=Math.max(190,50+rows.length*43),svg=chart('m² úteis por tipo de vidro',height),left=180,right=100,plot=640-left-right,max=Math.max(...rows.map(r=>Number(r.value)));
 rows.forEach((r,i)=>{const y=24+i*43,label=String(r.label||'Sem tipo');text(svg,left-12,y+20,label.length>23?label.slice(0,22)+'…':label,{'text-anchor':'end'});const bar=node('rect',{x:left,y:y+3,width:Math.max(0,Number(r.value)/max*plot),height:25,rx:4,fill:colors[0]});tooltip(bar,`${label}: ${fmt(r.value)} m² úteis`);svg.append(bar);text(svg,left+Number(r.value)/max*plot+8,y+20,fmt(r.value));});text(svg,640-12,height-7,'m² úteis',{'text-anchor':'end','font-size':12});wrap.append(svg);return wrap;
}
export function renderStacked(data=[]){
 const rows=data.filter(r=>valid(r.sealed_m2)&&valid(r.loose_m2));if(!rows.length||!rows.some(r=>Number(r.sealed_m2)+Number(r.loose_m2)>0))return empty('Sem estoque útil para distribuir entre galpões.');
 const wrap=html('div','chart-visual chart-scroll'),height=Math.max(200,55+rows.length*46),svg=chart('m² úteis em caixas e avulsos por galpão',height),left=145,plot=380,max=Math.max(...rows.map(r=>Number(r.sealed_m2)+Number(r.loose_m2)));
 rows.forEach((r,i)=>{const y=24+i*46,name=String(r.label||'Sem galpão'),a=Number(r.sealed_m2),b=Number(r.loose_m2);text(svg,left-10,y+21,name.length>18?name.slice(0,17)+'…':name,{'text-anchor':'end'});let x=left;[a,b].forEach((v,j)=>{const rect=node('rect',{x,y:y+4,width:v/max*plot,height:26,fill:colors[j]});tooltip(rect,`${name} · ${j?'Avulsos':'Caixas'}: ${fmt(v)} m² úteis`);svg.append(rect);x+=v/max*plot;});text(svg,x+8,y+21,fmt(a+b));});text(svg,628,height-7,'m² úteis',{'text-anchor':'end','font-size':12});wrap.append(svg,legend([{color:colors[0],label:'Em caixa'},{color:colors[1],label:'Avulsos'}]));return wrap;
}
export function renderDonut(data=[]){
 const rows=data.filter(r=>valid(r.value)&&Number(r.value)>=0),total=rows.reduce((n,r)=>n+Number(r.value),0);if(!total)return empty('Sem chapas contadas para calcular a distribuição.');
 const wrap=html('div','chart-visual'),svg=chart('Distribuição de chapas úteis e avariadas',310);let angle=-Math.PI/2;const cx=320,cy=145,r=111,inner=74;
 rows.forEach((row,i)=>{const value=Number(row.value);if(!value)return;const proportion=value/total,color=i===0?colors[0]:'var(--chart-warning,#9b7544)';let shape;if(proportion>=0.999999){shape=node('circle',{cx,cy,r:(r+inner)/2,fill:'none',stroke:color,'stroke-width':r-inner});}else{const end=angle+proportion*Math.PI*2,large=proportion>.5?1:0;const point=(rad,a)=>[cx+rad*Math.cos(a),cy+rad*Math.sin(a)];const a=point(r,angle),b=point(r,end),c=point(inner,end),d=point(inner,angle);shape=node('path',{d:`M${a} A${r},${r} 0 ${large} 1 ${b} L${c} A${inner},${inner} 0 ${large} 0 ${d} Z`,fill:color});angle=end;}tooltip(shape,`${row.label}: ${fmt(value,0)} chapas · ${fmt(proportion*100)}%`);svg.append(shape);});text(svg,cx,cy,fmt(total,0),{'text-anchor':'middle','font-size':27,'font-weight':650,fill:'currentColor'});text(svg,cx,cy+25,'chapas físicas',{'text-anchor':'middle'});wrap.append(svg,legend(rows.map((r,i)=>({color:i===0?colors[0]:'var(--chart-warning,#9b7544)',label:`${r.label}: ${fmt(r.value,0)} (${fmt(Number(r.value)/total*100)}%)`}))));return wrap;
}
export function renderLine(data=[]){
 const rows=data.filter(r=>r.date).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));const usable=rows.filter(r=>valid(r.useful_m2));if(!usable.length)return empty('Ainda não há inventários concluídos com m² úteis neste período.');
 const wrap=html('div','chart-visual chart-scroll'),svg=chart('Tendência dos m² úteis em inventários concluídos',310),left=72,right=32,top=25,bottom=59,width=640-left-right,height=310-top-bottom,max=Math.max(1,...usable.map(r=>Number(r.useful_m2)))*1.08;
 const time=r=>new Date(String(r.date).slice(0,10)+'T12:00:00Z').getTime(),minDate=Math.min(...rows.map(time)),maxDate=Math.max(...rows.map(time));const x=r=>left+(maxDate===minDate?width/2:(time(r)-minDate)/(maxDate-minDate)*width),y=r=>top+height-Number(r.useful_m2)/max*height;
 for(let i=0;i<=4;i++){const yy=top+height-i*height/4;svg.append(node('line',{x1:left,y1:yy,x2:640-right,y2:yy,stroke:'var(--chart-grid,#dce4ee)','stroke-width':1}));text(svg,left-10,yy+4,fmt(max*i/4,1),{'text-anchor':'end','font-size':12});}
 let segment=[];function flush(){if(segment.length>1)svg.append(node('polyline',{points:segment.join(' '),fill:'none',stroke:colors[0],'stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'}));segment=[];}
 rows.forEach(r=>{if(!valid(r.useful_m2)){flush();return;}segment.push(`${x(r)},${y(r)}`);});flush();
 usable.forEach((r,i)=>{const dot=node('circle',{cx:x(r),cy:y(r),r:5,fill:colors[0],stroke:'var(--surface,#fff)','stroke-width':2});tooltip(dot,`${String(r.date).slice(0,10)}: ${fmt(r.useful_m2)} m² úteis`);svg.append(dot);if(usable.length<=8||i===0||i===usable.length-1){const parts=String(r.date).slice(0,10).split('-');text(svg,x(r),top+height+26,`${parts[2]}/${parts[1]}`,{'text-anchor':'middle','font-size':12});}});
 text(svg,left,13,'m² úteis',{'font-size':12});wrap.append(svg);if(rows.some(r=>!valid(r.useful_m2)))wrap.append(html('p','muted','Há conferências sem base detalhada neste período. Esses pontos ficam sem valor no gráfico.'));wrap.append(html('p','muted','Cada ponto é uma conferência concluída. A variação do saldo não representa consumo ou perdas.'));return wrap;
}
export function renderInventoryChart(kind,data){return ({type:renderBars,warehouse:renderStacked,condition:renderDonut,evolution:renderLine}[kind]||(()=>empty()))(data);}
