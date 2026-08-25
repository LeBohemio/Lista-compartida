// OJO: sin "import { createWorker } from 'tesseract.js'" aquí arriba a
// propósito. tesseract.js es, con diferencia, la dependencia más pesada de
// toda la app (el motor de OCR en sí, en wasm) — un import normal metía
// todo eso en el bundle principal, así que TODO el mundo se lo descargaba
// nada más abrir la app, aunque jamás llegase a escanear un ticket. Con
// import() dinámico (ver extractReceiptTotal más abajo), Vite lo separa en
// su propio archivo aparte que solo se descarga la primera vez que alguien
// pulsa "escanear ticket" — el resto de la app carga igual de rápido que
// antes, y una vez descargado el navegador lo cachea para las siguientes
// veces (incluida la caché de la PWA, ver vite.config.ts).
export type ReceiptOcrResult = {
  amount: number | null
  confidence: number // 0-100
  rawText: string
  matchedKeyword: boolean
}

const TOTAL_KEYWORDS = [
  'total a pagar',
  'importe total',
  'total ticket',
  'total compra',
  'total',
  'a pagar',
  'importe',
]

// Coincide con números tipo 12,34 / 1.234,56 / 12.34 / 1234.56 (con o sin símbolo de moneda)
const AMOUNT_RE = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:€|eur)?/gi

function normalizeAmount(raw: string): number | null {
  let s = raw.trim()
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const decimalSep = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : null

  if (decimalSep === ',') {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (decimalSep === '.') {
    s = s.replace(/,/g, '')
  }
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function findAmountsInLine(line: string): number[] {
  const amounts: number[] = []
  for (const match of line.matchAll(AMOUNT_RE)) {
    const n = normalizeAmount(match[1])
    if (n !== null && n > 0 && n < 100000) amounts.push(n)
  }
  return amounts
}

/**
 * Analiza el texto OCR de un ticket y trata de extraer el importe total.
 * Prioriza líneas con palabras clave ("total", "a pagar"...) y usa el
 * mayor importe encontrado como respaldo si no hay coincidencia clara.
 */
export function parseReceiptText(text: string, baseConfidence: number): ReceiptOcrResult {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  let bestFromKeyword: number | null = null
  let sawSubtotalOnly = false

  for (const line of lines) {
    const lower = line.toLowerCase()
    const isSubtotal = lower.includes('subtotal')
    const matchesKeyword = TOTAL_KEYWORDS.some((k) => lower.includes(k))
    if (!matchesKeyword) continue

    const amounts = findAmountsInLine(line)
    if (amounts.length === 0) continue
    const candidate = Math.max(...amounts)

    if (isSubtotal) {
      sawSubtotalOnly = sawSubtotalOnly || bestFromKeyword === null
      continue // preferimos un "TOTAL" real si aparece más adelante
    }
    // Nos quedamos con la última coincidencia no-subtotal (suele ser el total final del ticket)
    bestFromKeyword = candidate
  }

  if (bestFromKeyword !== null) {
    return {
      amount: bestFromKeyword,
      confidence: Math.min(100, baseConfidence + 10),
      rawText: text,
      matchedKeyword: true,
    }
  }

  // Fallback: el importe más alto de todo el ticket (heurística habitual: el total
  // suele ser el número más grande y suele aparecer hacia el final)
  const allAmounts = lines.flatMap(findAmountsInLine)
  if (allAmounts.length > 0) {
    const candidate = Math.max(...allAmounts)
    return {
      amount: candidate,
      confidence: Math.max(0, baseConfidence - 30 - (sawSubtotalOnly ? 5 : 0)),
      rawText: text,
      matchedKeyword: false,
    }
  }

  return { amount: null, confidence: 0, rawText: text, matchedKeyword: false }
}

/** Umbral por debajo del cual pedimos confirmación/corrección obligatoria al usuario. */
export const OCR_CONFIDENCE_THRESHOLD = 65

export async function extractReceiptTotal(
  image: File | Blob,
  onProgress?: (progress: number) => void,
): Promise<ReceiptOcrResult> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('spa+eng', undefined, {
    // Servimos nosotros mismos el worker, el core wasm y los datos de idioma
    // (en vez de depender del CDN por defecto de tesseract.js) para que el
    // OCR funcione de forma fiable en producción y se pueda cachear como PWA.
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract-core',
    langPath: '/tessdata',
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(m.progress * 100))
      }
    },
  })
  try {
    const { data } = await worker.recognize(image)
    return parseReceiptText(data.text ?? '', data.confidence ?? 0)
  } finally {
    await worker.terminate()
  }
}
