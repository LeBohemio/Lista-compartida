# Publicar NoteUs como app de Android — guía paso a paso

Esto es una chuleta de pasos manuales (como PLAY_STORE_DATA_SAFETY.md), no
código. Nada de esto se puede automatizar desde aquí: hace falta tu cuenta
de Google Play Console y, en el camino recomendado, ni siquiera hace falta
instalar nada en tu ordenador.

## Antes de nada: qué es una "TWA"

Google Play no acepta subir una web tal cual. Lo que sí acepta es una app
Android muy fina que, por dentro, abre tu web
(`https://lista-compartida-app.vercel.app`) a pantalla completa, usando
Chrome por debajo pero sin que se note — eso se llama **Trusted Web
Activity (TWA)**. NoteUs ya está lista para esto: el manifest de la PWA
(nombre, iconos, modo pantalla completa) ya tiene todo lo que hace falta.

## Camino recomendado: PWABuilder (sin instalar nada)

Para alguien sin experiencia en Android, esta es con diferencia la forma
más simple — es una web de Microsoft pensada exactamente para esto, no una
herramienta de terceros dudosa.

1. Entra en **https://www.pwabuilder.com**.
2. Pega la URL de NoteUs: `https://lista-compartida-app.vercel.app` y pulsa
   "Start".
3. PWABuilder analiza la web y te enseña una puntuación (debería salir
   verde en casi todo, gracias al manifest que ya tiene la app). No hace
   falta que esté perfecta al 100% para poder continuar.
4. Pulsa **"Package for stores"** → elige **Android**.
5. Te va a pedir estos datos — usa estos valores:
   - **Package ID**: `com.noteus.app` (una vez publicada la app en Play
     Store, esto ya NO se puede cambiar nunca — si prefieres otro nombre,
     este es el momento de decidirlo, no después).
   - **App name**: `NoteUs`
   - **Signing key**: elige "Generate new signing key" (PWABuilder te crea
     una clave de firma nueva y te la da para descargar — GUÁRDALA en un
     sitio seguro, la necesitas para cualquier actualización futura de la
     app; si la pierdes, no podrás actualizar la app nunca más y tendrías
     que publicarla desde cero con otro Package ID).
6. Descarga el paquete. Dentro encontrarás:
   - Un archivo `.aab` (Android App Bundle) — **esto es lo que subes a Play
     Console**.
   - Un archivo `assetlinks.json` con la huella SHA256 de tu clave de firma
     ya rellena.
   - Los datos de tu clave de firma (guárdalos aparte, en un gestor de
     contraseñas o similar).

## Publicar el archivo `assetlinks.json`

Esto es lo que le demuestra a Android que la web y la app son "la misma
cosa" — sin esto, la app sigue funcionando pero se ve la barra de Chrome
arriba, como una web cualquiera, en vez de pantalla completa.

1. Coge el `assetlinks.json` que te dio PWABuilder (el de la huella SHA256
   ya rellena, NO el de este envío, que lleva un valor de relleno).
2. En el repositorio de la app hay un archivo en
   `public/.well-known/assetlinks.json` — sustitúyelo por el que te dio
   PWABuilder.
3. Despliega los cambios (el flujo de siempre: GitHub → Vercel).
4. Comprueba que funciona abriendo esta URL en el navegador:
   `https://lista-compartida-app.vercel.app/.well-known/assetlinks.json` —
   tiene que enseñarte el JSON tal cual, NO la app. Si en vez de eso ves la
   pantalla de entrar a NoteUs, avísame y lo revisamos (sería un problema
   de la configuración de Vercel, se arregla fácil).

## Subir la app a Play Console

1. Entra en **https://play.google.com/console** con tu cuenta de Google
   (hace falta pagar una cuota única de desarrollador si no la tienes ya).
2. Crea la app nueva → elige el nombre, idioma por defecto (español),
   gratis, y el tipo (aplicación).
3. Rellena todo lo de **PLAY_STORE_DATA_SAFETY.md** (ya está preparado de
   antes: política de privacidad, borrado de cuenta, seguridad de los
   datos, clasificación de contenido, capturas de pantalla).
4. En **Producción → Crear nueva versión**, sube el archivo `.aab` que te
   dio PWABuilder.
5. Firma (Play App Signing): Google te va a pedir que le "confíes" tu clave
   de firma para que sea él quien gestione la versión final publicada
   (recomendado, así no dependes de guardar tu clave perfectamente para
   siempre) — acepta esta opción salvo que tengas una razón concreta para
   no hacerlo.
6. Sigue con el **testing cerrado de 12 personas / 14 días** que ya explica
   PLAY_STORE_DATA_SAFETY.md antes de poder pedir salir a producción.

## Alternativa para más adelante: proyecto Android nativo

Si en algún momento quieres control total (o se lo encargas a alguien con
experiencia en Android) en vez de depender de PWABuilder, en
`android-twa-reference/` va un proyecto de Android Studio ya montado con la
misma idea (Trusted Web Activity apuntando a tu web). Dos avisos honestos
sobre esto:

- Está escrito a mano, sin poder compilarlo ni probarlo desde aquí (este
  entorno no tiene Android Studio ni acceso a internet para descargar el
  SDK de Android) — trátalo como punto de partida para un desarrollador,
  no como algo listo para usar tal cual.
- Le falta el archivo `gradle-wrapper.jar` (un binario que no se puede
  generar sin conexión) — Android Studio lo regenera solo la primera vez
  que abres el proyecto y te lo pide.

Para el 90% de los casos (incluido el tuyo, seguramente), PWABuilder hace
exactamente lo mismo que este proyecto pero ya compilado, firmado y
probado por ellos — es la opción que recomiendo salvo que ya tengas a
alguien de confianza para llevar la parte nativa.

## Resumen de lo que cambia en el código de la app

- `public/.well-known/assetlinks.json` — archivo nuevo (con un valor de
  relleno; lo sustituyes por el real de PWABuilder cuando lo tengas).
- `android-twa-reference/` — carpeta nueva con el proyecto de Android de
  referencia explicado arriba. No afecta nada de la web ni hace falta
  desplegarla — solo está ahí por si la necesitas.

No hace falta ninguna migración de base de datos para esta parte.
