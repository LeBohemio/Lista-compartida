-- migration_v16: contactos
--
-- Sustituye la búsqueda global por nombre de usuario (ambigua si dos
-- personas se registran con el mismo nombre, y la causa de los fallos al
-- invitar) por un sistema de contactos: la primera vez que invitas a
-- alguien tiene que ser por email; en cuanto esa persona ACEPTA la
-- invitación (no antes), os hacéis contactos el uno del otro
-- automáticamente, y a partir de ahí puedes añadirla directamente a otras
-- listas sin volver a escribir su email. Si más adelante uno borra al otro
-- de sus contactos, se rompe para los dos — hace falta una invitación nueva
-- para volver a estar en contacto.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

-- ----------------------------------------------------------------------------
-- 1. Quién invitó a quién — hace falta guardarlo para saber con quién te
--    haces contacto en cuanto acepte (antes no se guardaba en ningún sitio).
-- ----------------------------------------------------------------------------
alter table public.list_members
  add column if not exists invited_by uuid references public.profiles (id) on delete set null;

-- No permitimos que se pueda mandar como invited_by el id de otra persona
-- distinta a quien hace la petición (evita que alguien pueda hacerse pasar
-- por otro para acabar como su contacto).
drop policy if exists "list_members_insert_owner" on public.list_members;
create policy "list_members_insert_owner" on public.list_members
  for insert to authenticated
  with check (
    (public.is_list_owner(list_id) and (invited_by is null or invited_by = auth.uid()))
    or (user_id = auth.uid() and role = 'owner')
  );

-- ----------------------------------------------------------------------------
-- 2. CONTACTS — una fila por cada dirección de la relación (tu fila y la
--    suya son independientes), para que borrar sea sencillo y para que cada
--    quien solo pueda ver/tocar sus propias filas.
-- ----------------------------------------------------------------------------
create table if not exists public.contacts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  contact_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_user_id),
  constraint contacts_not_self check (user_id <> contact_user_id)
);

alter table public.contacts enable row level security;

-- Solo lectura de tus propias filas — todas las escrituras (crear al
-- aceptar una invitación, borrar mutuamente) pasan por funciones de abajo
-- que se ejecutan con permisos elevados, así que no hace falta (ni
-- conviene) dar permiso de insert/delete directo aquí.
drop policy if exists "contacts_select_own" on public.contacts;
create policy "contacts_select_own" on public.contacts
  for select to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. Al aceptar una invitación (status pasa de 'invited' a 'accepted'), si
--    sabemos quién invitó, se crean las dos filas de contacto (una por cada
--    dirección) automáticamente. "on conflict do nothing" por si la persona
--    ya era tu contacto de antes (por ejemplo, si os habíais borrado y
--    ahora os volvéis a invitar) y por si el trigger se disparase dos veces.
-- ----------------------------------------------------------------------------
create or replace function public.handle_list_invite_accepted()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status = 'invited' and new.invited_by is not null then
    insert into public.contacts (user_id, contact_user_id) values
      (new.user_id, new.invited_by),
      (new.invited_by, new.user_id)
    on conflict (user_id, contact_user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_list_invite_accepted on public.list_members;
create trigger on_list_invite_accepted
  after update on public.list_members
  for each row execute function public.handle_list_invite_accepted();

-- ----------------------------------------------------------------------------
-- 4. Borrar un contacto es mutuo (ver el comentario de arriba del todo) —
--    esta función borra las dos filas a la vez. Solo puedes usarla para
--    relaciones en las que tú mismo/a estás implicado/a (auth.uid() tiene
--    que ser una de las dos personas), así que no sirve para tocar
--    contactos ajenos.
-- ----------------------------------------------------------------------------
create or replace function public.remove_contact(p_contact_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  delete from public.contacts
  where (user_id = auth.uid() and contact_user_id = p_contact_user_id)
     or (user_id = p_contact_user_id and contact_user_id = auth.uid());
end;
$$;

grant execute on function public.remove_contact(uuid) to authenticated;
