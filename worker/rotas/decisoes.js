import { Hono } from 'hono';
import { verificarTexto } from '../barreira.js';
import { lerDecisoes, lerPropostas } from '../decisoes-leitor.js';

export const decisoes = new Hono();

const MAX_TEXTO = 20_000;
const MAX_ARQUIVO = 300_000;
const LIMITE_LISTA = 500;
const ID_DEC = /^DEC-\d{3,}$/;
const ID_PROP = /^P-\d{3,}$/;
const CAMPOS_DECISAO = new Set(['data', 'demandaRef', 'nivel', 'quem', 'titulo', 'decisao', 'motivo', 'comoDesfazer', 'corrigeId', 'propostaId']);
const CAMPOS_PROPOSTA = new Set(['titulo', 'texto']);

const objetoSimples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (c, campo, erro, motivo) => c.json({ erro, campo, ...(motivo ? { motivo } : {}) }, 422);
const hojeEmBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const agora = () => new Date().toISOString();

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && Number(s.slice(0, 4)) >= 2020;
}

// Cabeçalhos próprios de recurso só de acréscimo: qualquer tentativa de alterar ou apagar recebe 405.
const semAlterar = (c) => c.json({ erro: 'registro só de acréscimo: não se altera nem se apaga; para corrigir, registre uma nova decisão apontando a antiga' }, 405, { Allow: 'GET, POST' });
decisoes.on(['PATCH', 'PUT', 'DELETE'], ['/decisoes', '/decisoes/:id', '/decisoes/importar', '/decisoes/importar/previa', '/propostas', '/propostas/:id'], semAlterar);

// Valida um texto livre (obrigatório ou não) e passa pela barreira de dado sensível.
function texto(corpo, campo, { rotulo, max, obrigatorio = false }) {
  const v = corpo[campo];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    return obrigatorio ? { falha: [campo, `${rotulo}: preencha`] } : { valor: null };
  }
  if (typeof v !== 'string') return { falha: [campo, `${rotulo}: envie texto`] };
  const t = v.trim();
  if (t.length > max) return { falha: [campo, `${rotulo}: use até ${max} caracteres`] };
  const barrado = verificarTexto(t);
  if (barrado) return { falha: [campo, `Dado sensível em "${rotulo}": ${barrado.motivo}. Não registre dado de paciente, senha ou chave.`, barrado.motivo] };
  return { valor: t };
}

const resumoDecisao = (r) => ({
  id: r.id, data: r.data, demandaRef: r.demanda_ref, nivel: r.nivel, quem: r.quem, titulo: r.titulo,
  corrigeId: r.corrige_id, propostaId: r.proposta_id, origem: r.origem,
});
const completaDecisao = (r) => ({ ...resumoDecisao(r), decisao: r.decisao, motivo: r.motivo, comoDesfazer: r.como_desfazer, observacoes: r.observacoes, criadoEm: r.criado_em, criadoPor: r.criado_por });
const resumoProposta = (r) => ({ id: r.id, titulo: r.titulo, decisaoId: r.decisao_id, origem: r.origem, criadoEm: r.criado_em });
const completaProposta = (r) => ({ ...resumoProposta(r), texto: r.texto, criadoPor: r.criado_por });

const PROXIMO_DEC = "'DEC-' || printf('%03d', COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1)";
const PROXIMO_PROP = "'P-' || printf('%03d', COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) + 1)";

// Grava com número sequencial calculado no próprio INSERT, mais a auditoria, num lote só. Repete se dois envios disputarem o número.
async function gravarNumerado(DB, { tabela, entidade, expr, colunas, valores, usuario, depois, chave }) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      await DB.batch([
        DB.prepare(`INSERT INTO ${tabela} (id, chave, ${colunas.join(', ')}) SELECT ${expr}, ?, ${colunas.map(() => '?').join(', ')} FROM ${tabela}`).bind(chave, ...valores),
        DB.prepare(`INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) SELECT ?, ?, 'criar', ?, id, NULL, ? FROM ${tabela} WHERE chave = ?`).bind(agora(), usuario, entidade, JSON.stringify(depois), chave),
      ]);
      return true;
    } catch (e) {
      if ((await DB.prepare(`SELECT 1 FROM ${tabela} WHERE chave = ?`).bind(chave).first())) return true; // outro envio igual chegou antes
      if (!/UNIQUE|constraint/i.test(String(e?.message ?? e)) || tentativa === 3) throw e;
    }
  }
  return false;
}

