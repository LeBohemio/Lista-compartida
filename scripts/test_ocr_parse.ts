import { parseReceiptText, OCR_CONFIDENCE_THRESHOLD } from '../src/lib/ocr'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('✓', msg)
  }
}

const receipt1 = `
MERCADONA S.A.
CIF A12345678
--------------------------
2 LECHE ENTERA        1,80
1 PAN                  0,95
3 MANZANAS             2,40
--------------------------
SUBTOTAL              5,15
TOTAL                 5,15
IVA INCLUIDO
GRACIAS POR SU VISITA
`

const r1 = parseReceiptText(receipt1, 88)
assert(r1.amount === 5.15, `Ticket Mercadona: importe 5.15 — obtenido ${r1.amount}`)
assert(r1.matchedKeyword, 'Ticket Mercadona: debe encontrar keyword "total"')
assert(r1.confidence >= OCR_CONFIDENCE_THRESHOLD, `Ticket Mercadona: confianza alta — obtenida ${r1.confidence}`)

const receipt2 = `
BAR LA ESQUINA
Mesa 4
2 Cañas         4,00
1 Tapa          3,50
------------------------
TOTAL A PAGAR: 7,50 €
`
const r2 = parseReceiptText(receipt2, 75)
assert(r2.amount === 7.5, `Ticket bar: importe 7.50 — obtenido ${r2.amount}`)
assert(r2.matchedKeyword, 'Ticket bar: debe encontrar keyword "total a pagar"')

// Ticket con OCR ruidoso, sin palabra "total" reconocible -> debe usar fallback
// y bajar la confianza por debajo del umbral para forzar revisión manual.
const receipt3 = `
xxTIENDAxx
articulo 1    12,00
articulo 2     3,50
`
const r3 = parseReceiptText(receipt3, 60)
assert(r3.amount === 12.0, `Ticket ruidoso: fallback al importe mayor — obtenido ${r3.amount}`)
assert(!r3.matchedKeyword, 'Ticket ruidoso: no debe encontrar keyword')
assert(
  r3.confidence < OCR_CONFIDENCE_THRESHOLD,
  `Ticket ruidoso: confianza debe quedar por debajo del umbral para pedir corrección manual — obtenida ${r3.confidence}`,
)

// Sin ningún número reconocible -> amount null, confianza 0 -> corrección manual obligatoria
const receipt4 = `foto borrosa sin texto legible`
const r4 = parseReceiptText(receipt4, 40)
assert(r4.amount === null, 'Ticket sin números: amount debe ser null')
assert(r4.confidence === 0, 'Ticket sin números: confidence debe ser 0')

// Formato con miles: 1.234,56
const receipt5 = `FACTURA\nTOTAL: 1.234,56 EUR`
const r5 = parseReceiptText(receipt5, 80)
assert(r5.amount === 1234.56, `Formato con miles: 1234.56 — obtenido ${r5.amount}`)

console.log('\nTodas las comprobaciones de ocr.ts ejecutadas.')
