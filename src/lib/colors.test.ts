import { describe, expect, it } from 'vitest'
import { colorForList, colorForName, colorForNote, colorNameKey, PALETTE } from './colors'

describe('colorForName', () => {
  it('es estable: el mismo nombre siempre da el mismo color', () => {
    expect(colorForName('Ana')).toBe(colorForName('Ana'))
  })

  it('siempre devuelve un color de la paleta', () => {
    for (const name of ['Ana', 'Luis', '', 'x', 'Un nombre bastante largo de verdad']) {
      expect(PALETTE).toContain(colorForName(name))
    }
  })

  it('usa un color de respaldo si el nombre viene vacío', () => {
    expect(PALETTE).toContain(colorForName(''))
  })
})

describe('colorNameKey', () => {
  it('devuelve la clave de traducción correcta para cada color de la paleta', () => {
    for (const hex of PALETTE) {
      expect(colorNameKey(hex)).toBeTruthy()
    }
  })

  it('tiene una clave de respaldo para un color que no está en la paleta', () => {
    expect(colorNameKey('#000000')).toBe('menu.changeColor')
  })
})

describe('colorForList / colorForNote', () => {
  it('usa el color guardado si lo hay', () => {
    expect(colorForList({ id: '1', name: 'Compra', color: '#123456' })).toBe('#123456')
    expect(colorForNote({ id: '1', title: 'Ideas', color: '#654321' })).toBe('#654321')
  })

  it('si no hay color guardado, cae en uno estable según el nombre/título', () => {
    expect(colorForList({ id: '1', name: 'Compra' })).toBe(colorForName('Compra'))
    expect(colorForNote({ id: '1', title: 'Ideas' })).toBe(colorForName('Ideas'))
  })

  it('si tampoco hay nombre/título, usa el id como último respaldo', () => {
    expect(colorForList({ id: 'lista-1', name: '' })).toBe(colorForName('lista-1'))
    expect(colorForNote({ id: 'nota-1', title: '' })).toBe(colorForName('nota-1'))
  })
})