// ---------------------------------------------------------------- decisões
decisoes.get('/decisoes', async (c) => {
  const q = c.req.query();
  const onde = [];
  const binds = [];
  if (q.demanda) { onde.push('demanda_ref = ?'); binds.push(q.demanda.slice(0, 120)); }
  if (q.nivel === '2' || q.nivel === '3') { onde.push('nivel = ?'); binds.push(Number(q.nivel)); }
  if (q.q) {
    onde.push("(instr(lower(titulo), lower(?)) > 0 OR instr(lower(decisao), lower(?)) > 0 OR instr(lower(coalesce(motivo, '')), lower(?)) > 0)");
    const t = q.q.slice(0, 100);
    binds.push(t, t, t);
  }
  const filtro = onde.length ? `WHERE ${onde.join(' AND ')}` : '';
  const linhas = await c.env.DB.prepare(`SELECT id, data, demanda_ref, nivel, quem, titulo, corrige_id, proposta_id, origem FROM decisao ${filtro} ORDER BY data DESC, CAST(SUBSTR(id, 5) AS INTEGER) DESC LIMIT ${LIMITE_LISTA}`).bind(...binds).all();
  const importada = !!(await c.env.DB.prepare('SELECT 1 FROM importacao_unica').first());
  return c.json({ itens: linhas.results.map(resumoDecisao), importada });
});

decisoes.get('/decisoes/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_DEC.test(id)) return c.json({ erro: 'decisão não encontrada' }, 404);
  const r = await c.env.DB.prepare('SELECT * FROM decisao WHERE id = ?').bind(id).first();
  if (!r) return c.json({ erro: 'decisão não encontrada' }, 404);
  const corrigida = (await c.env.DB.prepare('SELECT id FROM decisao WHERE corrige_id = ? ORDER BY id').bind(id).all()).results.map((x) => x.id);
  return c.json({ decisao: completaDecisao(r), corrigidaPor: corrigida });
});

decisoes.post('/decisoes', async (c) => {
  const chave = c.req.header('idempotency-key');
  if (!chave || chave.length > 100) return c.json({ erro: 'falta a chave de envio (Idempotency-Key)' }, 400);
  const DB = c.env.DB;

  const repetido = await DB.prepare('SELECT * FROM decisao WHERE chave = ?').bind(chave).first();
  if (repetido) return c.json({ decisao: completaDecisao(repetido) }, 200);

  const corpo = await c.req.json().catch(() => null);
  if (!objetoSimples(corpo)) return falha(c, 'corpo', 'envie os dados da decisão');
  for (const k of Object.keys(corpo)) if (!CAMPOS_DECISAO.has(k)) return falha(c, k, `"${k}" não pode ser informado`);

  if (!dataValida(corpo.data)) return falha(c, 'data', 'data: informe uma data real no formato AAAA-MM-DD');
  if (corpo.data > hojeEmBrasilia()) return falha(c, 'data', 'data: a decisão não pode ser de uma data futura');
  if (corpo.nivel !== 2 && corpo.nivel !== 3) return falha(c, 'nivel', 'nível: use 2 (COVO) ou 3 (Rodrigo)');
  const v = {};
  for (const [campo, opc] of [
    ['quem', { rotulo: 'quem decidiu', max: 120, obrigatorio: true }],
    ['titulo', { rotulo: 'título', max: 200, obrigatorio: true }],
    ['decisao', { rotulo: 'decisão', max: MAX_TEXTO, obrigatorio: true }],
    ['motivo', { rotulo: 'motivo', max: MAX_TEXTO }],
    ['comoDesfazer', { rotulo: 'como desfazer', max: MAX_TEXTO }],
    ['demandaRef', { rotulo: 'demanda', max: 120 }],
  ]) {
    const r = texto(corpo, campo, opc);
    if (r.falha) return falha(c, ...r.falha);
    v[campo] = r.valor;
  }
  for (const [campo, regex, tabela, rotulo] of [['corrigeId', ID_DEC, 'decisao', 'decisão corrigida'], ['propostaId', ID_PROP, 'proposta', 'proposta']]) {
    const x = corpo[campo];
    if (x === undefined || x === null || x === '') { v[campo] = null; continue; }
    if (typeof x !== 'string' || !regex.test(x) || !(await DB.prepare(`SELECT 1 FROM ${tabela} WHERE id = ?`).bind(x).first())) return falha(c, campo, `${rotulo}: esse número não existe`);
    v[campo] = x;
  }

  await gravarNumerado(DB, {
    tabela: 'decisao',
    entidade: 'decisao',
    expr: PROXIMO_DEC,
    colunas: ['data', 'demanda_ref', 'nivel', 'quem', 'titulo', 'decisao', 'motivo', 'como_desfazer', 'corrige_id', 'proposta_id', 'origem', 'criado_em', 'criado_por'],
    valores: [corpo.data, v.demandaRef, corpo.nivel, v.quem, v.titulo, v.decisao, v.motivo, v.comoDesfazer, v.corrigeId, v.propostaId, 'app', agora(), c.get('usuario').email],
    usuario: c.get('usuario').email,
    depois: { titulo: v.titulo, data: corpo.data, nivel: corpo.nivel, demandaRef: v.demandaRef, corrigeId: v.corrigeId, propostaId: v.propostaId },
    chave,
  });
  const r = await DB.prepare('SELECT * FROM decisao WHERE chave = ?').bind(chave).first();
  return c.json({ decisao: completaDecisao(r) }, 201);
});

