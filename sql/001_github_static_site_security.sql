-- Arch Family static GitHub Pages + separate Discord bot
-- Review and run in Supabase SQL Editor AFTER taking a database backup.
-- Browser receives only the publishable key. Bot uses a server-side service role key.

begin;

alter table public.family_members add column if not exists joined_at timestamptz;
alter table public.family_members add column if not exists is_archived boolean not null default false;
update public.family_members set is_active=false where is_archived is true and is_active is true;

update public.family_relations set relation_type='other' where relation_type='connection';
update public.family_relations set relation_type='other' where relation_type not in ('partner','parent_child','sibling','allied_family','other');
do $$ begin
  if exists (select 1 from pg_constraint where conrelid='public.family_relations'::regclass and conname='family_relations_type_check') then
    alter table public.family_relations drop constraint family_relations_type_check;
  end if;
end $$;
alter table public.family_relations alter column relation_type set default 'other';
alter table public.family_relations add constraint family_relations_type_check check (relation_type in ('partner','parent_child','sibling','allied_family','other'));
create index if not exists family_relations_type_idx on public.family_relations(relation_type);
create index if not exists board_layout_z_idx on public.board_layout(z_index);
insert into public.board_settings(id,zoom,background_key,settings) values(1,0.9,'forest-sakura','{}'::jsonb) on conflict(id) do nothing;

-- This view intentionally uses the owner context (security_barrier, no user-controlled filters)
-- and exposes only active members. The settings JSON controls which public fields are returned.
-- Base family_members columns remain revoked except id/is_active; browser cannot query bios or Discord IDs directly.
create or replace view public.site_family_members with (security_barrier = true) as
select
  m.id,
  m.display_name,
  case when coalesce(s.settings->'publicAvatars', 'true'::jsonb) = 'true'::jsonb then m.avatar_url else null end as avatar_url,
  case when coalesce(s.settings->'publicRoleNames', 'true'::jsonb) = 'true'::jsonb then m.primary_role_name else null end as primary_role_name,
  m.member_kind,
  case when coalesce(s.settings->'publicProfileDescription', 'true'::jsonb) = 'true'::jsonb then m.bio else null end as bio,
  m.is_active,
  m.created_at,
  case when coalesce(s.settings->'showJoined', 'false'::jsonb) = 'true'::jsonb then m.joined_at else null end as joined_at
from public.family_members m
join public.board_settings s on s.id = 1
where m.is_active is true;

create table if not exists public.integration_status (
  service_name text primary key,
  state text not null default 'offline',
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.integration_status enable row level security;

-- Rebuild explicit policies; no destructive row deletes.
drop policy if exists "Public can read active family roster" on public.family_members;
drop policy if exists "Arch Family public active members" on public.family_members;
drop policy if exists "Arch Family admin manages members" on public.family_members;
drop policy if exists "Arch Family public layout for active members" on public.board_layout;
drop policy if exists "Arch Family admin manages layout" on public.board_layout;
drop policy if exists "Arch Family public relations for active members" on public.family_relations;
drop policy if exists "Arch Family admin manages relations" on public.family_relations;
drop policy if exists "Arch Family public settings read" on public.board_settings;
drop policy if exists "Arch Family admin manages settings" on public.board_settings;
drop policy if exists "Arch Family admin manages role mapping" on public.role_mapping;
drop policy if exists "Arch Family admin reads integration status" on public.integration_status;

alter table public.family_members enable row level security;
alter table public.family_relations enable row level security;
alter table public.board_layout enable row level security;
alter table public.board_settings enable row level security;
alter table public.role_mapping enable row level security;

-- Remove broad grants, then grant only the fields the public website is allowed to see.
revoke all privileges on table public.family_members from public, anon, authenticated;
revoke all privileges on table public.site_family_members from public, anon, authenticated;
revoke all privileges on table public.family_relations from public, anon, authenticated;
revoke all privileges on table public.board_layout from public, anon, authenticated;
revoke all privileges on table public.board_settings from public, anon, authenticated;
revoke all privileges on table public.role_mapping from public, anon, authenticated;
revoke all privileges on table public.integration_status from public, anon, authenticated;

grant select (id, is_active) on table public.family_members to anon, authenticated;
grant select on table public.family_relations to anon, authenticated;
grant select on table public.site_family_members to anon, authenticated;
grant select on table public.board_layout to anon, authenticated;
grant select (id, zoom, background_key, settings, updated_at) on table public.board_settings to anon, authenticated;
grant select, insert, update, delete on table public.board_layout to authenticated;
grant insert, update, delete on table public.family_relations to authenticated;
grant insert, update, delete on table public.board_settings to authenticated;
grant select, insert, update, delete on table public.role_mapping to authenticated;
grant select on table public.integration_status to authenticated;

grant select, insert, update, delete on table public.family_members to service_role;
grant select, insert, update, delete on table public.family_relations to service_role;
grant select, insert, update, delete on table public.board_layout to service_role;
grant select, insert, update, delete on table public.board_settings to service_role;
grant select, insert, update, delete on table public.role_mapping to service_role;
grant select, insert, update, delete on table public.integration_status to service_role;

-- Public roster: active rows only. Private Discord columns have no browser SELECT grant.
create policy "Arch Family public active members" on public.family_members for select to anon, authenticated using (is_active is true);
create policy "Arch Family admin manages members" on public.family_members for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Arch Family public layout for active members" on public.board_layout for select to anon, authenticated
  using (exists (select 1 from public.family_members m where m.id=board_layout.member_id and m.is_active is true));
create policy "Arch Family admin manages layout" on public.board_layout for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Arch Family public relations for active members" on public.family_relations for select to anon, authenticated
  using (
    exists (select 1 from public.family_members a where a.id=family_relations.from_member_id and a.is_active is true)
    and exists (select 1 from public.family_members b where b.id=family_relations.to_member_id and b.is_active is true)
  );
create policy "Arch Family admin manages relations" on public.family_relations for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Arch Family public settings read" on public.board_settings for select to anon, authenticated using (id=1);
create policy "Arch Family admin manages settings" on public.board_settings for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Arch Family admin manages role mapping" on public.role_mapping for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Arch Family admin reads integration status" on public.integration_status for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- No client can change profiles. Those writes are reserved for Discord's server-side service_role.
commit;
notify pgrst, 'reload schema';
