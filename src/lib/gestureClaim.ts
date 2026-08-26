// Bandera compartida en memoria (mismo patrón que "currentlyPlayingAudio"
// en ChatPanel.tsx: una variable de módulo, sin Context ni librería de
// estado, porque solo hace falta un valor global sencillo).
//
// Varios sitios de la app ya tienen su propio gesto de arrastre horizontal:
// responder a un mensaje deslizando su burbuja, adelantar/atrasar un audio
// arrastrando la onda, cambiar de categoría de avatar deslizando sobre las
// fotos, reordenar una lista arrastrando su asa. El swipe para cambiar de
// pantalla (ver useSwipeNav.ts) tiene que quedarse quieto mientras
// cualquiera de esos otros gestos esté en marcha — si no, un mismo
// movimiento del dedo podría disparar los dos a la vez (por ejemplo,
// responder a un mensaje Y cambiar de pestaña del tirón).
//
// Cada gesto ya existente marca aquí "estoy usando el eje horizontal" en
// cuanto confirma que el arrastre va en esa dirección (o, si decide si fue
// swipe solo al soltar, durante todo el gesto), y lo desmarca al soltar o
// cancelar. useSwipeNav comprueba esta bandera antes de reaccionar a cada
// gesto, así no hace falta que conozca de antemano la lista completa de
// gestos que existen hoy — ni los que se añadan mañana, siempre que también
// marquen esta bandera mientras estén activos.
export const horizontalGestureClaim = { current: false }