// ---------------------------------------------------------------- propostas
decisoes.get('/propostas', async (c) => {
  const linhas = await c.env.DB.prepare(`SELECT id, titulo, decisao_id, origem, criado_em FROM proposta ORDER BY CAST(SUBSTR(id, 3) AS INTEGER) DESC LIMIT ${LIMITE_LISTA}`).all();
  return c.json({ itens: linhas.results.map(resumoProposta) });
});

decisoes.get('/propostas/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_PROP.test(id)) return c.json({ erro: 'proposta não encontrada' }, 404);
  const DB = c.env.DB;
  const r = await DB.prepare('SELECT * FROM proposta WHERE id = ?').bind(id).first();
  if (!r) return c.json({ erro: 'proposta não encontrada' }, 404);
  const ligadas = (
    await DB.prepare('SELECT id, data, demanda_ref, nivel, quem, titulo, corrige_id, proposta_id, origem FROM decisao WHERE proposta_id = ? OR id = ? ORDER BY id').bind(id, r.decisao_id ?? '').all()
  ).results.map(resumoDecisao);
  return c.json({ proposta: completaProposta(r), decisoes: ligadas });
});

decisoes.post('/propostas', async (c) => {
  const chave = c.req.header('idempotency-key');
  if (!chave || chave.length > 100) return c.json({ erro: 'falta a chave de envio (Idempotency-Key)' }, 400);
  const DB = c.env.DB;
  const repetido = await DB.prepare('SELECT * FROM proposta WHERE chave = ?').bind(chave).first();
  if (repetido) return c.json({ proposta: completaProposta(repetido) }, 200);

  const corpo = await c.req.json().catch(() => null);
  if (!objetoSimples(corpo)) return falha(c, 'corpo', 'envie os dados da proposta');
  for (const k of Object.keys(corpo)) if (!CAMPOS_PROPOSTA.has(k)) return falha(c, k, `"${k}" não pode ser informado`);
  const t = texto(corpo, 'titulo', { rotulo: 'título', max: 200, obrigatorio: true });
  if (t.falha) return falha(c, ...t.falha);
  const x = texto(corpo, 'texto', { rotulo: 'texto', max: MAX_TEXTO, obrigatorio: true });
  if (x.falha) return falha(c, ...x.falha);

  await gravarNumerado(DB, {
    tabela: 'proposta',
    entidade: 'proposta',
    expr: PROXIMO_PROP,
    colunas: ['titulo', 'texto', 'origem', 'criado_em', 'criado_por'],
    valores: [t.valor, x.valor, 'app', agora(), c.get('usuario').email],
    usuario: c.get('usuario').email,
    depois: { titulo: t.valor },
    chave,
  });
  const r = await DB.prepare('SELECT * FROM proposta WHERE chave = ?').bind(chave).first();
  return c.json({ proposta: completaProposta(r) }, 201);
});

