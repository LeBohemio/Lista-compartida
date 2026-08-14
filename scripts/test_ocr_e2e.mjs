import { createWorker } from 'tesseract.js'
import fs from 'node:fs'

const imagePath = process.argv[2] || '/tmp/receipt_sample.png'
console.log('Reading:', imagePath)

const worker = await createWorker('spa+eng', undefined, {
  // En Node dejamos el workerPath por defecto (worker-script/node), pero
  // forzamos el core wasm y los datos de idioma locales que también usará
  // el navegador, para validar que esos ficheros funcionan de verdad.
  corePath: new URL('../public/tesseract-core', import.meta.url).pathname,
  langPath: new URL('../public/tessdata', import.meta.url).pathname,
  logger: (m) => {
    if (m.status === 'recognizing text') process.stdout.write(`\rOCR progress: ${Math.round(m.progress * 100)}%   `)
  },
})

const { data } = await worker.recognize(fs.readFileSync(imagePath))
console.log('\n--- RAW TEXT ---')
console.log(data.text)
console.log('--- confidence ---', data.confidence)
await worker.terminate()
