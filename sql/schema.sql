-- CDE Inventário Diário. Uma tabela de domínio, sem alterar profiles/PDI.
begin;
create schema if not exists invd_private;
revoke all on schema invd_private from public,anon;
grant usage on schema invd_private to authenticated;
create table public.inventarydaily_table (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in('access','catalog','box','inventory','scan','loose','decision','log')),
 parent_id uuid references public.inventarydaily_table(id),
 work_date date not null default (now() at time zone 'America/Manaus')::date,
 data jsonb not null default '{}' check(jsonb_typeof(data)='object'),
 created_by uuid references public.profiles(id), created_by_name text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index invd_created_by on public.inventarydaily_table(created_by);
create index invd_parent on public.inventarydaily_table(parent_id,kind);
create index invd_kind_time on public.inventarydaily_table(kind,created_at,id);
create unique index invd_code on public.inventarydaily_table((data->>'code')) where kind='box';
create unique index invd_session_day on public.inventarydaily_table(work_date) where kind='inventory';
create unique index invd_one_active on public.inventarydaily_table((kind)) where kind='inventory' and data->>'status'='active';
create unique index invd_scan_once on public.inventarydaily_table(parent_id,(data->>'box_id')) where kind='scan';
create unique index invd_decision_once on public.inventarydaily_table(parent_id,(data->>'box_id')) where kind='decision';
create unique index invd_request on public.inventarydaily_table((data->>'request_id')) where kind='log';
create unique index invd_catalog on public.inventarydaily_table((data->>'category'),lower(data->>'value')) where kind='catalog';
create unique index invd_access on public.inventarydaily_table((data->>'user_id')) where kind='access';
alter table public.inventarydaily_table enable row level security;
revoke all on public.inventarydaily_table from anon,authenticated;

create function invd_private.manager() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.is_master is true or lower(p.role) in('gerente','gerencia','manager','diretor','diretoria','director','master','admin')))
$$;
create function invd_private.allowed() returns boolean language sql stable security definer set search_path='' as $$
select (select auth.uid()) is not null and (invd_private.manager() or exists(select 1 from public.inventarydaily_table a join public.profiles p on p.id=(select auth.uid()) where a.kind='access' and a.data->>'user_id'=p.id::text and a.data->>'enabled'='true'))
$$;
revoke all on function invd_private.manager(),invd_private.allowed() from public,anon;
grant execute on function invd_private.manager(),invd_private.allowed() to authenticated;
grant select on public.inventarydaily_table to authenticated;
create policy invd_read on public.inventarydaily_table for select to authenticated using ((select invd_private.allowed()) and kind<>'access' and (kind<>'log' or (select invd_private.manager())));

insert into public.inventarydaily_table(kind,data,created_by_name)
 select 'access',jsonb_build_object('user_id',id,'enabled',true),'Configuração inicial' from public.profiles where full_name='Vitor Amaral';
insert into public.inventarydaily_table(kind,data,created_by_name)
select 'catalog',jsonb_build_object('category',category,'value',value),'Configuração inicial' from (values
('type','Comum'),('type','Laminado'),('type','Espelho'),('type','Habitat'),('type','Outro'),
('color','Verde'),('color','Incolor'),('color','Fumê'),('color','Cinza'),('color','Reflexivo'),('color','Âmbar'),
('thickness','4'),('thickness','6'),('thickness','8'),('thickness','10'),('thickness','12'))v(category,value);

create function invd_private.context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles;begin
select * into p from public.profiles where id=auth.uid();
if p.id is null then raise exception 'Entre com seu acesso do PDI.' using errcode='42501';end if;
return jsonb_build_object('profile',jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role,'sector',p.sector,'position',p.position),'allowed',invd_private.allowed(),'can_manage',invd_private.manager());end$$;
create function public.invd_context() returns jsonb language sql stable security invoker set search_path='' as $$select invd_private.context()$$;

