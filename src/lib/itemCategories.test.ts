import { describe, expect, it } from 'vitest'
import { detectItemCategory, itemCategoryOf, ITEM_CATEGORY_ORDER } from './itemCategories'

describe('detectItemCategory', () => {
  it('reconoce una palabra clave en español', () => {
    expect(detectItemCategory('Tomates')).toBe('fruta_verdura')
    expect(detectItemCategory('leche entera')).toBe('lacteos')
    expect(detectItemCategory('pechugas de pollo')).toBe('carne_pescado')
  })

  it('reconoce una palabra clave en inglés', () => {
    expect(detectItemCategory('chicken breast')).toBe('carne_pescado')
    expect(detectItemCategory('toilet paper')).toBe('limpieza')
  })

  it('ignora acentos y mayúsculas', () => {
    expect(detectItemCategory('JAMÓN serrano')).toBe('carne_pescado')
    expect(detectItemCategory('Limón')).toBe('fruta_verdura')
  })

  it('compara palabras sueltas por token entero, no por "contiene"', () => {
    // "cola" está en bebidas, pero "chocolate" no debe caer ahí solo por
    // llevar esas letras dentro.
    expect(detectItemCategory('chocolate')).toBe('varios')
    // "pan" está en panadería, pero "pantalla" no debe caer ahí por
    // llevarlo dentro.
    expect(detectItemCategory('pantalla')).toBe('varios')
  })

  it('reconoce vocabulario ampliado que antes caía en "varios"', () => {
    // Ejemplos concretos de la ampliación de vocabulario: antes ninguna de
    // estas caía en su categoría real.
    expect(detectItemCategory('tortillas')).toBe('panaderia')
    // Frase completa: la tortilla de huevo, a diferencia de la palabra
    // suelta "tortilla" (que es la de trigo/maíz, ver arriba), es lácteos.
    expect(detectItemCategory('tortilla de patatas')).toBe('lacteos')
    expect(detectItemCategory('champán')).toBe('bebidas')
    expect(detectItemCategory('pavo')).toBe('carne_pescado')
    expect(detectItemCategory('col rizada')).toBe('fruta_verdura')
  })

  it('sí busca como texto (no por token) las palabras clave de varias palabras', () => {
    expect(detectItemCategory('papel higiénico doble')).toBe('limpieza')
    expect(detectItemCategory('necesitamos bolsas de basura')).toBe('limpieza')
  })

  it('cae en "varios" cuando no reconoce nada', () => {
    expect(detectItemCategory('pilas AA')).toBe('varios')
    expect(detectItemCategory('')).toBe('varios')
  })
})

describe('itemCategoryOf', () => {
  it('devuelve la categoría tal cual si es válida', () => {
    expect(itemCategoryOf('lacteos')).toBe('lacteos')
  })

  it('cae en "varios" si viene null, vacía o desconocida', () => {
    expect(itemCategoryOf(null)).toBe('varios')
    expect(itemCategoryOf(undefined)).toBe('varios')
    expect(itemCategoryOf('')).toBe('varios')
    expect(itemCategoryOf('categoria_que_ya_no_existe')).toBe('varios')
  })
})

describe('ITEM_CATEGORY_ORDER', () => {
  it('termina siempre en "varios" (el cajón de sastre va al final)', () => {
    expect(ITEM_CATEGORY_ORDER[ITEM_CATEGORY_ORDER.length - 1]).toBe('varios')
  })
})
