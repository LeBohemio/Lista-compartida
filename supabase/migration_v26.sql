-- migration_v26: bloquear contactos
--
-- Añade la posibilidad de bloquear a un contacto: mientras dura el
-- bloqueo, ninguna de las dos personas puede mandarle a la otra mensajes
-- directos nuevos ni invitarla a listas o notas nuevas. Lo que ya existía
-- antes del bloqueo (listas compartidas, historial de chat) se queda
-- exactamente igual — bloquear no borra ni oculta nada de lo anterior.
--
-- "blocked_at" vive en TU fila de contacts (igual que pinned/muted): solo
-- tú puedes ponerlo o quitarlo, y es tuyo, no compartido con la otra
-- persona. Aun así, el bloqueo se comprueba EN LAS DOS DIRECCIONES (mira la
-- función contacts_blocked de abajo) para que tampoco puedas escribir por
-- error a alguien que tú mismo/a has bloqueado.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.contacts add column if not exists blocked_at timestamptz;

-- Mismo patrón que la migración v18: la política de UPDATE por sí sola no
-- puede impedir tocar "contact_user_id", así que el permiso se concede
-- columna a columna. Se repite el grant completo (no solo blocked_at)
-- porque GRANT no es acumulativo entre columnas si se especifican en
-- llamadas distintas con nombres de columna explícitos.
revoke update on public.contacts from authenticated;
grant update (pinned, muted, last_read_message_at, blocked_at) on public.contacts to authenticated;

-- ----------------------------------------------------------------------------
-- ¿Hay un bloqueo entre estas dos personas, en cualquier dirección? Se usa
-- desde las políticas de mensajes/invitaciones de abajo. security definer
-- porque esas políticas necesitan comprobar la fila de "contacts" de LA
-- OTRA persona, no la propia (RLS normal solo deja ver tus propias filas).
-- ----------------------------------------------------------------------------
create or replace function public.contacts_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contacts
    where (user_id = p_a and contact_user_id = p_b and blocked_at is not null)
       or (user_id = p_b and contact_user_id = p_a and blocked_at is not null)
  )
$$;

grant execute on function public.contacts_blocked(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Mensajes directos: añade la comprobación de bloqueo a la política que ya
-- existía (ver migration_v18.sql) — el resto de condiciones no cambia.
-- ----------------------------------------------------------------------------
drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (
        list_id is not null and to_user_id is null
        and public.is_list_member(list_id, true)
        and not public.is_list_archived(list_id)
      )
      or (
        list_id is null and to_user_id is not null and to_user_id <> auth.uid()
        and exists (
          select 1 from public.contacts
          where user_id = auth.uid() and contact_user_id = messages.to_user_id
        )
        and not public.contacts_blocked(auth.uid(), messages.to_user_id)
      )
    )
  );

-- ----------------------------------------------------------------------------
-- Invitar a una lista: añade la comprobación de bloqueo a la política que
-- ya existía (ver migration_v24.sql) — si hay un bloqueo entre quien invita
-- y a quien se invita, la fila no se puede insertar. invited_by puede ser
-- null en invitaciones muy antiguas (de antes de guardarlo) o al crear tu
-- propia lista, así que ahí no hay nadie a quien comprobar.
-- ----------------------------------------------------------------------------
drop policy if exists "list_members_insert_member" on public.list_members;
create policy "list_members_insert_member" on public.list_members
  for insert to authenticated
  with check (
    (
      public.is_list_owner(list_id)
      or (user_id = auth.uid() and role = 'owner')
      or (role = 'member' and public.is_list_member(list_id, true))
    )
    and (invited_by is null or not public.contacts_blocked(user_id, invited_by))
  );

-- ----------------------------------------------------------------------------
-- Invitar a una nota (Notas comunes): misma idea, sobre la política de
-- migration_v23.sql.
-- ----------------------------------------------------------------------------
drop policy if exists "note_members_insert_owner" on public.note_members;
create policy "note_members_insert_owner" on public.note_members
  for insert to authenticated
  with check (
    (public.is_note_owner(note_id) or (user_id = auth.uid() and role = 'owner'))
    and (invited_by is null or not public.contacts_blocked(user_id, invited_by))
  );

-- ----------------------------------------------------------------------------
-- Petición de contacto directa (ver migration_v17.sql): si alguna de las
-- dos personas ya tenía a la otra bloqueada de antes (por ejemplo, si
-- fuisteis contactos, te bloqueé, me borraste de tus contactos y ahora me
-- mandas una petición nueva), no se puede mandar.
-- ----------------------------------------------------------------------------
create or replace function public.send_contact_request(p_to_user_id uuid)
returns public.contact_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.contact_requests;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if p_to_user_id = auth.uid() then
    raise exception 'SELF_REQUEST';
  end if;
  if exists (
    select 1 from public.contacts
    where user_id = auth.uid() and contact_user_id = p_to_user_id
  ) then
    raise exception 'ALREADY_CONTACT';
  end if;
  if public.contacts_blocked(auth.uid(), p_to_user_id) then
    raise exception 'BLOCKED';
  end if;

  insert into public.contact_requests (from_user_id, to_user_id)
  values (auth.uid(), p_to_user_id)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.send_contact_request(uuid) to authenticated;
