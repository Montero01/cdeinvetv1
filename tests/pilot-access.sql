begin;
-- Somente leitura e tentativas inválidas; nenhuma conta ou dado operacional é alterado.
set local role authenticated;
do $$
declare p public.profiles;c jsonb;uid uuid;target text;
begin
foreach target in array array['Jackson F. Maia','Rozana Seixas','Danielle S. Araújo','Kilze K. Krauss']loop
 select *into p from public.profiles where full_name=target;
 assert p.id is not null,'Perfil de teste não encontrado';
 perform set_config('request.jwt.claim.sub',p.id::text,true);
 c:=public.invd_context();assert(c->>'allowed')::boolean,'Acesso bloqueado';assert(c->>'can_manage')::boolean,'Gerência do inventário ausente';
 assert(c->'profile'->>'id')::uuid=p.id,'Contexto retornou outra pessoa';
 -- A validação de conteúdo deve ser alcançada, sem falha de autorização e sem salvar nada.
 begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),'{}');raise exception 'Regra vazia foi salva';exception when raise_exception then if sqlerrm<>'Informe o tipo e a cor do vidro.'then raise;end if;end;
 begin perform public.invd_command('box_delete',gen_random_uuid(),jsonb_build_object('id',gen_random_uuid(),'reason','QA: autorização de exclusão'));raise exception 'Registro inexistente excluído';exception when raise_exception then if sqlerrm<>'Registro não encontrado. Atualize os dados antes de tentar novamente.'then raise;end if;end;
 assert exists(select 1 from public.inventarydaily_table where kind='log'and data->>'action'='access_policy_update'),'Log gerencial não disponível';
 assert not exists(select 1 from public.inventarydaily_table where kind='access'),'ACL privada exposta';
 if target='Jackson F. Maia'then assert p.role='supervisor' and p.position='Coordenador de Estoque','Cargo PDI do Jackson alterado';end if;
 if target='Rozana Seixas'then assert p.role='employee' and p.position='Contador(a)','Cargo PDI da Rozana alterado';end if;
end loop;
select id into uid from public.profiles where full_name='Vitor Amaral';perform set_config('request.jwt.claim.sub',uid::text,true);c:=public.invd_context();assert(c->>'allowed')::boolean and not(c->>'can_manage')::boolean,'Vitor perdeu acesso operacional ou foi promovido';
begin perform public.invd_command('reorder_rule_save',gen_random_uuid(),'{}');raise exception 'Vitor gerencia regras';exception when insufficient_privilege then null;end;
begin perform public.invd_command('box_delete',gen_random_uuid(),jsonb_build_object('id',gen_random_uuid(),'reason','QA'));raise exception 'Vitor exclui caixas';exception when insufficient_privilege then null;end;
select id into uid from public.profiles where role='employee'and full_name not in('Vitor Amaral','Rozana Seixas')and is_master is not true and coalesce(position,'')not ilike'%coordenador%estoque%' limit 1;
assert uid is not null,'Sem perfil de controle negativo';perform set_config('request.jwt.claim.sub',uid::text,true);c:=public.invd_context();assert not(c->>'allowed')::boolean,'Colaborador não autorizado liberado';
begin perform public.invd_list();raise exception 'Leitura indevida';exception when insufficient_privilege then null;end;
end$$;
reset role;
select has_function_privilege('anon','public.invd_context()','execute')=false as anon_bloqueado,
has_table_privilege('authenticated','public.inventarydaily_table','update')=false as escrita_direta_bloqueada;
select 'PASS: quatro acessos gerenciais no Inventário, cargos PDI preservados, Vitor operacional, colaborador não autorizado bloqueado, ACL privada e validação no servidor.'as resultado;
rollback;
