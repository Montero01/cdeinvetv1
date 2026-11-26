begin;
create or replace function invd_private.catalog_text(p text)returns text language sql immutable set search_path=''as $$
select btrim(regexp_replace(translate(replace(replace(normalize(coalesce(p,''),NFC),chr(8203),''),chr(65279),''),U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',repeat(' ',19)),'[[:space:]]+',' ','g'))
$$;

reindex index public.invd_catalog_normalized;
commit;
