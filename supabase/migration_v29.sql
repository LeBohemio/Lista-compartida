-- migration_v29: categorías automáticas para las notas de la lista de la
-- compra ("categorías vivas", ver estudio de diseño)
--
-- Añade "category" a items: guarda en qué categoría cae cada nota (fruta y
-- verdura, lácteos, limpieza…) para poder agruparlas visualmente en vez de
-- mostrarlas todas en una columna plana. Se calcula en el cliente al crear
-- la nota (palabras clave sobre el texto) y se guarda tal cual — aquí no
-- hace falta ninguna lógica de servidor, es solo la columna donde vive el
-- resultado.
--
-- Las notas ya existentes se quedan con category = null; se agrupan como
-- "Varios" hasta que se editen o se vuelvan a crear (no hace falta backfill).
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.items
  add column if not exists category text;
