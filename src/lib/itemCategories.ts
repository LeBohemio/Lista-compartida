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

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Palabras clave (es/en, sin acentos) para adivinar la categoría a partir
// del texto de la nota. Las de una sola palabra se comparan PALABRA A
// PALABRA (nunca "contiene", para que "chocolate" no caiga en bebidas solo
// porque lleva "cola" dentro, ni "champán" caiga en panadería por llevar
// "pan"); las de varias palabras ("papel higiénico") sí se buscan como
// trozo de texto, porque ahí no hay ese riesgo. Incluye plurales sueltos a
// propósito, en vez de intentar adivinarlos, para que el resultado sea
// siempre predecible. No pretende cubrirlo todo: lo que no reconoce cae en
// "varios" y ahí se queda hasta que se edite o se vuelva a escribir.
const KEYWORDS: Record<Exclude<ItemCategoryId, 'varios'>, string[]> = {
  fruta_verdura: [
    'tomate', 'tomates', 'lechuga', 'lechugas', 'cebolla', 'cebollas', 'ajo', 'ajos', 'patata',
    'patatas', 'papa', 'papas', 'zanahoria', 'zanahorias', 'pimiento', 'pimientos', 'manzana',
    'manzanas', 'platano', 'platanos', 'banana', 'bananas', 'naranja', 'naranjas', 'limon',
    'limones', 'fresa', 'fresas', 'uva', 'uvas', 'pera', 'peras', 'aguacate', 'aguacates', 'palta',
    'paltas', 'brocoli', 'calabacin', 'calabacines', 'calabaza', 'calabazas', 'espinaca',
    'espinacas', 'pepino', 'pepinos', 'melon', 'melones', 'sandia', 'sandias', 'kiwi', 'kiwis',
    'champinon', 'champinones', 'seta', 'setas', 'ensalada', 'ensaladas', 'fruta', 'frutas',
    'verdura', 'verduras', 'cereza', 'cerezas', 'pina', 'pinas', 'mango', 'mangos', 'ciruela',
    'ciruelas', 'melocoton', 'melocotones', 'durazno', 'duraznos', 'albaricoque', 'albaricoques',
    'higo', 'higos', 'granada', 'granadas', 'mandarina', 'mandarinas', 'pomelo', 'pomelos',
    'arandano', 'arandanos', 'frambuesa', 'frambuesas', 'mora', 'moras', 'coco', 'cocos', 'papaya',
    'papayas', 'apio', 'puerro', 'puerros', 'coliflor', 'guisante', 'guisantes', 'remolacha',
    'remolachas', 'rabano', 'rabanos', 'endibia', 'endibias', 'escarola', 'alcachofa',
    'alcachofas', 'berenjena', 'berenjenas', 'nabo', 'nabos', 'boniato', 'boniatos', 'batata',
    'batatas', 'perejil', 'cilantro', 'jengibre', 'rucula', 'canonigos', 'judia', 'judias', 'haba',
    'habas', 'apple', 'apples', 'tomato', 'tomatoes', 'onion', 'onions', 'potato', 'potatoes',
    'carrot', 'carrots', 'lettuce', 'garlic', 'fruit', 'vegetable', 'vegetables', 'avocado',
    'avocados', 'lemon', 'lemons', 'orange', 'oranges', 'grape', 'grapes', 'mushroom', 'mushrooms',
    'spinach', 'cucumber', 'cucumbers', 'cherry', 'cherries', 'pineapple', 'pineapples', 'mangoes',
    'pear', 'pears', 'watermelon',
  ],
  lacteos: [
    'leche', 'huevo', 'huevos', 'yogur', 'yogures', 'yogurt', 'queso', 'quesos', 'mantequilla',
    'nata', 'margarina', 'requeson', 'cuajada', 'natillas', 'kefir', 'milk', 'egg', 'eggs',
    'cheese', 'butter', 'yoghurt', 'cream',
  ],
  carne_pescado: [
    'pollo', 'carne', 'carnes', 'ternera', 'cerdo', 'jamon', 'filete', 'filetes', 'chuleta',
    'chuletas', 'salchicha', 'salchichas', 'pescado', 'pescados', 'salmon', 'atun', 'gamba',
    'gambas', 'merluza', 'bacon', 'panceta', 'chorizo', 'chorizos', 'longaniza', 'lomo',
    'solomillo', 'costilla', 'costillas', 'muslo', 'muslos', 'pechuga', 'pechugas', 'hamburguesa',
    'hamburguesas', 'albondiga', 'albondigas', 'morcilla', 'sardina', 'sardinas', 'boqueron',
    'boquerones', 'bacalao', 'dorada', 'doradas', 'lubina', 'lubinas', 'pulpo', 'calamar',
    'calamares', 'mejillon', 'mejillones', 'almeja', 'almejas', 'langostino', 'langostinos',
    'marisco', 'mariscos', 'chicken', 'beef', 'pork', 'fish', 'tuna', 'shrimp', 'sausage',
    'sausages', 'meat', 'ham',
  ],
  panaderia: [
    'pan', 'panes', 'baguette', 'croissant', 'croissants', 'bolleria', 'magdalena', 'magdalenas',
    'bizcocho', 'bizcochos', 'tostada', 'tostadas', 'bollo', 'bollos', 'donut', 'donuts', 'torta',
    'tortas', 'empanada', 'empanadas', 'palmera', 'palmeras', 'ensaimada', 'ensaimadas', 'galleta',
    'galletas', 'rosquilla', 'rosquillas', 'bread', 'bun', 'buns', 'pastry', 'muffin', 'muffins',
    'bagel', 'bagels', 'toast', 'cookie', 'cookies',
  ],
  limpieza: [
    'detergente', 'lavavajillas', 'lejia', 'suavizante', 'friegasuelos', 'papel higienico',
    'servilleta', 'servilletas', 'bolsa de basura', 'bolsas de basura', 'esponja', 'esponjas',
    'jabon', 'champu', 'gel de ducha', 'pasta de dientes', 'dentifrico', 'desodorante',
    'cepillo de dientes', 'fregona', 'bayeta', 'bayetas', 'ambientador', 'insecticida',
    'quitamanchas', 'cleaning', 'detergent', 'soap', 'toilet paper', 'tissue', 'tissues',
    'shampoo', 'toothpaste', 'trash bag',
  ],
  bebidas: [
    'agua', 'cerveza', 'cervezas', 'vino', 'vinos', 'refresco', 'refrescos', 'cola', 'zumo',
    'zumos', 'jugo', 'jugos', 'cafe', 'te', 'bebida', 'bebidas', 'cava', 'sidra', 'whisky', 'ron',
    'ginebra', 'vodka', 'licor', 'mosto', 'batido', 'batidos', 'horchata', 'tonica', 'infusion',
    'infusiones', 'water', 'beer', 'wine', 'soda', 'juice', 'coffee', 'tea', 'drink', 'drinks',
  ],
}

export function detectItemCategory(content: string): ItemCategoryId {
  const norm = normalize(content)
  const tokens = new Set(tokenize(content))
  for (const [category, words] of Object.entries(KEYWORDS) as [Exclude<ItemCategoryId, 'varios'>, string[]][]) {
    for (const word of words) {
      const nw = normalize(word)
      const isPhrase = nw.includes(' ')
      if (isPhrase ? norm.includes(nw) : tokens.has(nw)) return category
    }
  }
  return 'varios'
}