// ---------------------------------------------------------------- importação única
const ARQUIVOS = ['decisoes', 'propostas'];

// Lê os dois arquivos e monta a prévia. Não grava nada. Qualquer problema (formato, dado sensível, número já usado) trava a importação.
async function montarPrevia(DB, corpo) {
  const dec = lerDecisoes(corpo.decisoes);
  const prop = lerPropostas(corpo.propostas, dec.entradas);
  const problemas = [...dec.problemas, ...prop.problemas];
  const avisos = [];

  for (const e of dec.entradas) {
    for (const [campo, rotulo] of [['titulo', 'título'], ['decisao', 'decisão'], ['motivo', 'motivo'], ['comoDesfazer', 'como desfazer'], ['observacoes', 'observações'], ['quem', 'quem'], ['demandaRef', 'demanda']]) {
      const barrado = e[campo] ? verificarTexto(e[campo]) : null;
      if (barrado) problemas.push({ id: e.id, motivo: `dado sensível em "${rotulo}": ${barrado.motivo}` });
    }
  }
  for (const p of prop.entradas) {
    for (const [campo, rotulo] of [['titulo', 'título'], ['texto', 'texto']]) {
      const barrado = verificarTexto(p[campo]);
      if (barrado) problemas.push({ id: p.id, motivo: `dado sensível em "${rotulo}": ${barrado.motivo}` });
    }
  }

  const idsDec = new Set(dec.entradas.map((e) => e.id));
  const idsProp = new Set(prop.entradas.map((p) => p.id));
  for (const e of dec.entradas) if (e.propostaId && !idsProp.has(e.propostaId)) { avisos.push({ id: e.id, motivo: `cita ${e.propostaId}, que não está no arquivo de propostas: ligação não criada` }); e.propostaId = null; }
  for (const p of prop.entradas) if (p.decisaoId && !idsDec.has(p.decisaoId)) { avisos.push({ id: p.id, motivo: `cita ${p.decisaoId}, que não está no arquivo de decisões: ligação não criada` }); p.decisaoId = null; }

  const existentes = new Set([
    ...(await DB.prepare('SELECT id FROM decisao').all()).results.map((r) => r.id),
    ...(await DB.prepare('SELECT id FROM proposta').all()).results.map((r) => r.id),
  ]);
  for (const id of [...idsDec, ...idsProp]) if (existentes.has(id)) problemas.push({ id, motivo: 'esse número já existe no app' });

  const jaImportado = !!(await DB.prepare('SELECT 1 FROM importacao_unica').first());
  return { dec, prop, problemas, avisos, jaImportado };
}

// Confere o corpo comum da prévia e da importação.
function lerCorpoImportacao(corpo) {
  if (!objetoSimples(corpo)) return { falha: [422, 'envie os dois arquivos'] };
  for (const k of ARQUIVOS) if (typeof corpo[k] !== 'string' || corpo[k].trim() === '') return { falha: [422, `falta o texto do arquivo de ${k}`] };
  for (const k of ARQUIVOS) if (corpo[k].length > MAX_ARQUIVO) return { falha: [413, `o arquivo de ${k} passa de ${MAX_ARQUIVO} caracteres`] };
  return { ok: true };
}

const respostaPrevia = ({ dec, prop, problemas, avisos, jaImportado }) => ({
  decisoes: { total: dec.entradas.length, itens: dec.entradas.map((e) => ({ id: e.id, titulo: e.titulo, data: e.data, nivel: e.nivel, propostaId: e.propostaId })) },
  propostas: { total: prop.entradas.length, itens: prop.entradas.map((p) => ({ id: p.id, titulo: p.titulo, decisaoId: p.decisaoId })) },
  problemas,
  avisos,
  jaImportado,
});

