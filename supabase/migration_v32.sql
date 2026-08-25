-- migration_v32: color personalizable en las notas
--
-- Añade una columna "color" a "notes", igual que ya tiene "lists" (ver
-- schema.sql) — el mismo patrón: null hasta que alguien lo elige a mano en
-- la app, y mientras tanto se usa un color estable calculado a partir del
-- título/id (ver colorForNote en src/lib/colors.ts). Se usa tanto en la
-- "lengüeta" del detalle de la nota como en su fila dentro del listado de
-- notas, para que sea el mismo color en los dos sitios.
--
-- No hace falta política RLS nueva: cualquier miembro de la nota ya puede
-- actualizar la fila de "notes" (ver migration_v23.sql, "notes_update_member"
-- o equivalente) — el color es un campo más dentro de ese mismo permiso.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.notes add column if not exists color text;
