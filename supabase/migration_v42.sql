-- migration_v42: aviso push al recibir una petición de contacto.
--
-- Hasta ahora enviar o aceptar una petición de contacto no generaba ningún
-- aviso push — mismo patrón que list_members/note_members: la función
-- notify_send_push() ya existe (ver migration_v19.sql) y no se toca, solo
-- hace falta un trigger nuevo sobre contact_requests. El lado que decide
-- qué dice el aviso vive en send-push/index.ts (handleContactRequest).
--
-- Segura de ejecutar más de una vez.
drop trigger if exists contact_requests_notify_push on public.contact_requests;
create trigger contact_requests_notify_push
  after insert on public.contact_requests
  for each row execute function public.notify_send_push();
