begin;
create or replace function invd_private.command(p_action text,p_request_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles;session public.inventarydaily_table;box public.inventarydaily_table;prev public.inventarydaily_table;row_id uuid;sid uuid;out jsonb;v jsonb;x jsonb;ids jsonb:='[]';d date;cat text;val text;n integer;
begin
if not invd_private.allowed() then raise exception 'Seu perfil não tem acesso ao inventário.' using errcode='42501';end if;
if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>1000000 then raise exception 'Requisição inválida ou muito grande.';end if;
select * into actor from public.profiles where id=auth.uid();
perform pg_advisory_xact_lock(763126,1);
select * into prev from public.inventarydaily_table where kind='log' and data->>'request_id'=p_request_id::text;
if prev.id is not null then
 if prev.created_by<>actor.id or prev.data->>'action'<>p_action or prev.data->'payload'<>p_payload then raise exception 'Identificador de requisição já utilizado.';end if;
 return prev.data->'result';end if;
if p_action='catalog_add' then
cat:=p_payload->>'category';val:=trim(p_payload->>'value');
if cat not in('type','color','thickness','warehouse') or cat is null or val is null or length(val) not between 1 and 120 then raise exception 'Categoria ou valor inválido.';end if;
if cat='thickness' then if val !~ '^[0-9]+([.][0-9]{1,3})?$' or val::numeric<=0 or val::numeric>100 then raise exception 'Espessura inválida.';end if;val:=trim(trailing '.' from trim(trailing '0' from to_char(val::numeric,'FM99990.000')));end if;
insert into public.inventarydaily_table(kind,data,created_by,created_by_name) values('catalog',jsonb_build_object('category',cat,'value',val),actor.id,actor.full_name) on conflict do nothing returning id into row_id;
if row_id is null then select id into row_id from public.inventarydaily_table where kind='catalog' and data->>'category'=cat and lower(data->>'value')=lower(val);end if;out:=jsonb_build_object('id',row_id);
elsif p_action='box_create' then
if exists(select 1 from public.inventarydaily_table where kind='inventory' and data->>'status'='active') then raise exception 'Conclua o inventário em andamento antes de registrar entradas.';end if;
if coalesce(jsonb_typeof(p_payload->'items'),'null')<>'array' or coalesce(jsonb_array_length(p_payload->'items'),0) not between 1 and 500 then raise exception 'Envie de 1 a 500 caixas por importação.';end if;
for x in select * from jsonb_array_elements(p_payload->'items') loop
v:=invd_private.spec(x);row_id:=gen_random_uuid();
-- Catálogos controlados, inclusive via importação.
foreach cat in array array['type','color','thickness','warehouse'] loop
 val:=case cat when 'thickness' then v->>'thickness_mm' else v->>cat end;
 if not exists(select 1 from public.inventarydaily_table where kind='catalog' and data->>'category'=cat and lower(data->>'value')=lower(val)) then raise exception 'Cadastre antes: % = %.',cat,val;end if;
end loop;
v:=v||jsonb_build_object('code','CDE-'||upper(replace(row_id::text,'-','')));
insert into public.inventarydaily_table(id,kind,data,created_by,created_by_name) values(row_id,'box',v,actor.id,actor.full_name);ids:=ids||to_jsonb(row_id);end loop;
out:=jsonb_build_object('ids',ids,'id',ids->>0);
elsif p_action='inventory_start' then
begin d:=(p_payload->>'date')::date;exception when others then raise exception 'Data inválida.';end;
if d is null or d>(now() at time zone 'America/Manaus')::date or d<coalesce((select max(work_date) from public.inventarydaily_table where kind='inventory'),'1900-01-01') then raise exception 'Use hoje ou uma data posterior ao último inventário, sem data futura.';end if;
if exists(select 1 from public.inventarydaily_table where kind='inventory' and (data->>'status'='active' or work_date=d)) then raise exception 'Já existe inventário neste dia ou em andamento.';end if;
select coalesce(jsonb_agg(id order by created_at,id),'[]') into ids from public.inventarydaily_table where kind='box' and data->>'status' in('sealed','missing');
select coalesce(jsonb_agg(w order by w),'[]') into v from(select distinct data->>'warehouse' w from public.inventarydaily_table where kind='box' and data->>'status' in('sealed','missing') union select data->>'value' from public.inventarydaily_table where kind='catalog' and data->>'category'='warehouse')q;
if jsonb_array_length(v)=0 then raise exception 'Cadastre ao menos um galpão antes de iniciar.';end if;
insert into public.inventarydaily_table(kind,work_date,data,created_by,created_by_name)values('inventory',d,jsonb_build_object('status','active','expected',ids,'warehouses',v),actor.id,actor.full_name) returning id into row_id;out:=jsonb_build_object('id',row_id);
elsif p_action in('inventory_scan','inventory_loose','inventory_loose_remove','inventory_decide','inventory_finish') then
if p_action='inventory_loose_remove' then select parent_id into sid from public.inventarydaily_table where id=(p_payload->>'id')::uuid and kind='loose';else sid:=(p_payload->>'inventory_id')::uuid;end if;
select * into session from public.inventarydaily_table where id=sid and kind='inventory' for update;
if session.id is null or session.data->>'status'<>'active' then raise exception 'Inventário não está em andamento.';end if;
if p_action='inventory_scan' then
select * into box from public.inventarydaily_table where kind='box' and (id::text=trim(p_payload->>'code') or data->>'code'=upper(trim(p_payload->>'code')));
if box.id is null or not(session.data->'expected' @> jsonb_build_array(box.id)) then raise exception 'Caixa não pertence às caixas lacradas previstas neste inventário.';end if;
if exists(select 1 from public.inventarydaily_table where parent_id=sid and kind='decision' and data->>'box_id'=box.id::text)then raise exception 'Esta caixa já recebeu uma decisão na conferência.';end if;
insert into public.inventarydaily_table(kind,parent_id,work_date,data,created_by,created_by_name)values('scan',sid,session.work_date,jsonb_build_object('box_id',box.id),actor.id,actor.full_name)on conflict do nothing returning id into row_id;
if row_id is null then select id into row_id from public.inventarydaily_table where parent_id=sid and kind='scan' and data->>'box_id'=box.id::text;end if;
out:=jsonb_build_object('id',row_id,'box_id',box.id);
elsif p_action='inventory_loose' then
v:=invd_private.spec(p_payload,true);
if not(session.data->'warehouses' @> jsonb_build_array(v->>'warehouse'))then raise exception 'Galpão não incluído neste inventário.';end if;
insert into public.inventarydaily_table(kind,parent_id,work_date,data,created_by,created_by_name)values('loose',sid,session.work_date,v,actor.id,actor.full_name)returning id into row_id;out:=jsonb_build_object('id',row_id);
elsif p_action='inventory_loose_remove' then
select * into prev from public.inventarydaily_table where id=(p_payload->>'id')::uuid;
delete from public.inventarydaily_table where id=prev.id;out:=jsonb_build_object('id',prev.id,'removed',true,'previous',prev.data);
elsif p_action='inventory_decide' then
select * into box from public.inventarydaily_table where id=(p_payload->>'box_id')::uuid and kind='box';
if box.id is null or not(session.data->'expected' @> jsonb_build_array(box.id)) then raise exception 'Caixa fora deste inventário.';end if;
if exists(select 1 from public.inventarydaily_table where kind='scan' and parent_id=sid and data->>'box_id'=box.id::text)then raise exception 'Caixa já escaneada como lacrada.';end if;
val:=p_payload->>'outcome';
if val is null or val not in('opened','sealed','missing') or (val in('sealed','missing') and length(trim(coalesce(p_payload->>'notes','')))<3)then raise exception 'Informe a decisão e a justificativa quando não houver leitura ou a caixa não for localizada.';end if;
v:=jsonb_build_object('box_id',box.id,'outcome',val,'notes',left(coalesce(p_payload->>'notes',''),2000));
insert into public.inventarydaily_table(kind,parent_id,work_date,data,created_by,created_by_name)values('decision',sid,session.work_date,v,actor.id,actor.full_name)
on conflict (parent_id,(data->>'box_id')) where kind='decision' do update set data=excluded.data,updated_at=now(),created_by=excluded.created_by,created_by_name=excluded.created_by_name returning id into row_id;out:=jsonb_build_object('id',row_id);
else
if exists(select 1 from jsonb_array_elements_text(session.data->'expected')b where not exists(select 1 from public.inventarydaily_table x where x.parent_id=sid and x.kind in('scan','decision') and x.data->>'box_id'=b.value))then raise exception 'Valide todas as caixas não escaneadas antes de encerrar.';end if;
if coalesce(jsonb_typeof(p_payload->'confirmed_warehouses'),'null')<>'array' or not((p_payload->'confirmed_warehouses') @> (session.data->'warehouses')) or not((session.data->'warehouses') @> (p_payload->'confirmed_warehouses'))then raise exception 'Confirme a contagem de todos os galpões, inclusive os avulsos.';end if;
v:=invd_private.summary(sid);
update public.inventarydaily_table b set data=b.data||jsonb_build_object('status',case when exists(select 1 from public.inventarydaily_table x where x.kind='decision' and x.parent_id=sid and x.data->>'box_id'=b.id::text and x.data->>'outcome'='missing')then 'missing' else 'sealed' end),updated_at=now() where b.kind='box' and session.data->'expected' @> jsonb_build_array(b.id);
update public.inventarydaily_table b set data=b.data||jsonb_build_object('status','opened','opened_on',session.work_date,'opened_inventory_id',sid),updated_at=now() where b.kind='box' and exists(select 1 from public.inventarydaily_table x where x.kind='decision' and x.parent_id=sid and x.data->>'box_id'=b.id::text and x.data->>'outcome'='opened');
update public.inventarydaily_table set data=data||jsonb_build_object('status','closed','summary',v,'closed_at',now(),'closed_by',actor.id,'closed_by_name',actor.full_name),updated_at=now()where id=sid;
out:=jsonb_build_object('id',sid,'summary',v);
end if;
else raise exception 'Operação desconhecida.';end if;
insert into public.inventarydaily_table(kind,parent_id,data,created_by,created_by_name)values('log',sid,jsonb_build_object('request_id',p_request_id,'action',p_action,'payload',p_payload,'result',out),actor.id,actor.full_name);
return out;
end$$;

commit;