decisoes.post('/decisoes/importar/previa', async (c) => {
  const corpo = await c.req.json().catch(() => null);
  const l = lerCorpoImportacao(corpo);
  if (l.falha) return c.json({ erro: l.falha[1] }, l.falha[0]);
  const p = await montarPrevia(c.env.DB, corpo);
  if (p.dec.entradas.length + p.prop.entradas.length === 0) return c.json({ erro: 'não encontrei nenhuma decisão nem proposta nesses textos' }, 422);
  return c.json(respostaPrevia(p));
});

decisoes.post('/decisoes/importar', async (c) => {
  const corpo = await c.req.json().catch(() => null);
  const l = lerCorpoImportacao(corpo);
  if (l.falha) return c.json({ erro: l.falha[1] }, l.falha[0]);
  const DB = c.env.DB;
  const p = await montarPrevia(DB, corpo);
  if (p.jaImportado) return c.json({ erro: 'a importação já foi feita; só se importa uma vez' }, 409);
  if (p.dec.entradas.length + p.prop.entradas.length === 0) return c.json({ erro: 'não encontrei nenhuma decisão nem proposta nesses textos' }, 422);
  if (p.problemas.length > 0) return c.json({ erro: 'a prévia tem problemas; corrija os arquivos e confira a prévia de novo', problemas: p.problemas }, 422);
  const conf = corpo.confirmar;
  if (!objetoSimples(conf) || conf.decisoes !== p.dec.entradas.length || conf.propostas !== p.prop.entradas.length) {
    return c.json({ erro: 'as quantidades confirmadas não são as da prévia; confira a prévia de novo' }, 422);
  }

  const usuario = c.get('usuario').email;
  const quando = agora();
  const linhasDec = JSON.stringify(p.dec.entradas.map((e) => ({ ...e, criadoEm: quando })));
  const linhasProp = JSON.stringify(p.prop.entradas.map((x) => ({ ...x, criadoEm: quando })));
  try {
    const r = await DB.batch([
      DB.prepare("INSERT INTO importacao_unica (nome, feita_em) VALUES ('decisoes-propostas', ?)").bind(quando),
      DB.prepare("INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) VALUES (?, ?, 'importar', 'decisao', 'importacao', NULL, ?)").bind(
        quando, usuario, JSON.stringify({ decisoes: p.dec.entradas.length, propostas: p.prop.entradas.length }),
      ),
      DB.prepare(
        `INSERT INTO decisao (id, chave, data, demanda_ref, nivel, quem, titulo, decisao, motivo, como_desfazer, observacoes, corrige_id, proposta_id, origem, criado_em, criado_por)
         SELECT json_extract(value, '$.id'), NULL, json_extract(value, '$.data'), json_extract(value, '$.demandaRef'), json_extract(value, '$.nivel'),
                json_extract(value, '$.quem'), json_extract(value, '$.titulo'), json_extract(value, '$.decisao'), json_extract(value, '$.motivo'),
                json_extract(value, '$.comoDesfazer'), json_extract(value, '$.observacoes'), NULL, json_extract(value, '$.propostaId'), 'importada',
                json_extract(value, '$.criadoEm'), ?
         FROM json_each(?)`,
      ).bind(usuario, linhasDec),
      DB.prepare(
        `INSERT INTO proposta (id, chave, titulo, texto, decisao_id, origem, criado_em, criado_por)
         SELECT json_extract(value, '$.id'), NULL, json_extract(value, '$.titulo'), json_extract(value, '$.texto'), json_extract(value, '$.decisaoId'), 'importada',
                json_extract(value, '$.criadoEm'), ?
         FROM json_each(?)`,
      ).bind(usuario, linhasProp),
    ]);
    if (r[2].meta.changes !== p.dec.entradas.length || r[3].meta.changes !== p.prop.entradas.length) throw new Error('contagem gravada diferente da prévia');
  } catch (e) {
    if (await DB.prepare('SELECT 1 FROM importacao_unica').first()) return c.json({ erro: 'a importação já foi feita; só se importa uma vez' }, 409);
    throw e;
  }
  return c.json({ decisoes: p.dec.entradas.length, propostas: p.prop.entradas.length });
});
