// Converte o que a pessoa digita em reais para centavos inteiros.
// "1.500,50" → 150050 · "1500,5" → 150050 · "1500" → 150000 · "" → null (a confirmar).
// Qualquer outra forma devolve undefined. "1500.50" é recusado de propósito: o ponto é separador de milhar,
// e aceitar viraria R$ 150.050,00 sem a pessoa perceber.
export function paraCentavos(texto) {
  const t = String(texto ?? '').trim().replace(/^R\$\s*/, '');
  if (t === '') return null;
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) return undefined;
  const [inteiro, centavos = ''] = t.replace(/\./g, '').split(',');
  return Number(inteiro) * 100 + Number(centavos.padEnd(2, '0'));
}

export const deCentavos = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
