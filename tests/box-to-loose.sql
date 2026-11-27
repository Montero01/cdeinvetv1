begin;
-- Fixtures em locais exclusivos. O rollback remove caixas, movimentos e logs de QA.
do $$declare v uuid;begin
 select id into v from public.profiles where full_name='Vitor Amaral';
 assert v is not null,'Perfil operacional do piloto ausente';
 perform set_config('qa.vitor',v::text,true);
end$$;
set local role authenticated;
do $$
declare a uuid;packed uuid;r jsonb;p jsonb;req uuid:=gen_random_uuid();
 code text:='QA-UNPACK-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.vitor'),true);
 perform public.invd_command('catalog_add',gen_random_uuid(),'{"category":"warehouse","value":"QA-UNPACK-A"}');
 perform public.invd_command('catalog_add',gen_random_uuid(),'{"category":"warehouse","value":"QA-UNPACK-B"}');
 perform public.invd_command('catalog_add',gen_random_uuid(),'{"category":"warehouse","value":"QA-UNPACK-C"}');
 p:='{"invoice":"QA-ROLLBACK","type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"sheets":8,"damaged":2,"warehouse":"QA-UNPACK-A"}';
 r:=public.invd_command('box_create',gen_random_uuid(),jsonb_build_object('items',jsonb_build_array(p)));
 a:=(r->'ids'->>0)::uuid;
 -- A operação abre a caixa inteira; o cliente não pode reduzir quantidade/avarias.
 p:=jsonb_build_object('box_id',a,'source','loose','quantity',1,'damaged',0,'reason','QA abertura integral');
 r:=public.invd_command('stock_unpack',req,p);
 assert (r->>'quantity')::integer=8 and (r->>'damaged')::integer=2,'Abertura parcial ou avarias perdidas';
 assert public.invd_command('stock_unpack',req,p)=r,'Reenvio repetiu a operação';
 assert (select data->>'status' from public.inventarydaily_table where id=a)='opened','Caixa não foi aberta';
 assert (select (data->>'sheets')::integer=8 and (data->>'damaged')::integer=2 from public.inventarydaily_table where id=a),'Metadados da caixa foram apagados';
 assert (select (data->>'received_sheets')::integer=8 and (data->>'received_damaged')::integer=2 and data->>'received_warehouse'='QA-UNPACK-A' from public.inventarydaily_table where id=a),'Entrada original não foi preservada';
 assert (select data->>'opened_by_move' from public.inventarydaily_table where id=a)=r->>'id','Sem vínculo de abertura';
 assert (select count(*) from public.inventarydaily_table where kind='stock_move' and data->>'box_id'=a::text and data->>'action'='unpack')=1,'Ledger duplicado';
 assert (select created_by::text=current_setting('qa.vitor') and data->>'source'='box' and data->>'from_warehouse'=data->>'to_warehouse' from public.inventarydaily_table where id=(r->>'id')::uuid),'Autoria/origem/destino incorretos';
 begin
  perform public.invd_command('stock_unpack',gen_random_uuid(),p);
  raise exception 'QA: aceitou caixa já aberta';
 exception when raise_exception then if sqlerrm='QA: aceitou caixa já aberta' then raise;end if;end;
 perform set_config('qa.unpack_request',req::text,true);
 perform set_config('qa.box',a::text,true);
end$$;
reset role;
do $$declare b jsonb;begin
 b:=invd_private.loose_balance('{"type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"warehouse":"QA-UNPACK-A"}');
 assert (b->>'quantity')::integer=8 and (b->>'damaged')::integer=2,'Abertura não creditou saldo avulso uma única vez';
 assert (select count(*) from public.inventarydaily_table where kind='log' and data->>'request_id'=current_setting('qa.unpack_request'))=1,'Auditoria não foi idempotente';
end$$;
set local role authenticated;
do $$
declare packed uuid;r jsonb;p jsonb;code text:='QA-REPACK-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.vitor'),true);
 p:='{"type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"warehouse":"QA-UNPACK-A","quantity":5,"damaged":1,"reason":"QA reagrupar avulsas"}';
 r:=public.invd_command('stock_repack',gen_random_uuid(),p||jsonb_build_object('code',code));
 packed:=(r->>'box_id')::uuid;
 perform public.invd_command('stock_transfer',gen_random_uuid(),jsonb_build_object('source','box','box_id',packed,'to_warehouse','QA-UNPACK-B','reason','QA transferência integral'));
 perform public.invd_command('stock_writeoff',gen_random_uuid(),p||'{"source":"loose","quantity":1,"damaged":0,"reason":"QA baixa de uma chapa boa"}');
 perform public.invd_command('stock_unpack',gen_random_uuid(),jsonb_build_object('box_id',packed,'reason','QA abertura no destino'));
 assert (select data->>'received_warehouse' from public.inventarydaily_table where id=packed)='QA-UNPACK-A','Abertura no destino alterou origem histórica';
 perform set_config('qa.packed',packed::text,true);
