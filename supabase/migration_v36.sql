-- migration_v36: cerrar el listado completo de perfiles
--
-- Hasta ahora "profiles_select_authenticated" dejaba leer CUALQUIER perfil
-- (incluido el email y el teléfono) a cualquier persona con sesión iniciada,
-- sin ninguna relación con ella de por medio — bastaba con hacer una
-- consulta directa a la API de Supabase (sin pasar por la app) pidiendo
-- "todos los perfiles" para descargarte el email y el teléfono de todo el
-- mundo. Esta migración lo cierra: cada quien solo puede leer su propio
-- perfil y el de la gente con la que ya tiene alguna relación real dentro de
-- la app (una lista o nota en común, un contacto, o una petición de
-- contacto pendiente entre los dos).
--
-- Efecto secundario menor, aceptado a propósito: si alguien sale de una
-- lista/nota después de haber creado un ítem, un gasto o un reparto, quien
-- lo mire después ya no verá su nombre como autor (la relación que daba
-- acceso a ese perfil ya no existe) — no rompe nada, solo deja de mostrar
-- ese nombre.
--
-- La búsqueda por email/teléfono al invitar o añadir un contacto (que antes
-- necesitaba poder leer cualquier perfil para encontrar la coincidencia)
-- pasa a una función aparte, find_profile_by_contact, que compara con
-- permisos elevados y solo devuelve id/username/avatar_url de UNA
-- coincidencia exacta — no una lista de perfiles, así que no sirve para
-- enumerar a nadie.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

-- ----------------------------------------------------------------------------
-- 1. Funciones auxiliares SECURITY DEFINER (mismo patrón que is_list_member
--    / is_note_member): ¿comparte auth.uid() alguna lista/nota con
--    p_target, estando auth.uid() ya aceptado en ella o siendo su dueño/a?
-- ----------------------------------------------------------------------------
create or replace function public.shares_list_with(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.list_members lm_target
    join public.list_members lm_viewer on lm_viewer.list_id = lm_target.list_id
    where lm_target.user_id = p_target
      and lm_viewer.user_id = auth.uid()
      and (
        lm_viewer.status = 'accepted'
        or exists (
          select 1 from public.lists l where l.id = lm_viewer.list_id and l.owner_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.shares_note_with(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.note_members nm_target
    join public.note_members nm_viewer on nm_viewer.note_id = nm_target.note_id
    where nm_target.user_id = p_target
      and nm_viewer.user_id = auth.uid()
      and (
        nm_viewer.status = 'accepted'
        or exists (
          select 1 from public.notes n where n.id = nm_viewer.note_id and n.owner_id = auth.uid()
        )
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. Sustituye la política abierta por una que exige alguna relación real.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_authenticated" on public.profiles;

create policy "profiles_select_related" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or public.shares_list_with(id)
    or public.shares_note_with(id)
    or exists (
      select 1 from public.contacts c where c.user_id = auth.uid() and c.contact_user_id = id
    )
    or exists (
      select 1 from public.contact_requests cr
      where cr.status = 'pending'
        and (
          (cr.from_user_id = auth.uid() and cr.to_user_id = id)
          or (cr.to_user_id = auth.uid() and cr.from_user_id = id)
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Búsqueda exacta por email o teléfono para invitar / añadir contacto,
--    sin tener que abrir la lectura de toda la tabla. Devuelve como mucho
--    una fila, y solo los tres campos que la app necesita para mostrarla
--    (nunca el email/teléfono de quien se encuentra).
-- ----------------------------------------------------------------------------
create or replace function public.find_profile_by_contact(p_email text default null, p_phone text default null)
returns table (id uuid, username text, avatar_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  return query
    select p.id, p.username, p.avatar_url
    from public.profiles p
    where (p_email is not null and lower(p.email) = lower(p_email))
       or (p_phone is not null and p.phone = p_phone)
    limit 1;
end;
$$;

grant execute on function public.find_profile_by_contact(text, text) to authenticated;
