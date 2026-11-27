begin;
create or replace function invd_private.loose_balance(p jsonb)returns jsonb language sql stable set search_path=''as $$
with base as(select *from public.inventarydaily_table where kind='inventory'and data->>'status'='closed'and invd_private.scope_has(data->'warehouses',p->>'warehouse')order by work_date desc,created_at desc,id desc limit 1),
lines as(select coalesce(sum((x.data->>'quantity')::bigint),0)q,coalesce(sum((x.data->>'damaged')::bigint),0)d from public.inventarydaily_table x where x.kind='loose'and x.parent_id=(select id from base)and invd_private.catalog_key('warehouse',x.data->>'warehouse')=invd_private.catalog_key('warehouse',p->>'warehouse')and invd_private.sku_key(x.data)=invd_private.sku_key(p)),
flows as(select data,case when data->>'action'='unpack'then(case when invd_private.catalog_key('warehouse',data->>'from_warehouse')=invd_private.catalog_key('warehouse',p->>'warehouse')then 1 else 0 end)else(case when invd_private.catalog_key('warehouse',data->>'to_warehouse')=invd_private.catalog_key('warehouse',p->>'warehouse')then 1 else 0 end-case when invd_private.catalog_key('warehouse',data->>'from_warehouse')=invd_private.catalog_key('warehouse',p->>'warehouse')then 1 else 0 end)end as sign from public.inventarydaily_table where kind='stock_move'and(data->>'source'='loose'or data->>'action'='unpack')and created_at>coalesce((select(data->>'closed_at')::timestamptz from base),(select updated_at from base),'-infinity'::timestamptz)and invd_private.sku_key(data)=invd_private.sku_key(p)),
moves as(select coalesce(sum((data->>'quantity')::bigint*sign),0)q,coalesce(sum((data->>'damaged')::bigint*sign),0)d from flows)
select jsonb_build_object('quantity',lines.q+moves.q,'damaged',lines.d+moves.d,'baseline_id',(select id from base))from lines,moves
$$;

