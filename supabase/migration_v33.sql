-- migration_v33: fijar notas
--
-- Añade "pinned" a "note_members", igual que ya existe en "list_members"
-- (ver migration_v6.sql) — es una preferencia personal de cada miembro (tu
-- copia de la nota aparece arriba del todo en tu listado), no algo
-- compartido con el resto de gente de la nota.
--
-- No hace falta política RLS nueva: la de "note_members_update" (ver
-- migration_v23.sql) ya deja a cada miembro actualizar su propia fila.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.note_members add column if not exists pinned boolean not null default false;
