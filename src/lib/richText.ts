// Formato enriquecido del cuerpo de una nota (negrita, cursiva, subrayado,
// título, subtítulo) — ver NoteDetailPage.tsx. El cuerpo de una nota
// (notes.body) sigue siendo una columna de texto normal en la base de datos
// (no hace falta ninguna migración nueva), pero ahora puede contener un
// HTML muy limitado en vez de solo texto plano.
//
// Como una nota se comparte entre varias personas (cada una con su propia
// cuenta), lo que escribe una persona se acaba pintando tal cual en la
// pantalla de las demás — así que antes de guardar CUALQUIER cambio del
// cuerpo hay que quitar de en medio cualquier etiqueta que no sea de las
// permitidas (nada de <script>, atributos "on..." con código, estilos
// sueltos, enlaces, imágenes...). sanitizeNoteHtml se encarga de eso: solo
// deja pasar las etiquetas de la lista blanca de abajo, y de todas las
// demás se queda solo con el texto de dentro.
//
// H2 = título grande, H3 = subtítulo — son tres estilos de línea
// excluyentes entre sí (Título/Subtítulo/Normal, ver applyBlockStyle en
// NoteDetailPage.tsx), en vez del tamaño de letra libre en píxeles que
// tenía la app antes (un <span style="font-size:Npx">): se cambió al pedir
// que el tamaño funcionase como en la app de referencia que se tomó como
// modelo, con solo tres tamaños fijos con nombre. Por eso SPAN ya no está
// en la lista blanca — una nota antigua que tuviera un tamaño de letra
// suelto simplemente lo pierde la próxima vez que se guarde (el texto no
// se borra, solo el tamaño).

const ALLOWED_TAGS = new Set(['DIV', 'BR', 'B', 'STRONG', 'H2', 'H3', 'I', 'U', 'OL', 'UL', 'LI'])

/**
 * Limpia un HTML de nota dejando solo las etiquetas permitidas (párrafos,
 * negrita, cursiva, subrayado, título, subtítulo y listas numeradas).
 * Cualquier etiqueta que no esté en la lista blanca se "desenvuelve": se
 * queda su texto de dentro, pero no la etiqueta.
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
  doc.querySelectorAll('div, h2, h3, li, br').forEach((el) => {
    el.insertAdjacentText('beforebegin', ' ')
  })
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}
