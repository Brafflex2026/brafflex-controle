import { it, expect } from 'vitest';
import { paraCentavos, deCentavos } from '../src/lib/dinheiro.js';

it('converte reais digitados em centavos', () => {
  expect(paraCentavos('1.500,50')).toBe(150050);
  expect(paraCentavos('1500,5')).toBe(150050);
  expect(paraCentavos('1500')).toBe(150000);
  expect(paraCentavos('R$ 2.000')).toBe(200000);
  expect(paraCentavos('0,99')).toBe(99);
  expect(paraCentavos('1.234.567,89')).toBe(123456789);
});

it('vazio é "a confirmar" (null)', () => {
  expect(paraCentavos('')).toBeNull();
  expect(paraCentavos('   ')).toBeNull();
});

it('recusa o ponto decimal, que viraria um valor 100 vezes maior', () => {
  expect(paraCentavos('1500.50')).toBeUndefined();
  expect(paraCentavos('1500.5')).toBeUndefined();
});

it('recusa texto e valor negativo', () => {
  expect(paraCentavos('abc')).toBeUndefined();
  expect(paraCentavos('-10')).toBeUndefined();
  expect(paraCentavos('10,999')).toBeUndefined();
});

it('volta para o formato do formulário', () => {
  expect(deCentavos(150050)).toBe('1500,50');
  expect(deCentavos(null)).toBe('');
});
