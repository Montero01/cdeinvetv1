begin;
-- Permissões exclusivas do Inventário: não modifica profiles nem os acessos do PDI.
create or replace function invd_private.manager() returns boolean language sql stable security definer set search_path='' as $$
select exists(
 select 1 from public.profiles p where p.id=(select auth.uid()) and (
  p.is_master is true
  or lower(p.role)in('gerente','gerencia','manager','diretor','diretoria','director','master','admin')
  or lower(regexp_replace(trim(coalesce(p.position,'')),'\s+',' ','g'))in('coordenador de estoque','coordenadora de estoque','coordenador(a) de estoque')
  or exists(select 1 from public.inventarydaily_table a where a.kind='access'and a.data->>'user_id'=p.id::text and a.data->>'enabled'='true'and a.data->>'permission'='manager')
 ))
$$;
revoke all on function invd_private.manager() from public,anon;
grant execute on function invd_private.manager() to authenticated;

do $$
declare target public.profiles;actor public.profiles;name text;old_data jsonb;new_data jsonb;rid uuid;
begin
perform pg_advisory_xact_lock(763126,1);
select *into actor from public.profiles where full_name='Gabriel M. Monteiro';
if actor.id is null then raise exception 'Perfil do diretor não encontrado para auditoria.';end if;
foreach name in array array['Rozana Seixas','Danielle S. Araújo','Kilze K. Krauss']loop
 if(select count(*)from public.profiles where full_name=name)<>1 then raise exception 'Confira a identidade do perfil antes da liberação: %.',name;end if;
 select *into target from public.profiles where full_name=name;
 select id,data into rid,old_data from public.inventarydaily_table where kind='access'and data->>'user_id'=target.id::text for update;
 new_data:=coalesce(old_data,'{}')||jsonb_build_object('user_id',target.id,'enabled',true,'permission','manager','scope','pilot','granted_at',now(),'granted_by',actor.id,'note','Autorizado pelo diretor para o período de testes do Inventário.');
 if rid is null then
  insert into public.inventarydaily_table(kind,data,created_by,created_by_name)values('access',new_data,actor.id,actor.full_name)returning id into rid;
 else
  update public.inventarydaily_table set data=new_data,updated_at=now()where id=rid;
 end if;
 insert into public.inventarydaily_table(kind,data,created_by,created_by_name)values('log',jsonb_build_object('request_id',gen_random_uuid(),'action','access_grant','payload',jsonb_build_object('user_id',target.id,'permission','manager','scope','pilot'),'result',jsonb_build_object('id',rid,'previous',old_data,'user_name',target.full_name)),actor.id,actor.full_name);
end loop;
insert into public.inventarydaily_table(kind,data,created_by,created_by_name)values('log',jsonb_build_object('request_id',gen_random_uuid(),'action','access_policy_update','payload',jsonb_build_object('position','Coordenador de Estoque','permission','manager','scope','inventory_only'),'result',jsonb_build_object('enabled',true)),actor.id,actor.full_name);
end$$;
commit;
