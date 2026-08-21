import type { TranslationKey } from './i18n'

// "Categorías vivas" (ver estudio de diseño / migration_v29.sql): cada nota
// de la lista de la compra cae sola en una de estas 7 categorías, a partir
// de su propio texto — no hace falta elegirla a mano. El color de cada una
// es fijo (no depende del acento personalizado de quien mira la lista, a
// propósito: son colores "de mundo real" — verde para fruta y verdura,
// azul-verdoso para limpieza…) y vive en index.css como --cat-*.
//
// Ojo: esto NO tiene nada que ver con ExpenseCategory (ver categories.ts) —
// esa es la categoría de un GASTO (comida/transporte/ocio…); esta es la
// categoría de una NOTA de la lista de la compra. Nombre de archivo distinto
// a propósito para no confundirlas.
export type ItemCategoryId =
  | 'fruta_verdura'
  | 'lacteos'
  | 'carne_pescado'
  | 'panaderia'
  | 'limpieza'
  | 'bebidas'
  | 'varios'

// "varios" siempre al final, a propósito: es el cajón de sastre, no otra
// categoría más con el mismo peso que el resto.
export const ITEM_CATEGORY_ORDER: ItemCategoryId[] = [
  'fruta_verdura',
  'lacteos',
  'carne_pescado',
  'panaderia',
  'limpieza',
  'bebidas',
  'varios',
]

export const ITEM_CATEGORY_META: Record<ItemCategoryId, { labelKey: TranslationKey; colorVar: string; tintVar: string }> = {
  fruta_verdura: { labelKey: 'itemCategory.frutaVerdura', colorVar: '--cat-fruta', tintVar: '--cat-fruta-tint' },
  lacteos: { labelKey: 'itemCategory.lacteos', colorVar: '--cat-lacteos', tintVar: '--cat-lacteos-tint' },
  carne_pescado: { labelKey: 'itemCategory.carnePescado', colorVar: '--cat-carne', tintVar: '--cat-carne-tint' },
  panaderia: { labelKey: 'itemCategory.panaderia', colorVar: '--cat-panaderia', tintVar: '--cat-panaderia-tint' },
  limpieza: { labelKey: 'itemCategory.limpieza', colorVar: '--cat-limpieza', tintVar: '--cat-limpieza-tint' },
  bebidas: { labelKey: 'itemCategory.bebidas', colorVar: '--cat-bebidas', tintVar: '--cat-bebidas-tint' },
  varios: { labelKey: 'itemCategory.varios', colorVar: '--cat-varios', tintVar: '--cat-varios-tint' },
}

/** Categoría real de una nota, con "varios" como respaldo si viene null,
 *  vacía, o con un valor que ya no reconocemos (por ejemplo si en el futuro
 *  se quita una categoría de la lista). */
export function itemCategoryOf(raw: string | null | undefined): ItemCategoryId {
  return raw && (ITEM_CATEGORY_ORDER as string[]).includes(raw) ? (raw as ItemCategoryId) : 'varios'
}

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Palabras clave (es/en, sin acentos) para adivinar la categoría a partir
// del texto de la nota — coincidencia por substring, así que no hace falta
// que sea la palabra completa ("tomate" cae dentro de "tomates cherry").
// No pretende ser perfecto: lo que no reconoce cae en "varios" y ahí se
// queda hasta que alguien lo edite o lo borre y lo vuelva a escribir.
const KEYWORDS: Record<Exclude<ItemCategoryId, 'varios'>, string[]> = {
  fruta_verdura: [
    'tomate', 'lechuga', 'cebolla', 'ajo', 'patata', 'papa', 'zanahoria', 'pimiento',
    'manzana', 'platano', 'banana', 'naranja', 'limon', 'fresa', 'uva', 'pera', 'aguacate',
    'palta', 'brocoli', 'calabacin', 'calabaza', 'espinaca', 'pepino', 'melon', 'sandia',
    'kiwi', 'champinon', 'setas', 'ensalada', 'fruta', 'verdura', 'apple', 'tomato',
    'onion', 'potato', 'carrot', 'lettuce', 'garlic', 'fruit', 'vegetable', 'avocado', 'lemon',
    'orange', 'grape', 'mushroom', 'spinach', 'cucumber',
  ],
  lacteos: [
    'leche', 'huevo', 'huevos', 'yogur', 'yogurt', 'queso', 'mantequilla', 'nata', 'margarina',
    'milk', 'egg', 'eggs', 'cheese', 'butter', 'yoghurt', 'cream',
  ],
  carne_pescado: [
    'pollo', 'carne', 'ternera', 'cerdo', 'jamon', 'filete', 'chuleta', 'salchicha', 'pescado',
    'salmon', 'atun', 'gambas', 'merluza', 'bacon', 'panceta', 'chorizo', 'longaniza',
    'chicken', 'beef', 'pork', 'fish', 'tuna', 'shrimp', 'sausage', 'meat', 'ham',
  ],
  panaderia: [
    'pan', 'baguette', 'croissant', 'bolleria', 'magdalena', 'bizcocho',
    'tostada', 'bollo', 'donut', 'bread', 'bun', 'pastry', 'muffin', 'bagel', 'toast',
  ],
  limpieza: [
    'detergente', 'lavavajillas', 'lejia', 'suavizante', 'friegasuelos', 'papel higienico',
    'servilleta', 'bolsa de basura', 'bolsas basura', 'esponja', 'jabon', 'champu', 'gel de ducha',
    'pasta de dientes', 'dentifrico', 'desodorante', 'cepillo de dientes', 'cleaning', 'detergent',
    'soap', 'toilet paper', 'tissue', 'shampoo', 'toothpaste', 'trash bag',
  ],
  bebidas: [
    'agua', 'cerveza', 'vino', 'refresco', ' cola', 'zumo', 'jugo', 'cafe', ' te ', 'bebida',
    'cava', 'sidra', 'water', 'beer', 'wine', 'soda', 'juice', 'coffee', 'drink',
  ],
}

export function detectItemCategory(content: string): ItemCategoryId {
  const norm = ` ${normalize(content)} `
  for (const [category, words] of Object.entries(KEYWORDS) as [Exclude<ItemCategoryId, 'varios'>, string[]][]) {
    if (words.some((w) => norm.includes(normalize(w)))) return category
  }
  return 'varios'
}
