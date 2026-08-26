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
    // Ampliación: más verdura de siempre, hierbas frescas y variantes
    // latinoamericanas que antes no estaban (elote/choclo por maíz, palta ya
    // estaba pero faltaba zapallo, etc.).
    'acelga', 'acelgas', 'col', 'coles', 'repollo', 'repollos', 'lombarda', 'berro', 'berros',
    'chalota', 'chalotas', 'escalonia', 'escalonias', 'chile', 'chiles', 'jalapeno', 'jalapenos',
    'morron', 'morrones', 'zapallo', 'zapallos', 'zapallito', 'zapallitos', 'elote', 'elotes',
    'maiz', 'choclo', 'choclos', 'yuca', 'yucas', 'mandioca', 'name', 'malanga', 'quimbombo',
    'okra', 'esparrago', 'esparragos', 'alcaparra', 'alcaparras', 'aceituna', 'aceitunas',
    'pepinillo', 'pepinillos', 'tamarindo', 'lichi', 'litchi', 'carambola', 'pitahaya', 'pitaya',
    'grosella', 'grosellas', 'chirimoya', 'chirimoyas', 'caqui', 'caquis', 'granadilla',
    'granadillas', 'maracuya', 'maracuyas', 'guayaba', 'guayabas', 'lima', 'limas',
    'albahaca', 'oregano', 'tomillo', 'romero', 'laurel', 'eneldo', 'menta', 'hierbabuena',
    'corn', 'zucchini', 'kale', 'cabbage', 'beet', 'beetroot', 'asparagus', 'celery', 'eggplant',
    'squash', 'pumpkin', 'radish', 'leek', 'artichoke', 'olive', 'olives', 'pickle', 'pickles',
    'cauliflower', 'peas', 'broccoli', 'basil', 'thyme', 'rosemary', 'parsley', 'mint', 'ginger',
    'herbs',
  ],
  lacteos: [
    'leche', 'huevo', 'huevos', 'yogur', 'yogures', 'yogurt', 'queso', 'quesos', 'mantequilla',
    'nata', 'margarina', 'requeson', 'cuajada', 'natillas', 'kefir', 'milk', 'egg', 'eggs',
    'cheese', 'butter', 'yoghurt', 'cream',
    // Ampliación: postres lácteos, quesos concretos y claras/yemas sueltas.
    'flan', 'flanes', 'petit suisse', 'actimel', 'danonino', 'mascarpone', 'ricotta',
    'mozzarella', 'parmesano', 'gouda', 'cheddar', 'brie', 'camembert', 'manchego', 'burgos',
    'clara', 'claras', 'yema', 'yemas', 'cottage cheese', 'sour cream', 'condensed milk',
    'custard', 'omelette', 'omelet',
    // "tortilla" a secas es más bien pan de trigo/maíz (ver panadería); como
    // frase completa, en cambio, es claramente la tortilla de huevo — de ahí
    // que estas vayan aquí, buscadas como texto, y no como palabra suelta.
    'tortilla de patatas', 'tortilla espanola', 'tortilla francesa', 'tortilla de huevo',
    'tortilla de papa',
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
    // Ampliación: aves y carnes menos habituales, embutidos concretos,
    // pescado y marisco que faltaban, y sus equivalentes en inglés.
    'pavo', 'pavos', 'conejo', 'conejos', 'cordero', 'corderos', 'cabrito', 'cabritos', 'venado',
    'codorniz', 'codornices', 'pato', 'patos', 'foie', 'pate', 'mortadela', 'salami', 'fuet',
    'beicon', 'tocino', 'tocineta', 'cecina', 'sobrasada', 'butifarra', 'salchichon', 'embutido',
    'embutidos', 'milanesa', 'milanesas', 'bife', 'bifes', 'trucha', 'truchas', 'rape',
    'rodaballo', 'besugo', 'caballa', 'sepia', 'sepias', 'camaron', 'camarones', 'cangrejo',
    'cangrejos', 'langosta', 'langostas', 'vieira', 'vieiras', 'berberecho', 'berberechos',
    'surimi', 'gulas', 'angulas', 'bonito', 'anchoa', 'anchoas',
    'turkey', 'duck', 'rabbit', 'lamb', 'veal', 'steak', 'crab', 'lobster', 'prawn',
    'prawns', 'trout', 'clams', 'mussels', 'octopus', 'squid', 'cod', 'anchovy', 'anchovies',
  ],
  panaderia: [
    'pan', 'panes', 'baguette', 'croissant', 'croissants', 'bolleria', 'magdalena', 'magdalenas',
    'bizcocho', 'bizcochos', 'tostada', 'tostadas', 'bollo', 'bollos', 'donut', 'donuts', 'torta',
    'tortas', 'empanada', 'empanadas', 'palmera', 'palmeras', 'ensaimada', 'ensaimadas', 'galleta',
    'galletas', 'rosquilla', 'rosquillas', 'bread', 'bun', 'buns', 'pastry', 'muffin', 'muffins',
    'bagel', 'bagels', 'toast', 'cookie', 'cookies',
    // Ampliación: aquí es donde vive "tortilla" a secas (la de trigo/maíz
    // para wraps y fajitas — la más habitual al escribir solo esa palabra
    // suelta; la tortilla de patatas/huevo se busca aparte, ver lácteos) y
    // el resto de bollería y panes que faltaban.
    'tortilla', 'tortillas', 'tortitas', 'picos', 'colines', 'grisines', 'chapata', 'chapatas',
    'pita', 'wrap', 'wraps', 'sobao', 'sobaos', 'napolitana', 'napolitanas', 'berlina', 'berlinas',
    'caracola', 'caracolas', 'trenza', 'trenzas', 'roscon', 'roscones', 'torrija', 'torrijas',
    'churro', 'churros', 'porra', 'porras', 'bunuelo', 'bunuelos', 'pretzel', 'pretzels',
    'biscote', 'biscotes', 'cracker', 'crackers', 'panecillo', 'panecillos', 'mollete', 'molletes',
  ],
  limpieza: [
    'detergente', 'lavavajillas', 'lejia', 'suavizante', 'friegasuelos', 'papel higienico',
    'servilleta', 'servilletas', 'bolsa de basura', 'bolsas de basura', 'esponja', 'esponjas',
    'jabon', 'champu', 'gel de ducha', 'pasta de dientes', 'dentifrico', 'desodorante',
    'cepillo de dientes', 'fregona', 'bayeta', 'bayetas', 'ambientador', 'insecticida',
    'quitamanchas', 'cleaning', 'detergent', 'soap', 'toilet paper', 'tissue', 'tissues',
    'shampoo', 'toothpaste', 'trash bag',
    // Ampliación: más limpieza del hogar y también higiene personal (esta
    // categoría ya mezclaba las dos cosas — jabón, champú… — así que sigue
    // la misma idea) que antes caía en "varios".
    'limpiacristales', 'quitagrasa', 'desinfectante', 'papel de cocina', 'papel aluminio',
    'papel film', 'bolsa de congelacion', 'estropajo', 'estropajos', 'recogedor', 'escoba',
    'escobas', 'mopa', 'mopas', 'desatascador', 'guante de goma', 'guantes de goma',
    'crema solar', 'protector solar', 'maquinilla de afeitar', 'cuchillas de afeitar',
    'compresa', 'compresas', 'tampon', 'tampones', 'panal', 'panales', 'toallita', 'toallitas',
    'algodon', 'bastoncillos', 'hilo dental', 'enjuague bucal', 'acondicionador',
    'rollo de cocina', 'conditioner', 'deodorant', 'razor', 'diaper', 'diapers', 'wipes',
    'sunscreen', 'paper towel', 'fabric softener', 'dish soap',
  ],
  bebidas: [
    'agua', 'cerveza', 'cervezas', 'vino', 'vinos', 'refresco', 'refrescos', 'cola', 'zumo',
    'zumos', 'jugo', 'jugos', 'cafe', 'te', 'bebida', 'bebidas', 'cava', 'sidra', 'whisky', 'ron',
    'ginebra', 'vodka', 'licor', 'mosto', 'batido', 'batidos', 'horchata', 'tonica', 'infusion',
    'infusiones', 'water', 'beer', 'wine', 'soda', 'juice', 'coffee', 'tea', 'drink', 'drinks',
    // Ampliación: más bebidas de siempre (champán/cava ya estaba con ese
    // nombre, faltaba "champan") y alguna sin alcohol que faltaba.
    'champan', 'champagne', 'granizado', 'granizados', 'smoothie', 'smoothies', 'malta',
    'chocolate caliente', 'kombucha', 'isotonica', 'isotonicas', 'energetica', 'energeticas',
    'manzanilla', 'hot chocolate', 'lemonade', 'limonada', 'sparkling water', 'milkshake',
  ],
}

export function detectItemCategory(content: string): ItemCategoryId {
  const norm = normalize(content)
  const tokens = new Set(tokenize(content))
  const entries = Object.entries(KEYWORDS) as [Exclude<ItemCategoryId, 'varios'>, string[]][]
  // Dos pasadas, no una: primero TODAS las frases de varias palabras (de
  // cualquier categoría) y solo si ninguna encaja se mira palabra por
  // palabra. Hace falta en ese orden por casos como "tortilla de patatas":
  // sin esto, como fruta_verdura se recorre antes que lácteos, la palabra
  // suelta "patatas" (patata, fruta y verdura) ganaba siempre a la frase
  // completa "tortilla de patatas" (lácteos, ver más arriba), aunque esa
  // frase sea la pista mucho más concreta de las dos.
  for (const [category, words] of entries) {
    for (const word of words) {
      const nw = normalize(word)
      if (nw.includes(' ') && norm.includes(nw)) return category
    }
  }
  for (const [category, words] of entries) {
    for (const word of words) {
      const nw = normalize(word)
      if (!nw.includes(' ') && tokens.has(nw)) return category
    }
  }
  return 'varios'
}
