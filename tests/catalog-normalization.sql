begin;
-- Fixtures isoladas; teste real de importação com rollback, sem alterar cadastros existentes.
do $$declare uid uuid;begin
select id into uid from public.profiles where full_name='Vitor Amaral';perform set_config('cde.qa.vitor',uid::text,true);
insert into public.inventarydaily_table(kind,data)values('catalog',jsonb_build_object('category','warehouse','value','QA  Galpão'||chr(160)||'Teste'));
assert invd_private.catalog_text('Habitat'||chr(133)||'Neutro')='Habitat Neutro','NEL não normalizado';
assert invd_private.catalog_key('color','Fumê')<>invd_private.catalog_key('color','Fume'),'acentos diferentes foram mesclados';
end$$;
set local role authenticated;
do $$
declare p jsonb;r jsonb;a uuid;req uuid:=gen_random_uuid();n bigint;inv uuid;msg text;catid uuid;
begin
perform set_config('request.jwt.claim.sub',current_setting('cde.qa.vitor'),true);
-- Usa o cadastro REAL Habitat[dois espaços]Neutro. Não adiciona uma versão duplicada.
select id into catid from public.inventarydaily_table where kind='catalog'and data->>'category'='type'and data->>'value'='Habitat  Neutro';assert catid is not null,'Fixture real da regressão não existe';
r:=public.invd_command('catalog_add',gen_random_uuid(),'{"category":"type","value":"Habitat Neutro"}');assert(r->>'id')::uuid=catid,'duplicou cadastro equivalente';
p:=jsonb_build_object('invoice','QA-ROLLBACK-ESPAÇOS','type','Habitat Neutro','color','Fume'||chr(770),'thickness_mm',2.0,'width_mm',3210,'height_mm',2250,'sheets',10,'damaged',1,'warehouse','QA Galpão Teste');
r:=public.invd_command('box_create',req,jsonb_build_object('items',jsonb_build_array(p,p||jsonb_build_object('type','  HABITAT'||chr(160)||'   NEUTRO'||chr(8203),'warehouse','QA'||chr(8239)||'Galpão Teste'),p||jsonb_build_object('type',E'\tHabitat\tNeutro\n','color','FUMÊ'))));
assert jsonb_array_length(r->'ids')=3,'não importou lote';
a:=(r->'ids'->>0)::uuid;
assert(select data->>'type'from public.inventarydaily_table where id=a)='Habitat Neutro','tipo não canônico';
assert(select data->>'color'from public.inventarydaily_table where id=a)='Fumê','cor não canônica NFC';
assert(select(data->>'thickness_mm')::numeric from public.inventarydaily_table where id=a)=2,'espessura numérica';
assert(select data->>'warehouse'from public.inventarydaily_table where id=a)='QA Galpão Teste','galpão não canônico';
assert public.invd_command('box_create',req,jsonb_build_object('items',jsonb_build_array(p,p||jsonb_build_object('type','  HABITAT'||chr(160)||'   NEUTRO'||chr(8203),'warehouse','QA'||chr(8239)||'Galpão Teste'),p||jsonb_build_object('type',E'\tHabitat\tNeutro\n','color','FUMÊ'))))=r,'retry não idempotente';
select count(*)into n from public.inventarydaily_table where kind='box';
begin perform public.invd_command('box_create',gen_random_uuid(),jsonb_build_object('items',jsonb_build_array(p,p||jsonb_build_object('type','QA-TIPO-INEXISTENTE-'||gen_random_uuid()))));raise exception 'Lote inválido foi aceito';exception when raise_exception then get stacked diagnostics msg=message_text;if position('Registro 2: Tipo de vidro'in msg)=0 then raise;end if;end;
assert(select count(*)from public.inventarydaily_table where kind='box')=n,'salvou parcialmente';
assert(select data->>'value'from public.inventarydaily_table where id=catid)='Habitat  Neutro','alterou cadastro histórico';
end$$;
reset role;
-- Snapshot antigo com espaços preservados: a seleção canônica de avulsos ainda deve funcionar.
do $$declare sid uuid:=gen_random_uuid();begin
insert into public.inventarydaily_table(id,kind,data)values(sid,'inventory',jsonb_build_object('status','active','expected','[]'::jsonb,'warehouses',jsonb_build_array('QA  Galpão'||chr(160)||'Teste')));perform set_config('cde.qa.inventory',sid::text,true);
end$$;
set local role authenticated;
do $$declare r jsonb;begin
perform set_config('request.jwt.claim.sub',current_setting('cde.qa.vitor'),true);
r:=public.invd_command('inventory_loose',gen_random_uuid(),jsonb_build_object('inventory_id',current_setting('cde.qa.inventory'),'type','Habitat  Neutro','color','Fumê','thickness_mm',2,'width_mm',3210,'height_mm',2250,'quantity',4,'damaged',0,'warehouse','QA Galpão Teste'));
assert(select data->>'warehouse'from public.inventarydaily_table where id=(r->>'id')::uuid)='QA Galpão Teste','snapshot legado recusou galpão canônico';
end$$;
reset role;
select 'PASS: Habitat Neutro existente com dois espaços, NBSP/NEL/tab/zero-width/NFC, cor/galpão/espessura, cadastro sem duplicar, lote atômico, erro PT com registro, idempotência e snapshot legado. Rollback.'as resultado;
rollback;
