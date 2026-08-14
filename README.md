# Listas en Común

PWA instalable en móvil para listas de notas y (opcionalmente) gastos
compartidos entre varias personas, con persistencia real en la nube.

**Stack:** React + Vite + TypeScript + Tailwind · Supabase (Postgres + Auth +
Storage + Realtime) · Tesseract.js (OCR de tickets, autoalojado, sin depender
de un CDN externo) · desplegado como PWA en Vercel/Netlify.

## 1. Configurar Supabase

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. Ve a **Authentication → Providers → Email** y desactiva "Confirm email"
   (para esta app, entre pocos usuarios de confianza, simplifica el alta;
   puedes reactivarlo más adelante si configuras un proveedor SMTP propio).
3. Ve a **SQL Editor → New query**, pega el contenido íntegro de
   [`supabase/schema.sql`](./supabase/schema.sql) y ejecútalo. Esto crea
   todas las tablas, las políticas de seguridad (RLS), el trigger que crea el
   perfil al registrarse, la publicación de Realtime y el bucket de Storage
   `receipts` para las fotos de tickets.
   - Si tu proyecto ya existía antes de las fotos de perfil y el chat, ejecuta
     además [`supabase/migration_avatars_chat.sql`](./supabase/migration_avatars_chat.sql)
     una sola vez (añade la columna `avatar_url`, la tabla `messages` y los
     buckets `avatars`/`chat-images`). Los proyectos nuevos ya lo tienen todo
     con solo `schema.sql`.
4. Ve a **Project Settings → API** y copia la **Project URL** y la
   **anon public key**.

## 2. Configurar el proyecto local

```bash
cp .env.example .env
# Rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env
npm install
npm run dev
```

## 3. Comprobaciones automáticas incluidas

```bash
npx tsx scripts/test_balances.ts   # lógica de balances/reparto de deudas
npx tsx scripts/test_ocr_parse.ts  # heurística de extracción de importes
node scripts/test_ocr_e2e.mjs      # OCR real (Tesseract) sobre un ticket de ejemplo
node scripts/test_flow.mjs         # flujo end-to-end con 3 usuarios reales (requiere .env)
```

`test_flow.mjs` crea 3 cuentas de prueba contra tu proyecto real de Supabase,
crea una lista sin gastos y otra con gastos, invita y acepta invitaciones,
añade y marca ítems, sube un ticket, comprueba el OCR, reparte el gasto entre
los tres, salda una deuda y verifica que el balance final es correcto.

## 4. Desplegar (persistencia real)

Esta app necesita vivir en un hosting persistente (Supabase ya lo es; el
frontend necesita el suyo):

```bash
npm i -g vercel
vercel --prod
# Añade las variables de entorno VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
# en el proyecto de Vercel (Project Settings → Environment Variables) y vuelve
# a desplegar.
```

Una vez desplegada, abre la URL en el móvil (Chrome/Safari) y usa "Añadir a
pantalla de inicio" / "Instalar app" para instalarla como PWA.

## 5. Estructura

- `supabase/schema.sql` — esquema completo de la base de datos y seguridad.
- `src/lib/` — cliente de Supabase, tipos, lógica de balances y OCR.
- `src/context/AuthContext.tsx` — sesión y perfil del usuario.
- `src/hooks/` — carga de datos + suscripciones en tiempo real.
- `src/pages/` — pantallas (login, registro, listas, detalle de lista).
- `src/components/` — piezas de UI (crear lista, invitar, ítems, gastos…).
- `public/tesseract*`, `public/tessdata/` — motor de OCR autoalojado (no
  depende del CDN de jsDelivr, se descarga bajo demanda la primera vez que
  se usa y luego queda cacheado por el service worker).
