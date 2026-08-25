-- migration_v34: reordenar notas a mano
--
-- Añade "position" a "note_members", igual que ya existe en "list_members"
-- (ver migration_v7.sql) — orden manual guardado por cada miembro sobre SU
-- copia del listado de notas, no algo compartido con el resto de gente de
-- la nota. Null hasta que alguien reordena a mano por primera vez (o pulsa
-- "por fecha"/"alfabético", que también guarda un orden explícito).
--
-- No hace falta política RLS nueva: la de "note_members_update" (ver
-- migration_v23.sql) ya deja a cada miembro actualizar su propia fila.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.note_members add column if not exists position integer;
