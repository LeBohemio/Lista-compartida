# Notificaciones push — pasos para activarlas

Esto es lo único de esta entrega que no es "copiar archivo y listo": hacen
falta unos pasos manuales en el Dashboard de Supabase, una única vez.

## 1. Ejecuta las migraciones

Igual que las anteriores: Supabase → SQL Editor → New query → pega el
contenido → Run. Dos, en este orden:

1. `supabase/migration_v14.sql` (tablas y preferencias de notificaciones)
2. `supabase/migration_v15.sql` (silenciar el chat de una lista concreta)

## 2. Configura los "secrets" de la función (Project Settings → Edge Functions → Secrets)

Añade estos 4:

- `VAPID_PUBLIC_KEY` = `BCaB1l35YbexCy7Lj8o7pUz2Aq4nW5HsSXVncXoKTSTTvWrn-RHX9gFBDCv8d1zpRqlcS0F1w0Vt6RzX_rLrDcQ`
- `VAPID_PRIVATE_KEY` = `ecU0Wi5A4SPhftVDnVx0nNHx362luc1lpMwvLqkZdHI`
- `VAPID_SUBJECT` = `mailto:tu-correo@ejemplo.com` (pon un correo real tuyo — lo exige el estándar, no lo ve nadie más)
- `WEBHOOK_SECRET` = inventa una contraseña larga cualquiera (opcional pero recomendado — evita que alguien más pueda llamar a la función)

La clave pública ya va puesta también en el código (`src/lib/push.ts`) — es
la misma pareja, no la cambies sin cambiar las dos a la vez. Si algún día
las notificaciones dejan de llegar a todo el mundo de golpe (todo activado,
la función se ejecuta sin caerse, pero nada llega), mira los Logs de la
función `send-push`: un error `statusCode=403` con el texto "the VAPID
credentials in the authorization header do not correspond to the
credentials used to create the subscriptions" significa exactamente esto —
que esta clave pública y `VAPID_PRIVATE_KEY` ya no son la misma pareja — y
hay que generar una pareja nueva y volver a poner las dos a la vez (aquí Y
en `src/lib/push.ts`), avisando a todo el mundo de que vuelva a activar las
notificaciones después.

## 3. Despliega la función

Dashboard → Edge Functions → Create a new function → nómbrala `send-push` →
pega el contenido de `supabase/functions/send-push/index.ts` → Deploy.

## 4. Crea 4 Database Webhooks (Database → Webhooks → Create a new webhook)

Uno por cada tabla, todos apuntando a la misma función:

| Tabla | Evento |
|---|---|
| `messages` | Insert |
| `expenses` | Insert |
| `list_members` | Insert |
| `settlements` | Insert |

Para cada uno:
- Type: HTTP Request (o "Supabase Edge Functions" si tu Dashboard te deja elegir la función directamente — en ese caso el Authorization se rellena solo y puedes saltarte la línea de abajo)
- URL: `https://TU-PROYECTO.supabase.co/functions/v1/send-push`
- HTTP Headers:
  - `Authorization: Bearer TU_SERVICE_ROLE_KEY` (Project Settings → API → service_role — NO la anon key)
  - `x-webhook-secret: la-contraseña-que-inventaste-en-el-paso-2` (solo si pusiste `WEBHOOK_SECRET`)

## Ya está

A partir de aquí, cualquiera que entre a Perfil → Notificaciones → "Activar
notificaciones" empieza a recibir avisos de verdad (con el móvil o la app
cerrados) para: mensajes de chat, gastos nuevos, invitaciones a listas y
pagos pendientes de confirmar — cada uno se puede apagar individualmente
sin desactivar los demás. Además, dentro de cada lista, en la pestaña Chat
hay un botón para silenciar solo el chat de esa lista sin tocar las demás.

Nota: como cambiamos el Service Worker (ahora escrito a mano, para poder
reaccionar a los avisos push — antes se generaba solo), la primera vez que
alguien abra la app después de subir esto, el navegador tarda un pelín más
en activar la versión nueva del Service Worker de fondo — no hace falta
que hagan nada especial, es automático.
