-- migration_v23: Notas comunes
--
-- Función nueva, aparte de las listas: una nota es un título + un texto
-- libre que se comparte con quien invites, igual que una lista pero sin
-- items/gastos/chat de por medio. Cualquier miembro (no solo quien la creó)
-- puede editar el contenido — a diferencia de una lista, donde cambiar el
-- nombre/color está restringido al creador.
--
-- Mismo patrón que lists/list_members (funciones is_note_* en vez de
-- is_list_*, RPC create_note_with_owner en vez de create_list_with_owner)
-- para reutilizar el mismo modelo de invitaciones ya probado.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  owner_id uuid not null references public.profiles (id) on delete cascade,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create table if not exists public.note_members (
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'invited' check (status in ('invited', 'accepted')),
  invited_identifier text not null default '',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  invited_by uuid references public.profiles (id) on delete set null,
  primary key (note_id, user_id)
);

alter table public.note_members enable row level security;

-- Funciones auxiliares SECURITY DEFINER (mismo motivo que is_list_member /
-- is_list_owner: evitar recursión infinita en las policies de note_members).
create or replace function public.is_note_member(p_note_id uuid, p_require_accepted boolean default true)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.note_members nm
    where nm.note_id = p_note_id
      and nm.user_id = auth.uid()
      and (not p_require_accepted or nm.status = 'accepted')
  );
$$;

create or replace function public.is_note_owner(p_note_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.notes n
    where n.id = p_note_id and n.owner_id = auth.uid()
  );
$$;

drop policy if exists "notes_select_member" on public.notes;
create policy "notes_select_member" on public.notes
  for select to authenticated
  using (public.is_note_member(id, false));

drop policy if exists "notes_insert_owner" on public.notes;
create policy "notes_insert_owner" on public.notes
  for insert to authenticated
  with check (owner_id = auth.uid());

-- A diferencia de "lists" (solo el creador cambia nombre/color), aquí
-- CUALQUIER miembro aceptado puede editar título/texto — así lo pediste.
drop policy if exists "notes_update_member" on public.notes;
create policy "notes_update_member" on public.notes
  for update to authenticated
  using (public.is_note_member(id, true));

drop policy if exists "notes_delete_owner" on public.notes;
create policy "notes_delete_owner" on public.notes
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "note_members_select" on public.note_members;
create policy "note_members_select" on public.note_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_note_member(note_id, true) or public.is_note_owner(note_id));

-- Invitar a nuevos miembros sigue siendo solo del creador (como en listas) —
-- lo que se abre a todos es la EDICIÓN del contenido, no la gestión de
-- quién está dentro.
drop policy if exists "note_members_insert_owner" on public.note_members;
create policy "note_members_insert_owner" on public.note_members
  for insert to authenticated
  with check (public.is_note_owner(note_id) or (user_id = auth.uid() and role = 'owner'));

drop policy if exists "note_members_update" on public.note_members;
create policy "note_members_update" on public.note_members
  for update to authenticated
  using (user_id = auth.uid() or public.is_note_owner(note_id));

drop policy if exists "note_members_delete" on public.note_members;
create policy "note_members_delete" on public.note_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_note_owner(note_id));

-- Crea la nota + la membresía del creador como owner en un único paso
-- atómico, derivando el propietario de auth.uid() en el servidor (mismo
-- patrón que create_list_with_owner, ver fix_create_list_rpc.sql).
create or replace function public.create_note_with_owner(p_title text)
returns public.notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note public.notes;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  insert into public.notes (title, owner_id)
  values (p_title, auth.uid())
  returning * into v_note;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.note_members (note_id, user_id, role, status, invited_identifier, responded_at)
  values (v_note.id, auth.uid(), 'owner', 'accepted', coalesce(v_email, ''), now());

  return v_note;
end;
$$;

grant execute on function public.create_note_with_owner(text) to authenticated;

-- Realtime: OJO — a diferencia de "contacts" (que causó el problema de
-- hace unos días), estas dos tablas SÍ se añaden a la publicación antes de
-- que el código del cliente se suscriba a ellas.
do $$
begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.note_members;
exception when duplicate_object then null;
end $$;

alter table public.notes replica identity full;
alter table public.note_members replica identity full;
