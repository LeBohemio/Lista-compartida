-- migration_v15: silenciar el chat de una lista
--
-- Añade "muted" a list_members: cuando está a true, esa persona deja de
-- recibir avisos push de mensajes nuevos EN ESA LISTA CONCRETA (el resto de
-- listas siguen avisando normal). Es algo personal y por lista — no afecta
-- a nadie más ni a los demás tipos de aviso (gastos, invitaciones, pagos).
--
-- No hace falta ninguna policy nueva: la política "list_members_update" ya
-- existente permite que cada persona actualice su propia fila (user_id =
-- auth.uid()), que es justo lo que hace falta para poder silenciar/activar
-- su propio chat.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.list_members
  add column if not exists muted boolean not null default false;