create function invd_private.list(p_offset integer,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
if not invd_private.allowed() then raise exception 'Seu perfil não tem acesso ao inventário.' using errcode='42501';end if;
return (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]') from (select * from public.inventarydaily_table where kind<>'access' and (kind<>'log' or invd_private.manager()) order by created_at,id offset greatest(0,p_offset) limit least(greatest(1,p_limit),1000))t);
end$$;
create function public.invd_list(p_offset integer default 0,p_limit integer default 500) returns jsonb language sql stable security invoker set search_path='' as $$select invd_private.list(p_offset,p_limit)$$;

create function invd_private.spec(p jsonb,loose boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare k text;v numeric;r jsonb:='{}';q bigint;d bigint;
begin
foreach k in array array['type','color','warehouse'] loop
 if length(trim(coalesce(p->>k,''))) not between 1 and 120 then raise exception 'Informe tipo, cor e galpão (até 120 caracteres).';end if;
 r:=r||jsonb_build_object(k,trim(p->>k));
end loop;
foreach k in array array['thickness_mm','width_mm','height_mm'] loop
 begin v:=(p->>k)::numeric;exception when others then raise exception 'Dimensão ou espessura inválida.';end;
 if v is null or v<=0 or v>20000 or v<>round(v,3) then raise exception 'Dimensão ou espessura inválida.';end if;
 if k='thickness_mm' and v>100 then raise exception 'Espessura acima de 100 mm.';end if;
 r:=r||jsonb_build_object(k,trim_scale(v));
end loop;
begin q:=(p->>(case when loose then 'quantity' else 'sheets' end))::numeric;d:=coalesce((p->>'damaged')::numeric,0);
exception when others then raise exception 'Quantidade e avarias devem ser inteiras.';end;
if q is null or q<1 or q>100000 or d<0 or d>q or (p->>(case when loose then 'quantity' else 'sheets' end))::numeric<>q or coalesce((p->>'damaged')::numeric,0)<>d then raise exception 'Quantidade inválida ou avarias acima do total de chapas.';end if;
r:=r||jsonb_build_object(case when loose then 'quantity' else 'sheets' end,q,'damaged',d);
if not loose then
 if length(trim(coalesce(p->>'invoice',''))) not between 1 and 80 then raise exception 'Informe a nota fiscal (até 80 caracteres).';end if;
 r:=r||jsonb_build_object('invoice',trim(p->>'invoice'),'status','sealed');
 if coalesce(p->>'photo_url','')<>'' then
 if length(p->>'photo_url')>2000 or (p->>'photo_url') !~ '^https://[^[:space:]]+$' then raise exception 'Use um link HTTPS para a foto.';end if;
 r:=r||jsonb_build_object('photo_url',p->>'photo_url');end if;
end if;
return r||jsonb_build_object('notes',left(coalesce(p->>'notes',''),2000));
end$$;

create function invd_private.summary(sid uuid) returns jsonb language sql stable set search_path='' as $$
with inv as(select * from public.inventarydaily_table where id=sid),
b as(select b.* from inv i cross join lateral jsonb_array_elements_text(i.data->'expected')e join public.inventarydaily_table b on b.id=e.value::uuid),
sealed as(select b.* from b where exists(select 1 from public.inventarydaily_table x where x.parent_id=sid and x.data->>'box_id'=b.id::text and (x.kind='scan' or (x.kind='decision' and x.data->>'outcome'='sealed')))),
phys as(select data,(data->>'sheets')::numeric as q,'sealed' as src from sealed union all select data,(data->>'quantity')::numeric,'loose' from public.inventarydaily_table where parent_id=sid and kind='loose'),
g as(select data->>'type' as type,data->>'color' as color,(data->>'thickness_mm')::numeric as thickness_mm,(data->>'width_mm')::numeric as width_mm,(data->>'height_mm')::numeric as height_mm,data->>'warehouse' as warehouse,sum(q) as sheets,sum((data->>'damaged')::numeric) as damaged,sum(q*(data->>'width_mm')::numeric*(data->>'height_mm')::numeric/1000000) as m2,sum(q)filter(where src='sealed') as sealed_sheets,sum(q)filter(where src='loose') as loose_sheets from phys group by 1,2,3,4,5,6)
select jsonb_build_object(
'sealed_boxes',(select count(*) from sealed),
'sealed_sheets',coalesce((select sum(q) from phys where src='sealed'),0),
'sealed_damaged',coalesce((select sum((data->>'damaged')::numeric)from phys where src='sealed'),0),
'sealed_m2',coalesce((select sum(q*(data->>'width_mm')::numeric*(data->>'height_mm')::numeric/1000000)from phys where src='sealed'),0),
'loose_sheets',coalesce((select sum(q)from phys where src='loose'),0),
'loose_damaged',coalesce((select sum((data->>'damaged')::numeric)from phys where src='loose'),0),
'loose_m2',coalesce((select sum(q*(data->>'width_mm')::numeric*(data->>'height_mm')::numeric/1000000)from phys where src='loose'),0),
 'total_sheets',coalesce((select sum(q)from phys),0),
 'total_m2',coalesce((select sum(q*(data->>'width_mm')::numeric*(data->>'height_mm')::numeric/1000000)from phys),0),
 'missing_boxes',(select count(*)from public.inventarydaily_table where parent_id=sid and kind='decision' and data->>'outcome'='missing'),
 'opened_boxes',(select count(*)from public.inventarydaily_table where parent_id=sid and kind='decision' and data->>'outcome'='opened'),
 'groups',coalesce((select jsonb_agg(to_jsonb(g))from g),'[]'))
$$;

create function invd_private.command(p_action text,p_request_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
create function public.invd_command(p_action text,p_request_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path='' as $$select invd_private.command(p_action,p_request_id,p_payload)$$;
revoke all on all functions in schema invd_private from public,anon;
revoke all on function public.invd_context(),public.invd_list(integer,integer),public.invd_command(text,uuid,jsonb) from public,anon;
grant execute on function invd_private.context(),invd_private.list(integer,integer),invd_private.command(text,uuid,jsonb) to authenticated;
grant execute on function public.invd_context(),public.invd_list(integer,integer),public.invd_command(text,uuid,jsonb) to authenticated;
comment on table public.inventarydaily_table is 'Inventário diário de vidro: caixas, contagens, conferências e auditoria. Fotos externas por link; sem binários.';
notify pgrst,'reload schema';
commit;
