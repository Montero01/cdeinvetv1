begin;
-- Fixtures isoladas: nenhum cadastro real é excluído. Tudo termina em rollback.
do $$
declare uid uuid; inv1 uuid:=gen_random_uuid();inv2 uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();base jsonb;day date:=(now()at time zone'America/Manaus')::date+100;logid uuid;
begin
select id into uid from public.profiles where is_master is true order by created_at limit 1;
if uid is null then select id into uid from public.profiles where lower(role)='gerente' limit 1;end if;
perform set_config('cde.qa.manager',uid::text,true);perform set_config('cde.qa.inv1',inv1::text,true);perform set_config('cde.qa.inv2',inv2::text,true);perform set_config('cde.qa.a',a::text,true);perform set_config('cde.qa.b',b::text,true);perform set_config('cde.qa.c',c::text,true);
base:=jsonb_build_object('invoice','QA-DELETE-ROLLBACK-'||a,'type','Comum','color','Incolor','thickness_mm',4,'width_mm',2000,'height_mm',1000,'sheets',10,'damaged',0,'warehouse','QA Exclusão','status','sealed');
insert into public.inventarydaily_table(id,kind,data)values(a,'box',base||jsonb_build_object('code','QA-'||a)),(b,'box',base||jsonb_build_object('code','QA-'||b,'status','missing')),(c,'box',base||jsonb_build_object('code','QA-'||c,'status','opened','opened_on',day+1,'opened_inventory_id',inv2));
-- Primeiro inventário usa fallback histórico (sem before_states).
insert into public.inventarydaily_table(id,kind,work_date,data)values(inv1,'inventory',day,jsonb_build_object('status','closed','expected',jsonb_build_array(a,b,c),'warehouses',jsonb_build_array('QA Exclusão'))),(inv2,'inventory',day+1,jsonb_build_object('status','closed','expected',jsonb_build_array(a,b,c),'warehouses',jsonb_build_array('QA Exclusão'),'before_states',jsonb_build_object(a::text,jsonb_build_object('status','sealed'),b::text,jsonb_build_object('status','missing'),c::text,jsonb_build_object('status','sealed'))));
insert into public.inventarydaily_table(kind,parent_id,work_date,data)values
('scan',inv1,day,jsonb_build_object('box_id',a)),('decision',inv1,day,jsonb_build_object('box_id',b,'outcome','missing','notes','Teste')),
('decision',inv1,day,jsonb_build_object('box_id',c,'outcome','sealed','notes','Teste')),
('scan',inv2,day+1,jsonb_build_object('box_id',a)),('decision',inv2,day+1,jsonb_build_object('box_id',b,'outcome','missing','notes','Teste')),
('decision',inv2,day+1,jsonb_build_object('box_id',c,'outcome','opened')),('loose',inv2,day+1,base||'{"quantity":4}');
insert into public.inventarydaily_table(kind,parent_id,data)values('log',inv2,jsonb_build_object('action','QA-fixture','box_id',c))returning id into logid;perform set_config('cde.qa.log',logid::text,true);
end$$;
set local role authenticated;
do $$
declare inv1 uuid:=current_setting('cde.qa.inv1')::uuid;inv2 uuid:=current_setting('cde.qa.inv2')::uuid;a uuid:=current_setting('cde.qa.a')::uuid;b uuid:=current_setting('cde.qa.b')::uuid;c uuid:=current_setting('cde.qa.c')::uuid;vitor uuid;payload jsonb;req uuid:=gen_random_uuid();r jsonb;
begin
select id into vitor from public.profiles where full_name='Vitor Amaral';perform set_config('request.jwt.claim.sub',vitor::text,true);
begin perform public.invd_command('inventory_delete',gen_random_uuid(),jsonb_build_object('id',inv2,'reason','Teste'));raise exception 'Operador excluiu inventário';exception when insufficient_privilege then null;end;
begin perform public.invd_command('box_delete',gen_random_uuid(),jsonb_build_object('id',a,'reason','Teste'));raise exception 'Operador excluiu item';exception when insufficient_privilege then null;end;
perform set_config('request.jwt.claim.sub',current_setting('cde.qa.manager'),true);
begin perform public.invd_command('inventory_delete',gen_random_uuid(),jsonb_build_object('id',inv2,'reason',''));raise exception 'Excluiu sem motivo';exception when raise_exception then if sqlerrm='Excluiu sem motivo'then raise;end if;end;
begin perform public.invd_command('inventory_delete',gen_random_uuid(),jsonb_build_object('id',inv1,'reason','Teste'));raise exception 'Excluiu fora de ordem';exception when raise_exception then if sqlerrm='Excluiu fora de ordem'then raise;end if;end;
begin perform public.invd_command('box_delete',gen_random_uuid(),jsonb_build_object('id',a,'reason','Teste'));raise exception 'Excluiu caixa vinculada';exception when raise_exception then if sqlerrm='Excluiu caixa vinculada'then raise;end if;end;
payload:=jsonb_build_object('id',inv2,'reason','Remover teste');r:=public.invd_command('inventory_delete',req,payload);
assert (r->>'deleted')::boolean,'inventário não excluído';assert public.invd_command('inventory_delete',req,payload)=r,'retry não idempotente';
assert not exists(select 1 from public.inventarydaily_table where id=inv2 or(parent_id=inv2 and kind in('scan','loose','decision'))),'sobrou inventário/filhos';
assert exists(select 1 from public.inventarydaily_table where id=current_setting('cde.qa.log')::uuid and parent_id is null),'perdeu log antigo';
assert(select data->>'status'from public.inventarydaily_table where id=a)='sealed','não restaurou lacrada';
assert(select data->>'status'from public.inventarydaily_table where id=b)='missing','não restaurou missing';
assert(select data->>'status'from public.inventarydaily_table where id=c)='sealed','não reverteu abertura';
assert not exists(select 1 from public.inventarydaily_table where id=c and data?'opened_on'),'sobrou data de abertura';
perform public.invd_command('inventory_delete',gen_random_uuid(),jsonb_build_object('id',inv1,'reason','Remover teste anterior'));
assert(select data->>'status'from public.inventarydaily_table where id=b)='sealed','fallback não restaurou estado original';
req:=gen_random_uuid();payload:=jsonb_build_object('id',a,'reason','Apagar caixa teste');r:=public.invd_command('box_delete',req,payload);assert not exists(select 1 from public.inventarydaily_table where id=a),'caixa não excluída';assert public.invd_command('box_delete',req,payload)=r,'retry item não idempotente';
assert exists(select 1 from public.inventarydaily_table where kind='log' and data->>'action'='box_delete' and data->'result'->'previous'->>'id'=a::text and created_by=current_setting('cde.qa.manager')::uuid),'sem auditoria da exclusão';
end$$;
reset role;
select 'PASS: exclusão gerencial, motivo, ordem temporal, caixas vinculadas, restauração de lacrada/missing/aberta, fallback legado, auditoria e reenvio idempotente. Rollback.' as resultado;
rollback;
