-- migration_v38: "recientes" — subir arriba solo lo que TÚ has abierto
--
-- Hasta ahora, sin un orden manual puesto a mano (arrastrando), "Mis
-- listas" y "Notas" ordenaban por lists.last_activity_at / notes.
-- last_activity_at: una fecha COMPARTIDA que sube con cualquier cambio de
-- CUALQUIER persona (un ítem marcado, un gasto añadido, un mensaje de
-- chat...). Eso hacía que una lista se te subiera arriba sola aunque tú no
-- hubieras hecho nada, solo porque otro miembro la tocó.
--
-- Esto añade una fecha por persona: "last_opened_at" en tu propia fila de
-- list_members / note_members, que solo se actualiza cuando TÚ entras de
-- verdad en esa lista o nota (ver ListDetailPage.tsx / NoteDetailPage.tsx).
-- El orden pasa a basarse en esto — así que lo que otros hagan en una lista
-- o nota compartida ya no te la reordena a ti.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.list_members add column if not exists last_opened_at timestamptz;
alter table public.note_members add column if not exists last_opened_at timestamptz;

-- No hace falta ninguna política ni grant nuevo: "list_members_update" y
-- "note_members_update" ya dejan a cada persona tocar cualquier columna de
-- su propia fila (user_id = auth.uid()), que es justo lo que hace falta.