end$$;
reset role;
do $$declare p jsonb:='{"type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"warehouse":"QA-UNPACK-A"}';a jsonb;b jsonb;begin
 a:=invd_private.loose_balance(p);b:=invd_private.loose_balance(p||'{"warehouse":"QA-UNPACK-B"}');
 assert (a->>'quantity')::integer=2 and (a->>'damaged')::integer=1,'Saldo A incorreto após reagrupar/baixa';
 assert (b->>'quantity')::integer=5 and (b->>'damaged')::integer=1,'Saldo B incorreto após transferir/abrir';
 assert (a->>'quantity')::integer+(b->>'quantity')::integer=7,'Aberturas/reagrupamento criaram ou perderam chapas';
 assert not exists(select 1 from public.inventarydaily_table where kind='box' and id in(current_setting('qa.box')::uuid,current_setting('qa.packed')::uuid) and data->>'status'='sealed'),'Caixas abertas continuaram no estoque fechado';
end$$;
set local role authenticated;
do $$
declare i uuid;a uuid;c uuid;r jsonb;p jsonb;d date:=(now()at time zone'America/Manaus')::date;
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.vitor'),true);
 -- Uma contagem posterior absorve a abertura no próprio local, sem duplicá-la.
 r:=public.invd_command('inventory_start',gen_random_uuid(),jsonb_build_object('date',d,'warehouses',jsonb_build_array('QA-UNPACK-B')));i:=(r->>'id')::uuid;
 p:='{"type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"warehouse":"QA-UNPACK-B","quantity":5,"damaged":1}';
 perform public.invd_command('inventory_loose',gen_random_uuid(),p||jsonb_build_object('inventory_id',i));
 perform public.invd_command('inventory_finish',gen_random_uuid(),jsonb_build_object('inventory_id',i,'confirmed_warehouses',jsonb_build_array('QA-UNPACK-B')));
 -- A origem em contagem bloqueia abertura; outros locais continuam livres.
 p:='{"invoice":"QA-ROLLBACK","type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"sheets":4,"damaged":0,"warehouse":"QA-UNPACK-A"}';
 r:=public.invd_command('box_create',gen_random_uuid(),jsonb_build_object('items',jsonb_build_array(p,p||'{"warehouse":"QA-UNPACK-C","sheets":3}')));
 a:=(r->'ids'->>0)::uuid;c:=(r->'ids'->>1)::uuid;
 perform public.invd_command('inventory_start',gen_random_uuid(),jsonb_build_object('date',d,'warehouses',jsonb_build_array('QA-UNPACK-A')));
 begin
  perform public.invd_command('stock_unpack',gen_random_uuid(),jsonb_build_object('box_id',a,'reason','QA origem ativa'));
  raise exception 'QA: abertura durante inventário ativo';
 exception when raise_exception then if sqlerrm='QA: abertura durante inventário ativo' then raise;end if;end;
 assert (select data->>'status' from public.inventarydaily_table where id=a)='sealed','Falha alterou caixa bloqueada';
 perform public.invd_command('stock_unpack',gen_random_uuid(),jsonb_build_object('box_id',c,'reason','QA local livre'));
end$$;
reset role;
do $$declare p jsonb:='{"type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"warehouse":"QA-UNPACK-A"}';b jsonb;begin
 b:=invd_private.loose_balance(p);assert (b->>'quantity')::integer=2 and (b->>'damaged')::integer=1,'Contagem B apagou avulsas A';
 b:=invd_private.loose_balance(p||'{"warehouse":"QA-UNPACK-B"}');assert (b->>'quantity')::integer=5 and (b->>'damaged')::integer=1,'Contagem B duplicou abertura anterior';
 b:=invd_private.loose_balance(p||'{"warehouse":"QA-UNPACK-C"}');assert (b->>'quantity')::integer=3 and (b->>'damaged')::integer=0,'Local livre não recebeu avulsas';
end$$;
select 'PASS: operador, caixa inteira, saldo/avarias, autoria, auditoria, idempotência, reagrupar, transferência, baixa, base por local e bloqueio do inventário ativo. Rollback.' as resultado;
rollback;
