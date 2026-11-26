begin;
do $$declare uid uuid;begin
 select id into uid from public.profiles where is_master is true order by created_at limit 1;
 if uid is null then select id into uid from public.profiles where lower(role)='gerente'limit 1;end if;
 perform set_config('cde.qa.manager',uid::text,true);
end$$;
set local role authenticated;
do $$
declare p jsonb:='{"type":"comum","color":"INCOLOR","thickness_mm":4,"width_mm":1234.567,"height_mm":1987.654,"minimum_sheets":20,"target_sheets":50,"enabled":true}';req uuid:=gen_random_uuid();r jsonb;a uuid;b uuid;vitor uuid;n bigint;
begin
select id into vitor from public.profiles where full_name='Vitor Amaral';
perform set_config('request.jwt.claim.sub',vitor::text,true);
begin perform public.invd_command('reorder_rule_save',req,p);raise exception 'Operador configurou parâmetros';exception when insufficient_privilege then null;end;
perform set_config('request.jwt.claim.sub',current_setting('cde.qa.manager'),true);
r:=public.invd_command('reorder_rule_save',req,p);a:=(r->>'id')::uuid;
assert public.invd_command('reorder_rule_save',req,p)=r,'retry alterou regra';
assert(select data->>'type'from public.inventarydaily_table where id=a)='Comum','catálogo não canônico';
r:=public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"minimum_sheets":25}');
assert(r->>'id')::uuid=a,'duplicou SKU no upsert';
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"target_sheets":19}');raise exception 'Alvo menor que mínimo aceito';exception when raise_exception then if sqlerrm='Alvo menor que mínimo aceito'then raise;end if;end;
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"minimum_sheets":1.5}');raise exception 'Quantidade decimal aceita';exception when raise_exception then if sqlerrm='Quantidade decimal aceita'then raise;end if;end;
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"target_sheets":1000001}');raise exception 'Quantidade acima limite aceita';exception when raise_exception then if sqlerrm='Quantidade acima limite aceita'then raise;end if;end;
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"enabled":"false"}');raise exception 'Booleano inválido aceito';exception when raise_exception then if sqlerrm='Booleano inválido aceito'then raise;end if;end;
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"width_mm":20001}');raise exception 'Dimensão inválida aceita';exception when raise_exception then if sqlerrm='Dimensão inválida aceita'then raise;end if;end;
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"type":"Tipo desconhecido"}');raise exception 'Catálogo inexistente aceito';exception when raise_exception then if sqlerrm='Catálogo inexistente aceito'then raise;end if;end;
r:=public.invd_command('reorder_rule_save',gen_random_uuid(),p||jsonb_build_object('id',a,'enabled',false));assert(select(data->>'enabled')::boolean from public.inventarydaily_table where id=a)=false,'não inativou';
r:=public.invd_command('reorder_rule_save',gen_random_uuid(),p||'{"width_mm":1235.567}');b:=(r->>'id')::uuid;
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),p||jsonb_build_object('id',b));raise exception 'Editou para SKU duplicado';exception when raise_exception then if sqlerrm='Editou para SKU duplicado'then raise;end if;end;
assert exists(select 1 from public.inventarydaily_table where kind='log'and data->>'action'='reorder_rule_save'and data->'result'->>'id'=a::text and created_by=current_setting('cde.qa.manager')::uuid),'sem log';
perform set_config('request.jwt.claim.sub',vitor::text,true);
assert exists(select 1 from public.inventarydaily_table where id=a and kind='reorder_rule'),'operador não lê regra';
begin perform public.invd_command('reorder_rule_save',req,p);raise exception 'Replay gerencial liberado ao operador';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'PASS: regras gerenciais, leitura operacional, catálogo canônico, mínimo/alvo/limites, inativação, SKU único, auditoria e idempotência. Rollback.'as resultado;
rollback;
