-- migration_v17: peticiones de contacto directas (sin pasar por una lista)
--
-- Hasta ahora la única forma de hacerse contacto de alguien era invitarla a
-- una lista y que aceptase (ver migration_v16.sql). Esto añade un segundo
-- camino, independiente de las listas: mandar una petición de contacto
-- directa desde la pantalla de Contactos, que la otra persona puede
-- aceptar o rechazar — igual que las invitaciones a listas, pero sin lista
-- de por medio.
--
-- La lógica de "hacerse contactos mutuamente" que ya existía dentro del
-- trigger de invitaciones a listas se saca a una función aparte
-- (create_mutual_contact) para no duplicarla: la usan tanto el trigger de
-- migration_v16.sql como la nueva función de aceptar petición de abajo.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

-- ----------------------------------------------------------------------------
-- 1. Función compartida: crea las dos filas de contacto (una por cada
--    dirección). Antes esto vivía solo dentro de handle_list_invite_accepted;
--    ahora la usan también las peticiones de contacto directas.
-- ----------------------------------------------------------------------------
create or replace function public.create_mutual_contact(p_user_a uuid, p_user_b uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.contacts (user_id, contact_user_id) values
    (p_user_a, p_user_b),
    (p_user_b, p_user_a)
  on conflict (user_id, contact_user_id) do nothing;
end;
$$;

create or replace function public.handle_list_invite_accepted()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status = 'invited' and new.invited_by is not null then
    perform public.create_mutual_contact(new.user_id, new.invited_by);
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. CONTACT_REQUESTS — una petición pendiente de que la otra persona la
--    acepte o la rechace. Solo puede haber una petición pendiente a la vez
--    entre dos personas, sin importar quién la mandó (índice único parcial
--    de abajo) — así no se puede "spamear" con peticiones repetidas.
-- ----------------------------------------------------------------------------
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint contact_requests_not_self check (from_user_id <> to_user_id)
);

create unique index if not exists contact_requests_unique_pending
  on public.contact_requests (least(from_user_id, to_user_id), greatest(from_user_id, to_user_id))
  where status = 'pending';

create index if not exists contact_requests_to_user_pending_idx
  on public.contact_requests (to_user_id) where status = 'pending';

alter table public.contact_requests enable row level security;

-- Solo lectura de las peticiones en las que participas (las mandadas o las
-- recibidas). Igual que en "contacts", todas las escrituras pasan por
-- funciones de abajo, así que no hace falta política de insert/update aquí.
drop policy if exists "contact_requests_select_own" on public.contact_requests;
create policy "contact_requests_select_own" on public.contact_requests
  for select to authenticated using (from_user_id = auth.uid() or to_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. Mandar una petición de contacto. Falla (con un mensaje que el cliente
--    reconoce) si: es a ti mismo/a, esa persona ya es tu contacto, o ya hay
--    una petición pendiente entre vosotros dos (en cualquier dirección —
--    el índice único de arriba se encarga de esto último).
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

  insert into public.contact_requests (from_user_id, to_user_id)
  values (auth.uid(), p_to_user_id)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.send_contact_request(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Aceptar o rechazar una petición recibida. Solo quien la recibió
--    (to_user_id) puede responderla, y solo mientras siga 'pending'.
-- ----------------------------------------------------------------------------
create or replace function public.respond_contact_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_req public.contact_requests;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_req from public.contact_requests where id = p_request_id for update;

  if v_req.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_req.to_user_id <> auth.uid() then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'NOT_PENDING';
  end if;

  update public.contact_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = p_request_id;

  if p_accept then
    perform public.create_mutual_contact(v_req.from_user_id, v_req.to_user_id);
  end if;
end;
$$;

grant execute on function public.respond_contact_request(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Cancelar una petición que TÚ mandaste, mientras siga pendiente.
-- ----------------------------------------------------------------------------
create or replace function public.cancel_contact_request(p_request_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_req public.contact_requests;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_req from public.contact_requests where id = p_request_id for update;

  if v_req.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_req.from_user_id <> auth.uid() then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'NOT_PENDING';
  end if;

  update public.contact_requests set status = 'cancelled', responded_at = now() where id = p_request_id;
end;
$$;

grant execute on function public.cancel_contact_request(uuid) to authenticated;
