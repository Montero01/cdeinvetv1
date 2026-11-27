begin;
-- Apenas dados novos de QA em locais exclusivos. Rollback deixa a base do usuário intacta.
do $$declare v uuid;m uuid;begin
select id into v from public.profiles where full_name='Vitor Amaral';select id into m from public.profiles where is_master is true order by created_at limit 1;
perform set_config('qa.vitor',v::text,true);perform set_config('qa.manager',m::text,true);
end$$;
set local role authenticated;
do $$
declare a uuid;b uuid;c uuid;i uuid;j uuid;packed uuid;move_id uuid;r jsonb;p jsonb;req uuid:=gen_random_uuid();day date:=(now()at time zone'America/Manaus')::date-2;code text:='QA-REP-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);msg text;
begin
perform set_config('request.jwt.claim.sub',current_setting('qa.vitor'),true);
perform public.invd_command('catalog_add',gen_random_uuid(),'{"category":"warehouse","value":"QA-LOCAL-A"}');perform public.invd_command('catalog_add',gen_random_uuid(),'{"category":"warehouse","value":"QA-LOCAL-B"}');perform public.invd_command('catalog_add',gen_random_uuid(),'{"category":"warehouse","value":"QA-LOCAL-C"}');
p:='{"invoice":"QA-ROLLBACK","type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"sheets":10,"damaged":2,"warehouse":"QA-LOCAL-A"}';
r:=public.invd_command('box_create',gen_random_uuid(),jsonb_build_object('items',jsonb_build_array(p,p||'{"warehouse":"QA-LOCAL-B","sheets":20,"damaged":0}')));a:=(r->'ids'->>0)::uuid;b:=(r->'ids'->>1)::uuid;
begin perform public.invd_command('inventory_start',gen_random_uuid(),jsonb_build_object('date',day));raise exception 'Iniciou sem local';exception when raise_exception then if sqlerrm='Iniciou sem local'then raise;end if;end;
r:=public.invd_command('inventory_start',gen_random_uuid(),jsonb_build_object('date',day,'warehouses',jsonb_build_array('QA-LOCAL-A','qa-local-b','QA-LOCAL-A')));i:=(r->>'id')::uuid;
assert(select jsonb_array_length(data->'expected')from public.inventarydaily_table where id=i)=2,'escopo incluiu outros locais';assert(select jsonb_array_length(data->'warehouses')from public.inventarydaily_table where id=i)=2,'não deduplicou seleção';assert(select jsonb_array_length(data->'box_snapshot')from public.inventarydaily_table where id=i)=2,'sem snapshot';
-- Entrada em outro local é permitida; na origem em contagem continua bloqueada.
r:=public.invd_command('box_create',gen_random_uuid(),jsonb_build_object('items',jsonb_build_array(p||'{"warehouse":"QA-LOCAL-C","sheets":7,"damaged":0}')));c:=(r->'ids'->>0)::uuid;
begin perform public.invd_command('box_create',gen_random_uuid(),jsonb_build_object('items',jsonb_build_array(p)));raise exception 'Entrada no local ativo aceita';exception when raise_exception then if sqlerrm='Entrada no local ativo aceita'then raise;end if;end;
begin perform public.invd_command('inventory_scan',gen_random_uuid(),jsonb_build_object('inventory_id',i,'code',c));raise exception 'Escaneou caixa fora do local';exception when raise_exception then if sqlerrm='Escaneou caixa fora do local'then raise;end if;end;
perform public.invd_command('inventory_scan',gen_random_uuid(),jsonb_build_object('inventory_id',i,'code',b));
perform public.invd_command('inventory_decide',gen_random_uuid(),jsonb_build_object('inventory_id',i,'box_id',a,'outcome','opened'));
perform public.invd_command('inventory_loose',gen_random_uuid(),p||jsonb_build_object('inventory_id',i,'quantity',8,'damaged',1));
r:=public.invd_command('inventory_finish',gen_random_uuid(),jsonb_build_object('inventory_id',i,'confirmed_warehouses',jsonb_build_array('QA-LOCAL-A','QA-LOCAL-B')));assert(r->'summary'->>'total_sheets')::bigint=28,'resumo fora do escopo';
-- Reagrupar conserva quantidade física: 8 avulsas -> 5 avulsas + caixa com 3.
p:=p||jsonb_build_object('quantity',3,'damaged',0,'code',code,'reason','QA agrupamento');r:=public.invd_command('stock_repack',req,p);packed:=(r->>'box_id')::uuid;assert packed is not null,'sem nova caixa';assert public.invd_command('stock_repack',req,p)=r,'reenvio debitou novamente';
assert(select data->>'source'from public.inventarydaily_table where id=packed)='repack','sem origem';assert(select data->>'invoice'from public.inventarydaily_table where id=packed)='Sem NF identificada','NF indevida';
begin perform public.invd_command('stock_repack',gen_random_uuid(),p);raise exception 'Código repetido aceito';exception when raise_exception then if sqlerrm='Código repetido aceito'then raise;end if;end;
begin perform public.invd_command('stock_repack',gen_random_uuid(),p||'{"quantity":99,"code":"QA-INSUFICIENTE"}');raise exception 'Saldo insuficiente aceito';exception when raise_exception then if sqlerrm='Saldo insuficiente aceito'then raise;end if;end;
perform public.invd_command('stock_transfer',gen_random_uuid(),p||'{"source":"loose","quantity":2,"damaged":1,"to_warehouse":"QA-LOCAL-C","reason":"QA transferência"}');
perform public.invd_command('stock_writeoff',gen_random_uuid(),p||'{"source":"loose","warehouse":"QA-LOCAL-C","quantity":1,"damaged":1,"reason":"QA quebra confirmada"}');
perform public.invd_command('stock_transfer',gen_random_uuid(),jsonb_build_object('source','box','box_id',packed,'quantity',3,'to_warehouse','QA-LOCAL-B','reason','QA mudança de local'));
req:=gen_random_uuid();p:=jsonb_build_object('source','box','box_id',b,'quantity',5,'damaged',0,'reason','QA saída manual');r:=public.invd_command('stock_writeoff',req,p);assert public.invd_command('stock_writeoff',req,p)=r,'reenvio da baixa';assert(select(data->>'sheets')::bigint from public.inventarydaily_table where id=b)=15,'saldo da caixa incorreto';
assert(select(data->>'received_sheets')::bigint from public.inventarydaily_table where id=b)=20,'perdeu quantidade original';
assert(select data->>'received_warehouse'from public.inventarydaily_table where id=packed)='QA-LOCAL-A','origem do agrupamento mudou';assert(select data->>'warehouse'from public.inventarydaily_table where id=packed)='QA-LOCAL-B','não transferiu';
assert(select data->'summary'->>'total_sheets'from public.inventarydaily_table where id=i)='28','reescreveu resumo histórico';
assert(select(data->'box_snapshot'->1->'data'->>'sheets')::bigint in(10,20)from public.inventarydaily_table where id=i),'snapshot histórico modificado';
-- Outra contagem no mesmo dia, em local disjunto, é válida.
begin perform public.invd_command('inventory_start',gen_random_uuid(),jsonb_build_object('date',day,'warehouses',jsonb_build_array('QA-LOCAL-B')));raise exception 'Repetiu local no dia';exception when raise_exception then if sqlerrm='Repetiu local no dia'then raise;end if;end;
r:=public.invd_command('inventory_start',gen_random_uuid(),jsonb_build_object('date',day,'warehouses',jsonb_build_array('QA-LOCAL-C')));j:=(r->>'id')::uuid;
assert(select jsonb_array_length(data->'expected')from public.inventarydaily_table where id=j)=1,'escopo C errado';
begin perform public.invd_command('stock_transfer',gen_random_uuid(),jsonb_build_object('source','box','box_id',packed,'quantity',3,'to_warehouse','QA-LOCAL-C','reason','QA destino ativo'));raise exception 'Movimentou para local ativo';exception when raise_exception then if sqlerrm='Movimentou para local ativo'then raise;end if;end;
perform public.invd_command('stock_writeoff',gen_random_uuid(),jsonb_build_object('source','loose','type','Comum','color','Incolor','thickness_mm',6,'width_mm',2000,'height_mm',1000,'warehouse','QA-LOCAL-A','quantity',1,'damaged',0,'reason','QA outro local'));
perform public.invd_command('inventory_scan',gen_random_uuid(),jsonb_build_object('inventory_id',j,'code',c));
perform public.invd_command('inventory_loose',gen_random_uuid(),jsonb_build_object('inventory_id',j,'type','Comum','color','Incolor','thickness_mm',6,'width_mm',2000,'height_mm',1000,'warehouse','QA-LOCAL-C','quantity',1,'damaged',0));
perform public.invd_command('inventory_finish',gen_random_uuid(),jsonb_build_object('inventory_id',j,'confirmed_warehouses',jsonb_build_array('QA-LOCAL-C')));
perform public.invd_command('stock_writeoff',gen_random_uuid(),jsonb_build_object('source','box','box_id',b,'quantity',15,'damaged',0,'reason','QA baixa integral'));
assert(select data->>'status'from public.inventarydaily_table where id=b)='depleted','baixa integral não encerrou saldo';
assert(select(data->>'sheets')::bigint from public.inventarydaily_table where id=b)=0,'baixa integral deixou saldo';
perform set_config('qa.inventory',i::text,true);perform set_config('qa.packed',packed::text,true);perform set_config('qa.b',b::text,true);
-- Proteção dos históricos após movimentações, mesmo para gerência.
perform set_config('request.jwt.claim.sub',current_setting('qa.manager'),true);
perform public.invd_command('inventory_delete',gen_random_uuid(),jsonb_build_object('id',j,'reason','QA excluir local independente'));
assert not exists(select 1 from public.inventarydaily_table where id=j),'não excluiu contagem de local independente';
begin perform public.invd_command('inventory_delete',gen_random_uuid(),jsonb_build_object('id',i,'reason','QA apagar base'));raise exception 'Excluiu base de movimentações';exception when raise_exception then if sqlerrm='Excluiu base de movimentações'then raise;end if;end;
begin perform public.invd_command('box_delete',gen_random_uuid(),jsonb_build_object('id',packed,'reason','QA apagar agrupamento'));raise exception 'Excluiu caixa vinculada';exception when raise_exception then if sqlerrm='Excluiu caixa vinculada'then raise;end if;end;
end$$;
reset role;
do $$declare p jsonb:='{"type":"Comum","color":"Incolor","thickness_mm":6,"width_mm":2000,"height_mm":1000,"warehouse":"QA-LOCAL-A"}';b jsonb;begin
b:=invd_private.loose_balance(p);assert(b->>'quantity')::bigint=2 and(b->>'damaged')::bigint=0,'saldo A incorreto';
b:=invd_private.loose_balance(p||'{"warehouse":"QA-LOCAL-C"}');assert(b->>'quantity')::bigint=1 and(b->>'damaged')::bigint=0,'base C duplicou transferências anteriores';
assert not exists(select 1 from public.inventarydaily_table where kind='box'and data->>'code'='QA-INSUFICIENTE'),'caixa parcial em falha';
assert exists(select 1 from public.inventarydaily_table where kind='log'and data->>'action'='stock_repack'and data->'result'->>'box_id'=current_setting('qa.packed')),'sem auditoria';
end$$;
select 'PASS: locais selecionados/dias disjuntos, escaneamento restrito, entradas em outros locais, snapshot imutável, agrupamento neutro, transferências, baixas, saldos/avarias, idempotência, proteção de bases e última contagem por local. Rollback.'as resultado;
rollback;
