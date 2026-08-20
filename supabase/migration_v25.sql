-- migration_v25: precio opcional por producto de una lista
--
-- Añade un precio opcional a cada nota/producto de una lista (columna
-- "price", en la misma moneda que la lista). No hace falta ninguna
-- política nueva: se edita con las mismas reglas que ya tenía el texto de
-- la nota (cualquier miembro aceptado puede editarlo — ver la política
-- "items_update_member" en schema.sql).
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.items add column if not exists price numeric(10, 2);