create or replace function invd_private.command(p_action text,p_request_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles;session public.inventarydaily_table;box public.inventarydaily_table;prev public.inventarydaily_table;row_id uuid;sid uuid;out jsonb;v jsonb;x jsonb;ids jsonb:='[]';d date;cat text;val text;n integer;qty numeric;existing_id uuid;canonical text;source_kind text;balance jsonb;available_q bigint;available_d bigint;move_q bigint;move_d bigint;from_loc text;to_loc text;new_box_id uuid;event_time timestamptz;
begin
if not invd_private.allowed() then raise exception 'Seu perfil não tem acesso ao inventário.' using errcode='42501';end if;
if p_action in('inventory_delete','box_delete','reorder_rule_save') and not invd_private.manager() then raise exception 'Somente gerência, diretoria e master podem excluir ou gerenciar parâmetros de reposição.' using errcode='42501';end if;
if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>1000000 then raise exception 'Requisição inválida ou muito grande.';end if;
select * into actor from public.profiles where id=auth.uid();
perform pg_advisory_xact_lock(763126,1);
select * into prev from public.inventarydaily_table where kind='log' and data->>'request_id'=p_request_id::text;
if prev.id is not null then
 if prev.created_by<>actor.id or prev.data->>'action'<>p_action or prev.data->'payload'<>p_payload then raise exception 'Identificador de requisição já utilizado.';end if;
 return prev.data->'result';end if;
if p_action in('stock_repack','stock_writeoff','stock_transfer','stock_unpack')then
if length(trim(coalesce(p_payload->>'reason','')))not between 3 and 2000 then raise exception 'Informe o motivo da movimentação (de 3 a 2000 caracteres).';end if;
source_kind:=case when p_action='stock_repack'then'loose'when p_action='stock_unpack'then'box'else p_payload->>'source'end;
if source_kind is null or source_kind not in('box','loose')then raise exception 'Selecione caixa ou chapas avulsas.';end if;
box.id:=null;
if source_kind='box'then
 select *into box from public.inventarydaily_table where id=(p_payload->>'box_id')::uuid and kind='box'for update;
 if box.id is null or box.data->>'status'<>'sealed'then raise exception 'Selecione uma caixa fechada com saldo disponível.';end if;
 v:=invd_private.spec(box.data||jsonb_build_object('quantity',case when p_action='stock_unpack'then box.data->'sheets'else coalesce(p_payload->'quantity',box.data->'sheets')end,'damaged',case when p_action in('stock_transfer','stock_unpack')then box.data->'damaged'else coalesce(p_payload->'damaged','0'::jsonb)end),true);
 available_q:=(box.data->>'sheets')::bigint;available_d:=(box.data->>'damaged')::bigint;
else
 v:=invd_private.spec(p_payload,true);
 foreach cat in array array['type','color','thickness','warehouse']loop
  val:=case when cat='thickness'then v->>'thickness_mm'else v->>cat end;canonical:=invd_private.catalog_value(cat,val);
  if canonical is null then raise exception 'Cadastre antes a característica do vidro: %.',val;end if;
  v:=v||jsonb_build_object(case when cat='thickness'then'thickness_mm'else cat end,case when cat='thickness'then to_jsonb(canonical::numeric)else to_jsonb(canonical)end);
 end loop;
 balance:=invd_private.loose_balance(v);available_q:=(balance->>'quantity')::bigint;available_d:=(balance->>'damaged')::bigint;
end if;
move_q:=(v->>'quantity')::bigint;move_d:=(v->>'damaged')::bigint;from_loc:=v->>'warehouse';to_loc:=case when p_action='stock_unpack'then from_loc else null end;
if p_action='stock_transfer'then
 to_loc:=invd_private.catalog_value('warehouse',p_payload->>'to_warehouse');
 if to_loc is null then raise exception 'Selecione um local de destino cadastrado.';end if;
 if invd_private.catalog_key('warehouse',to_loc)=invd_private.catalog_key('warehouse',from_loc)then raise exception 'A origem e o destino devem ser locais diferentes.';end if;
 if source_kind='box'and(move_q<>available_q or move_d<>available_d)then raise exception 'A transferência de caixa deve incluir todo o seu saldo e avarias.';end if;
end if;
if exists(select 1 from public.inventarydaily_table where kind='inventory'and data->>'status'='active'and(invd_private.scope_has(data->'warehouses',from_loc)or(to_loc is not null and invd_private.scope_has(data->'warehouses',to_loc))))then raise exception 'Conclua o inventário em andamento na origem ou destino antes de movimentar o estoque.';end if;
if move_q>available_q or move_d>available_d or move_q-move_d>available_q-available_d then raise exception 'Saldo insuficiente. Disponível: % chapas, sendo % avariadas.',available_q,available_d;end if;
-- Metadados da entrada original ficam imutáveis mesmo após baixas e transferências.
if source_kind='box'then
 box.data:=box.data||jsonb_build_object('received_at',coalesce(box.data->'received_at',to_jsonb(box.created_at)),'received_warehouse',coalesce(box.data->'received_warehouse',box.data->'warehouse'),'received_sheets',coalesce(box.data->'received_sheets',box.data->'sheets'),'received_damaged',coalesce(box.data->'received_damaged',box.data->'damaged'));
 update public.inventarydaily_table set data=box.data||case when p_action='stock_transfer'then jsonb_build_object('warehouse',to_loc)when p_action='stock_unpack'then jsonb_build_object('status','opened','opened_on',(now()at time zone'America/Manaus')::date,'opened_at',clock_timestamp())else jsonb_build_object('sheets',available_q-move_q,'damaged',available_d-move_d,'status',case when available_q=move_q then'depleted'else'sealed'end)end,updated_at=clock_timestamp()where id=box.id;
end if;
new_box_id:=null;
if p_action='stock_repack'then
 val:=upper(trim(coalesce(p_payload->>'code','')));
 if val!~'^[A-Z0-9][A-Z0-9_-]{2,39}$'then raise exception 'Código: use de 3 a 40 letras, números, hífen ou sublinhado.';end if;
 if exists(select 1 from public.inventarydaily_table where(kind='box'and upper(data->>'code')=val)or(kind='log'and data->>'action'='box_delete'and upper(data->'result'->'previous'->'data'->>'code')=val))then raise exception 'Este código já foi utilizado. Escolha outro código para a caixa.';end if;
 new_box_id:=gen_random_uuid();event_time:=clock_timestamp();
 insert into public.inventarydaily_table(id,kind,data,created_by,created_by_name,created_at,updated_at)values(new_box_id,'box',(v-'quantity')||jsonb_build_object('code',val,'invoice','Sem NF identificada','source','repack','status','sealed','sheets',move_q,'damaged',move_d,'received_at',event_time,'received_warehouse',from_loc,'received_sheets',move_q,'received_damaged',move_d),actor.id,actor.full_name,event_time,event_time);
end if;
v:=v-'quantity'-'warehouse'-'notes';
v:=v||jsonb_build_object('action',case p_action when'stock_repack'then'repack'when'stock_transfer'then'transfer'when'stock_unpack'then'unpack'else'writeoff'end,'source',source_kind,'from_warehouse',from_loc,'to_warehouse',to_loc,'quantity',move_q,'damaged',move_d,'box_id',box.id,'created_box_id',new_box_id,'reason',trim(p_payload->>'reason'));
insert into public.inventarydaily_table(kind,data,created_by,created_by_name,created_at,updated_at)values('stock_move',v,actor.id,actor.full_name,clock_timestamp(),clock_timestamp())returning id into row_id;
if p_action='stock_unpack'then update public.inventarydaily_table set data=data||jsonb_build_object('opened_by_move',row_id)where id=box.id;end if;
out:=jsonb_build_object('id',row_id,'box_id',coalesce(new_box_id,box.id),'quantity',move_q,'damaged',move_d);
elsif p_action='reorder_rule_save'then

v:='{}';
foreach cat in array array['type','color']loop
 val:=invd_private.catalog_text(p_payload->>cat);
 if val is null or length(val)not between 1 and 120 then raise exception 'Informe o tipo e a cor do vidro.';end if;
 val:=invd_private.catalog_value(cat,val);
 if val is null then raise exception 'Cadastre o tipo e a cor antes de criar a regra.';end if;
 v:=v||jsonb_build_object(cat,val);
end loop;
foreach cat in array array['thickness_mm','width_mm','height_mm']loop
 begin qty:=(p_payload->>cat)::numeric;exception when others then raise exception 'Espessura ou dimensão inválida.';end;
 if qty is null or qty<=0 or qty<>round(qty,3)or qty>(case when cat='thickness_mm'then 100 else 20000 end) then raise exception 'Espessura ou dimensão fora do limite.';end if;
 v:=v||jsonb_build_object(cat,trim_scale(qty));
end loop;
foreach cat in array array['minimum_sheets','target_sheets']loop
 begin qty:=(p_payload->>cat)::numeric;exception when others then raise exception 'Mínimo e alvo devem ser quantidades inteiras de chapas.';end;
 if qty is null or qty<0 or qty>1000000 or qty<>trunc(qty)then raise exception 'Mínimo e alvo devem ser inteiros entre 0 e 1000000.';end if;
 v:=v||jsonb_build_object(cat,qty::bigint);
end loop;
if(v->>'target_sheets')::bigint<(v->>'minimum_sheets')::bigint then raise exception 'O estoque alvo não pode ser menor que o mínimo.';end if;
if p_payload?'enabled' and jsonb_typeof(p_payload->'enabled')<>'boolean' then raise exception 'Situação da regra inválida.';end if;
v:=v||jsonb_build_object('enabled',coalesce((p_payload->>'enabled')::boolean,true));
row_id:=null;
if nullif(p_payload->>'id','')is not null then
 select * into prev from public.inventarydaily_table where id=(p_payload->>'id')::uuid and kind='reorder_rule'for update;
 if prev.id is null then raise exception 'Regra não encontrada. Atualize os dados.';end if;
 row_id:=prev.id;
end if;
select id into existing_id from public.inventarydaily_table where kind='reorder_rule' and invd_private.catalog_key('type',data->>'type')=invd_private.catalog_key('type',v->>'type') and invd_private.catalog_key('color',data->>'color')=invd_private.catalog_key('color',v->>'color')and(data->>'thickness_mm')::numeric=(v->>'thickness_mm')::numeric and(data->>'width_mm')::numeric=(v->>'width_mm')::numeric and(data->>'height_mm')::numeric=(v->>'height_mm')::numeric;
if existing_id is not null and row_id is not null and existing_id<>row_id then raise exception 'Já existe uma regra para este vidro e estas dimensões. Edite a regra existente.';end if;
if row_id is null and existing_id is not null then row_id:=existing_id;select * into prev from public.inventarydaily_table where id=row_id;end if;
if row_id is null then
 insert into public.inventarydaily_table(kind,data,created_by,created_by_name)values('reorder_rule',v,actor.id,actor.full_name)returning id into row_id;
 out:=jsonb_build_object('id',row_id);
else
 update public.inventarydaily_table set data=v,updated_at=now()where id=row_id;
 out:=jsonb_build_object('id',row_id,'previous',to_jsonb(prev));
end if;
elsif p_action in('inventory_delete','box_delete') then
if length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Informe o motivo da exclusão (de 3 a 2000 caracteres).';end if;
select * into prev from public.inventarydaily_table where id=(p_payload->>'id')::uuid and kind=case when p_action='inventory_delete' then 'inventory' else 'box' end for update;
if prev.id is null then raise exception 'Registro não encontrado. Atualize os dados antes de tentar novamente.';end if;
if p_action='inventory_delete' then
session:=prev;sid:=session.id;
if exists(select 1 from public.inventarydaily_table i where i.kind='inventory' and i.work_date>session.work_date and invd_private.scopes_overlap(i.data->'warehouses',session.data->'warehouses'))then raise exception 'Existe um inventário posterior. Exclua primeiro o inventário mais recente para preservar a sequência do estoque.';end if;
if session.data->>'status'='closed'and exists(select 1 from public.inventarydaily_table m where m.kind='stock_move'and m.created_at>coalesce((session.data->>'closed_at')::timestamptz,session.updated_at)and(invd_private.scope_has(session.data->'warehouses',m.data->>'from_warehouse')or invd_private.scope_has(session.data->'warehouses',m.data->>'to_warehouse')))then raise exception 'Há movimentações de estoque posteriores nos locais desta contagem. Preserve este inventário para manter os saldos e a auditoria.';end if;
if session.data->>'status'='closed' then
for box in select * from public.inventarydaily_table b where b.kind='box' and (session.data->'expected') @> jsonb_build_array(b.id)loop
 val:=session.data->'before_states'->box.id::text->>'status';
 if val is null then
  -- Inventários do piloto anteriores à captura do estado: reconstituir pelo histórico preservado.
  select case when x.kind='scan' then 'sealed' when x.data->>'outcome'='missing' then 'missing' when x.data->>'outcome'='opened' then 'opened' else 'sealed' end into val
  from public.inventarydaily_table i join public.inventarydaily_table x on x.parent_id=i.id and x.kind in('scan','decision')
  where i.kind='inventory' and i.data->>'status'='closed' and i.work_date<session.work_date and x.data->>'box_id'=box.id::text order by i.work_date desc limit 1;
 end if;
 val:=coalesce(val,'sealed');
 v:=box.data||jsonb_build_object('status',val);
 if box.data->>'opened_inventory_id'=sid::text then v:=v-'opened_inventory_id'-'opened_on';end if;
 update public.inventarydaily_table set data=v,updated_at=now()where id=box.id;
end loop;
end if;
select coalesce(jsonb_agg(to_jsonb(t)order by t.created_at,t.id),'[]')into v from public.inventarydaily_table t where parent_id=sid and kind in('scan','loose','decision');
out:=jsonb_build_object('id',sid,'deleted',true,'deleted_kind','inventory','previous',to_jsonb(session),'children',v);
-- Logs sobrevivem à exclusão sem uma chave estrangeira bloqueando o registro removido.
update public.inventarydaily_table set parent_id=null,data=data||jsonb_build_object('deleted_parent_id',sid)where parent_id=sid and kind='log';
delete from public.inventarydaily_table where parent_id=sid and kind in('scan','loose','decision');
delete from public.inventarydaily_table where id=sid;
sid:=null;
else
if exists(select 1 from public.inventarydaily_table where kind='stock_move'and(data->>'box_id'=prev.id::text or data->>'created_box_id'=prev.id::text))then raise exception 'Esta caixa possui movimentações de estoque. Utilize baixa manual para retirar seu saldo, preservando a auditoria.';end if;
if exists(select 1 from public.inventarydaily_table i where i.kind='inventory' and (i.data->'expected') @> jsonb_build_array(prev.id))or exists(select 1 from public.inventarydaily_table x where x.kind in('scan','decision')and x.data->>'box_id'=prev.id::text)then raise exception 'Este item está vinculado a um inventário. Exclua primeiro os inventários que o utilizaram, começando pelo mais recente.';end if;
out:=jsonb_build_object('id',prev.id,'deleted',true,'deleted_kind','box','previous',to_jsonb(prev));
update public.inventarydaily_table set parent_id=null,data=data||jsonb_build_object('deleted_parent_id',prev.id)where parent_id=prev.id and kind='log';
delete from public.inventarydaily_table where id=prev.id;
end if;
elsif p_action='catalog_add' then
cat:=p_payload->>'category';val:=invd_private.catalog_text(p_payload->>'value');
if cat not in('type','color','thickness','warehouse') or cat is null or val is null or length(val) not between 1 and 120 then raise exception 'Categoria ou valor inválido.';end if;
if cat='thickness' then val:=replace(val,',','.');if val !~ '^[0-9]+([.][0-9]{1,3})?$' or val::numeric<=0 or val::numeric>100 then raise exception 'Espessura inválida.';end if;val:=trim(trailing '.' from trim(trailing '0' from to_char(val::numeric,'FM99990.000')));end if;
select id into row_id from public.inventarydaily_table where kind='catalog'and data->>'category'=cat and invd_private.catalog_key(cat,data->>'value')=invd_private.catalog_key(cat,val)order by created_at,id limit 1;
if row_id is null then insert into public.inventarydaily_table(kind,data,created_by,created_by_name) values('catalog',jsonb_build_object('category',cat,'value',val),actor.id,actor.full_name)returning id into row_id;end if;out:=jsonb_build_object('id',row_id);
elsif p_action='box_create' then

if coalesce(jsonb_typeof(p_payload->'items'),'null')<>'array' or coalesce(jsonb_array_length(p_payload->'items'),0) not between 1 and 500 then raise exception 'Envie de 1 a 500 caixas por importação.';end if;
n:=0;for x in select * from jsonb_array_elements(p_payload->'items') loop n:=n+1;
v:=invd_private.spec(x);row_id:=gen_random_uuid();
-- Catálogos controlados, inclusive via importação.
foreach cat in array array['type','color','thickness','warehouse'] loop
 val:=case cat when 'thickness' then v->>'thickness_mm' else v->>cat end;
 canonical:=invd_private.catalog_value(cat,val);
 if canonical is null then raise exception 'Registro %: % "%" não encontrado no cadastro. Confira a aba Cadastros.',n,case cat when 'type'then'Tipo de vidro'when'color'then'Cor'when'thickness'then'Espessura (mm)'else'Galpão/local'end,val;end if;
 v:=v||jsonb_build_object(case when cat='thickness'then'thickness_mm'else cat end,case when cat='thickness'then to_jsonb(canonical::numeric)else to_jsonb(canonical)end);
end loop;
if exists(select 1 from public.inventarydaily_table where kind='inventory'and data->>'status'='active'and invd_private.scope_has(data->'warehouses',v->>'warehouse'))then raise exception 'Conclua o inventário no local % antes de registrar entradas.',v->>'warehouse';end if;
event_time:=clock_timestamp();v:=v||jsonb_build_object('code','CDE-'||upper(replace(row_id::text,'-','')),'source','receipt','received_at',event_time,'received_warehouse',v->>'warehouse','received_sheets',v->'sheets','received_damaged',v->'damaged');
insert into public.inventarydaily_table(id,kind,data,created_by,created_by_name,created_at,updated_at)values(row_id,'box',v,actor.id,actor.full_name,event_time,event_time);ids:=ids||to_jsonb(row_id);end loop;
out:=jsonb_build_object('ids',ids,'id',ids->>0);
elsif p_action='inventory_start'then
begin d:=(p_payload->>'date')::date;exception when others then raise exception 'Data inválida.';end;
if d is null or d>(now()at time zone'America/Manaus')::date then raise exception 'Informe uma data válida, sem data futura.';end if;
if coalesce(jsonb_typeof(p_payload->'warehouses'),'null')<>'array'or jsonb_array_length(p_payload->'warehouses')not between 1 and 100 then raise exception 'Selecione ao menos um local para o inventário.';end if;
if exists(select 1 from jsonb_array_elements(p_payload->'warehouses')w where jsonb_typeof(w.value)<>'string')then raise exception 'Seleção de locais inválida.';end if;
v:='[]';for val in select value from jsonb_array_elements_text(p_payload->'warehouses')loop
 canonical:=invd_private.catalog_value('warehouse',val);if canonical is null then raise exception 'Local não cadastrado: %.',val;end if;
 if not invd_private.scope_has(v,canonical)then v:=v||jsonb_build_array(canonical);end if;
end loop;
if exists(select 1 from public.inventarydaily_table where kind='inventory'and data->>'status'='active')then raise exception 'Já existe um inventário em andamento. Conclua ou exclua a contagem ativa antes de iniciar outra.';end if;
if exists(select 1 from public.inventarydaily_table where kind='inventory'and work_date>=d and invd_private.scopes_overlap(data->'warehouses',v))then raise exception 'Já existe inventário nesta data ou em data posterior para um dos locais selecionados.';end if;
select coalesce(jsonb_agg(id order by created_at,id),'[]')into ids from public.inventarydaily_table where kind='box'and data->>'status'in('sealed','missing')and invd_private.scope_has(v,data->>'warehouse');
insert into public.inventarydaily_table(kind,work_date,data,created_by,created_by_name,created_at,updated_at)values('inventory',d,jsonb_build_object('status','active','expected',ids,'warehouses',v,'before_states',(select coalesce(jsonb_object_agg(id::text,jsonb_build_object('status',data->>'status')),'{}')from public.inventarydaily_table where kind='box'and ids@>jsonb_build_array(id)),'box_snapshot',(select coalesce(jsonb_agg(to_jsonb(b)order by b.created_at,b.id),'[]')from public.inventarydaily_table b where b.kind='box'and ids@>jsonb_build_array(b.id))),actor.id,actor.full_name,clock_timestamp(),clock_timestamp())returning id into row_id;out:=jsonb_build_object('id',row_id);
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
select invd_private.catalog_text(w.value)into canonical from jsonb_array_elements_text(session.data->'warehouses')w where invd_private.catalog_key('warehouse',w.value)=invd_private.catalog_key('warehouse',v->>'warehouse')limit 1;
if canonical is null then raise exception 'Galpão não incluído neste inventário.';end if;v:=v||jsonb_build_object('warehouse',canonical);
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
update public.inventarydaily_table set data=data||jsonb_build_object('status','closed','summary',v,'closed_at',clock_timestamp(),'closed_by',actor.id,'closed_by_name',actor.full_name),updated_at=now()where id=sid;
out:=jsonb_build_object('id',sid,'summary',v);
end if;
else raise exception 'Operação desconhecida.';end if;
insert into public.inventarydaily_table(kind,parent_id,data,created_by,created_by_name)values('log',sid,jsonb_build_object('request_id',p_request_id,'action',p_action,'payload',p_payload,'result',out),actor.id,actor.full_name);
return out;
end$$;

commit;
