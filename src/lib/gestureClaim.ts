// Bandera compartida en memoria (mismo patrón que "currentlyPlayingAudio"
// en ChatPanel.tsx: una variable de módulo, sin Context ni librería de
// estado, porque solo hace falta un valor global sencillo).
//
// Varios sitios de la app ya tienen su propio gesto de arrastre horizontal:
// responder a un mensaje deslizando su burbuja, adelantar/atrasar un audio
// arrastrando la onda, cambiar de categoría de avatar deslizando sobre las
// fotos, reordenar una lista arrastrando su asa. Cada uno de ellos marca
// aquí "estoy usando el eje horizontal" en cuanto confirma que el arrastre
// va en esa dirección (o, si decide si fue swipe solo al soltar, durante
// todo el gesto), y lo desmarca al soltar o cancelar — así, si en el futuro
// se añade otro gesto horizontal en la misma zona de la pantalla, puede
// comprobar esta bandera antes de reaccionar y evitar que un mismo
// movimiento del dedo dispare los dos gestos a la vez.
export const horizontalGestureClaim = { current: false }
