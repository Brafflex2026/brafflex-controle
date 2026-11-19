// Lê os dois arquivos de origem (decisoes.md e propostas-de-mudanca.md) para a importação única.
// Só lê texto: não grava nada. Quem decide o que entra é a prévia conferida pelo Rodrigo.
const MAX_TEXTO = 20_000;
const CAMPOS = {
  data: 'data',
  demanda: 'demandaRef',
  'nível': 'nivel',
  'quem decidiu': 'quem',
  'decisão': 'decisao',
  'motivo / dados': 'motivo',
  'como desfazer (se aplicável)': 'comoDesfazer',
  'como desfazer': 'comoDesfazer',
};

const normaliza = (s) => s.normalize('NFC').trim();
const dataValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Divide o texto em blocos que começam numa linha de título; devolve [{ id, titulo, corpo }].
function blocos(md, marca, prefixo) {
  const re = new RegExp(`^${marca} (${prefixo}-\\d{3,})\\s*(?:—|–|-|:)\\s*(.+?)\\s*$`, 'gm');
  const achados = [...md.matchAll(re)];
  return achados.map((m, i) => ({
    id: m[1],
    titulo: normaliza(m[2]),
    corpo: md.slice(m.index + m[0].length, i + 1 < achados.length ? achados[i + 1].index : md.length),
  }));
}

export function lerDecisoes(md) {
  const inicio = md.indexOf('## Entradas');
  const entradas = [];
  const problemas = [];
  const vistos = new Set();
  for (const b of blocos(inicio >= 0 ? md.slice(inicio) : md, '###', 'DEC')) {
    if (b.id === 'DEC-000') continue; // modelo do formato
    const campos = {};
    const extras = [];
    let atual = null; // { chave: 'decisao' | null, rotulo, linhas }
    const fecha = () => {
      if (!atual) return;
      const valor = atual.linhas.join('\n').trim();
      if (atual.chave) campos[atual.chave] = valor;
      else extras.push(`${atual.rotulo}: ${valor}`);
      atual = null;
    };
    for (const linha of b.corpo.split(/\r?\n/)) {
      const m = /^- ([^:\n]{1,60}):\s?(.*)$/.exec(linha);
      if (m) {
        fecha();
        const rotulo = normaliza(m[1]);
        atual = { chave: CAMPOS[rotulo.toLowerCase()] ?? null, rotulo, linhas: [m[2]] };
      } else if (atual) {
        atual.linhas.push(linha);
      }
    }
    fecha();

    const erros = [];
    if (vistos.has(b.id)) erros.push('número repetido no arquivo');
    vistos.add(b.id);
    if (!dataValida(campos.data ?? '')) erros.push('falta a data (AAAA-MM-DD)');
    const nivel = Number((/^\s*([23])\b/.exec(campos.nivel ?? '') ?? [])[1]);
    if (!nivel) erros.push('falta o nível (2 ou 3)');
    if (!campos.quem) erros.push('falta "Quem decidiu"');
    if (!campos.decisao) erros.push('falta a decisão');
    const e = {
      id: b.id,
      titulo: b.titulo,
      data: campos.data ?? '',
      demandaRef: campos.demandaRef || null,
      nivel: nivel || null,
      quem: campos.quem ?? '',
      decisao: campos.decisao ?? '',
      motivo: campos.motivo || null,
      comoDesfazer: campos.comoDesfazer || null,
      observacoes: extras.length ? extras.join('\n') : null,
      propostaId: (/^(P-\d{3,})\b/.exec(b.titulo) ?? [])[1] ?? null,
    };
    for (const k of ['titulo', 'decisao', 'motivo', 'comoDesfazer', 'observacoes']) {
      if (e[k] && e[k].length > MAX_TEXTO) erros.push(`${k}: passa de ${MAX_TEXTO} caracteres`);
    }
    if (e.demandaRef && e.demandaRef.length > 120) erros.push('a demanda passa de 120 caracteres');
    if (erros.length) problemas.push({ id: b.id, motivo: erros.join('; ') });
    entradas.push(e);
  }
  return { entradas, problemas };
}

export function lerPropostas(md, decisoes = []) {
  const entradas = [];
  const problemas = [];
  const vistos = new Set();
  for (const b of blocos(md, '##', 'P')) {
    const texto = b.corpo.trim();
    const erros = [];
    if (vistos.has(b.id)) erros.push('número repetido no arquivo');
    vistos.add(b.id);
    if (!texto) erros.push('proposta sem texto');
    if (texto.length > MAX_TEXTO) erros.push(`o texto passa de ${MAX_TEXTO} caracteres`);
    // Liga a decisão que a aprovou: a linha "Decisão do Rodrigo (…, DEC-NNN)" ou a decisão cujo título começa com o número da proposta.
    const linhaDecisao = /\*\*Decisão do Rodrigo[^\n]*/.exec(texto)?.[0] ?? '';
    const daLinha = [...linhaDecisao.matchAll(/DEC-\d{3,}/g)].at(-1)?.[0] ?? null;
    const doTitulo = decisoes.find((d) => d.propostaId === b.id)?.id ?? null;
    if (erros.length) problemas.push({ id: b.id, motivo: erros.join('; ') });
    entradas.push({ id: b.id, titulo: b.titulo, texto, decisaoId: daLinha ?? doTitulo });
  }
  return { entradas, problemas };
}
