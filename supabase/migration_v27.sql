-- migration_v27: silenciar con duración (1 hora / 8 horas / 1 semana / siempre)
--
-- Hasta ahora "silenciar" (un contacto o el chat de una lista) era todo o
-- nada, y solo se podía quitar a mano. Esto añade "muted_until": si tiene
-- fecha, el silencio deja de aplicar solo al llegar esa fecha (no hace
-- falta ningún proceso en segundo plano para "desilenciar" — se comprueba
-- la fecha en el momento de mandar cada aviso push, en la Edge Function
-- send-push, y en el momento de pintar la pantalla en la propia app).
--
--   muted = false                       → no silenciado
--   muted = true, muted_until = null    → silenciado para siempre
--   muted = true, muted_until = <fecha> → silenciado hasta esa fecha
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.contacts add column if not exists muted_until timestamptz;
alter table public.list_members add column if not exists muted_until timestamptz;

-- Mismo patrón que las columnas de "contacts" que ya tenían el permiso
-- restringido columna a columna (ver migration_v18.sql/migration_v26.sql):
-- hay que volver a listarlas todas, no solo la nueva.
revoke update on public.contacts from authenticated;
grant update (pinned, muted, last_read_message_at, blocked_at, muted_until) on public.contacts to authenticated;

-- "list_members" no tiene un grant restringido por columna (su política
-- "list_members_update" ya deja tocar cualquier columna de tu propia fila),
-- así que no hace falta ningún grant nuevo ahí.
