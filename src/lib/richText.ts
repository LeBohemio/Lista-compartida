// Formato enriquecido del cuerpo de una nota (negrita, subtítulo, tamaño de
// letra) — ver NoteDetailPage.tsx. El cuerpo de una nota (notes.body) sigue
// siendo una columna de texto normal en la base de datos (no hace falta
// ninguna migración nueva), pero ahora puede contener un HTML muy limitado
// en vez de solo texto plano.
//
// Como una nota se comparte entre varias personas (cada una con su propia
// cuenta), lo que escribe una persona se acaba pintando tal cual en la
// pantalla de las demás — así que antes de guardar CUALQUIER cambio del
// cuerpo hay que quitar de en medio cualquier etiqueta que no sea de las
// permitidas (nada de <script>, atributos "on..." con código, estilos
// sueltos, enlaces, imágenes...). sanitizeNoteHtml se encarga de eso: solo
// deja pasar las etiquetas de la lista blanca de abajo, y de todas las
// demás se queda solo con el texto de dentro.

const ALLOWED_TAGS = new Set(['DIV', 'BR', 'B', 'STRONG', 'H3', 'FONT', 'OL', 'UL', 'LI'])

/**
 * Limpia un HTML de nota dejando solo las etiquetas permitidas (párrafos,
 * negrita, subtítulo, tamaño de letra y listas numeradas) y, dentro de
 * <font>, solo el atributo "size" con un valor de 1 a 7 (la escala clásica
 * que usa document.execCommand('fontSize', ...) — ver NoteDetailPage.tsx).
 * Cualquier otra etiqueta se "desenvuelve" (se queda su texto de dentro,
 * pero no la etiqueta en sí) en vez de borrarse entera, para no perder
 * contenido que la persona sí escribió.
 *
 * Usa DOMParser en vez de tocar el DOM real de la página: así el HTML no
 * llega a ejecutarse ni a disparar ningún evento mientras lo analizamos.
 */
export function sanitizeNoteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const clean = (node: ChildNode): ChildNode[] => {
    if (node.nodeType === Node.TEXT_NODE) return [node.cloneNode()] as ChildNode[]
    if (node.nodeType !== Node.ELEMENT_NODE) return []

    const el = node as HTMLElement
    const childResults: ChildNode[] = []
    el.childNodes.forEach((child) => childResults.push(...clean(child)))

    if (!ALLOWED_TAGS.has(el.tagName)) return childResults

    const rebuilt = doc.createElement(el.tagName)
    if (el.tagName === 'FONT') {
      const size = el.getAttribute('size')
      if (size && /^[1-7]$/.test(size)) rebuilt.setAttribute('size', size)
    }
    childResults.forEach((child) => rebuilt.appendChild(child))
    return [rebuilt]
  }

  const container = doc.createElement('div')
  doc.body.childNodes.forEach((node) => {
    clean(node).forEach((clone) => container.appendChild(clone))
  })
  return container.innerHTML
}

/**
 * Convierte el cuerpo (con formato) a texto plano, para sitios donde no
 * tiene sentido pintar HTML — el resumen de la fila en NotesPage.tsx, por
 * ejemplo. Mete un espacio en cada salto de línea/bloque para que las
 * palabras de líneas distintas no se queden pegadas entre sí.
 */
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('div, h3, li, br').forEach((el) => {
    el.insertAdjacentText('beforebegin', ' ')
  })
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}
