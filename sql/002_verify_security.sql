-- Run after 001_github_static_site_security.sql.
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public'
  and tablename in ('family_members','family_relations','board_layout','board_settings','role_mapping','integration_status')
order by tablename, policyname;

select table_name, grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema='public' and table_name='family_members'
  and grantee in ('anon','authenticated')
order by grantee, column_name, privilege_type;

select service_name,state,message,updated_at from public.integration_status;
