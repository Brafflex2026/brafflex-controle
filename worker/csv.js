// Leitor de CSV (aspas, vírgula e quebra de linha dentro do campo, ponto e vírgula). Cabeçalhos viram minúsculas sem acento.
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[º°]/g, '').replace(/\s+/g, ' ').trim();
export const normalizarCabecalho = semAcento;

export function lerCsv(entrada) {
  const texto = String(entrada ?? '').replace(/^﻿/, '');
  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g) ?? []).length > (primeira.match(/,/g) ?? []).length ? ';' : ',';

  const registros = []; // cada um: { n, campos }
  let campos = [];
  let campo = '';
  let aspas = false;
  let linha = 1;
  let inicio = 1;
  let tinhaAlgo = false;
  const fecharCampo = () => { campos.push(campo); campo = ''; };
  const fecharRegistro = () => {
    fecharCampo();
    if (campos.some((c) => c.trim() !== '')) registros.push({ n: inicio, campos });
    campos = [];
    tinhaAlgo = false;
  };

  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 1; } else aspas = false;
      } else { if (ch === '\n') linha += 1; campo += ch; }
      continue;
    }
    if (ch === '"') { aspas = true; tinhaAlgo = true; continue; }
    if (ch === sep) { fecharCampo(); tinhaAlgo = true; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { fecharRegistro(); linha += 1; inicio = linha; continue; }
    campo += ch;
    tinhaAlgo = true;
  }
  if (aspas) return { cabecalho: [], linhas: [], erro: 'o arquivo tem aspas abertas e não foi fechado' };
  if (tinhaAlgo || campo !== '' || campos.length) fecharRegistro();

  if (registros.length === 0) return { cabecalho: [], linhas: [] };
  const cabecalho = registros[0].campos.map(normalizarCabecalho);
  const linhas = registros.slice(1).map((r) => ({
    n: r.n,
    valores: Object.fromEntries(cabecalho.map((h, i) => [h, (r.campos[i] ?? '').trim()])),
  }));
  return { cabecalho, linhas };
}
