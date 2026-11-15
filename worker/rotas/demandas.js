import { Hono } from 'hono';
import { mudarComAuditoria } from '../db/transicao.js';
import { verificarTexto } from '../barreira.js';

export const demandas = new Hono();

const LIMITE_LISTA = 500;
const ID_DEMANDA = /^D-\d{3,}$/;
// Único conjunto de campos que o app edita numa demanda. O resto (status, estado, título, contrato…) nunca passa por aqui.
const EDITAVEIS = { prazo: 'prazo', responsavel: 'responsavel', pendenciaNota: 'pendencia_nota', proximoPasso: 'proximo_passo' };
const LIMITES = { responsavel: 120, pendenciaNota: 500, proximoPasso: 500 };
const ROTULOS = { prazo: 'prazo', responsavel: 'responsável', pendenciaNota: 'pendência', proximoPasso: 'próximo passo' };

const objetoSimples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (c, campo, erro, motivo) => c.json({ erro, campo, ...(motivo ? { motivo } : {}) }, 422);

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  const ano = Number(s.slice(0, 4));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && ano >= 2020 && ano <= 2100;
}

// Cartão do quadro: só o necessário, nunca o estado inteiro nem o texto bruto da trilha.
const SELECAO = `d.id, d.titulo, d.status, d.cliente_texto, d.contrato_id, k.marca, d.caminho, d.modo, d.custo_alto, d.versao, d.devolucoes,
  d.n_eventos, d.ultimo_evento_em, d.prazo, d.responsavel, d.pendencia_nota, d.proximo_passo`;

const cartao = (r) => ({
  id: r.id,
  titulo: r.titulo,
  status: r.status,
  clienteTexto: r.cliente_texto,
  contratoId: r.contrato_id,
  marca: r.marca ?? null,
  semContrato: !r.contrato_id,
  caminho: r.caminho,
  modo: r.modo,
  custoAlto: !!r.custo_alto,
  versao: r.versao,
  devolucoes: r.devolucoes,
  nEventos: r.n_eventos,
  ultimoEventoEm: r.ultimo_evento_em,
  prazo: r.prazo,
  responsavel: r.responsavel,
  pendenciaNota: r.pendencia_nota,
  proximoPasso: r.proximo_passo,
});

const FROM = 'FROM demanda d LEFT JOIN contrato k ON k.id = d.contrato_id';
const buscarCartao = async (DB, id) => {
  const r = await DB.prepare(`SELECT ${SELECAO} ${FROM} WHERE d.id = ?`).bind(id).first();
  return r ? cartao(r) : null;
};

demandas.get('/demandas', async (c) => {
  const q = c.req.query();
  const onde = [];
  const binds = [];
  // Busca por trecho com instr (sem % nem _ como curinga). Maiúsculas/minúsculas só valem para letras sem acento (SQLite).
  if (q.cliente) {
    onde.push("(instr(lower(coalesce(d.cliente_texto, '')), lower(?)) > 0 OR instr(lower(coalesce(k.marca, '')), lower(?)) > 0)");
    binds.push(q.cliente.slice(0, 100), q.cliente.slice(0, 100));
  }
  if (q.contrato) {
    onde.push('d.contrato_id = ?');
    binds.push(q.contrato.slice(0, 100));
  }
  if (q.caminho) {
    onde.push('d.caminho = ?');
    binds.push(q.caminho.slice(0, 100));
  }
  if (q.responsavel) {
    onde.push("instr(lower(coalesce(d.responsavel, '')), lower(?)) > 0");
    binds.push(q.responsavel.slice(0, 120));
  }
  if (q.status) {
    onde.push('d.status = ?');
    binds.push(q.status.slice(0, 100));
  }
  if (q.semContrato === '1') onde.push('d.contrato_id IS NULL');
  const filtro = onde.length ? `WHERE ${onde.join(' AND ')}` : '';

  const DB = c.env.DB;
  const [lista, contagem] = await Promise.all([
    DB.prepare(`SELECT ${SELECAO} ${FROM} ${filtro} ORDER BY d.ultimo_evento_em DESC, d.id DESC LIMIT ${LIMITE_LISTA + 1}`).bind(...binds).all(),
    DB.prepare(`SELECT d.status AS status, COUNT(*) AS total ${FROM} ${filtro} GROUP BY d.status`).bind(...binds).all(),
  ]);
  return c.json({
    itens: lista.results.slice(0, LIMITE_LISTA).map(cartao),
    truncado: lista.results.length > LIMITE_LISTA,
    contagens: Object.fromEntries(contagem.results.map((r) => [r.status, r.total])),
  });
});

const lerJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

demandas.get('/demandas/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_DEMANDA.test(id)) return c.json({ erro: 'demanda não encontrada' }, 404);
  const DB = c.env.DB;
  const d = await DB.prepare(`SELECT ${SELECAO}, d.estado, d.verificacao ${FROM} WHERE d.id = ?`).bind(id).first();
  if (!d) return c.json({ erro: 'demanda não encontrada' }, 404);
  const eventos = (
    await DB.prepare('SELECT n, ts, cmd, ator, dados, prev, hash, assinatura FROM trilha_evento WHERE demanda_id = ? ORDER BY n').bind(id).all()
  ).results.map((e) => ({ n: e.n, ts: e.ts, cmd: e.cmd, ator: e.ator, dados: lerJson(e.dados), prev: e.prev, hash: e.hash, assinado: !!e.assinatura }));
  return c.json({ demanda: cartao(d), estado: lerJson(d.estado), verificacao: d.verificacao, eventos });
});

// Edita só as anotações do app. Status e tudo o que vem da trilha são recusados.
demandas.patch('/demandas/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_DEMANDA.test(id)) return c.json({ erro: 'demanda não encontrada' }, 404);
  const DB = c.env.DB;
  const atual = await DB.prepare('SELECT prazo, responsavel, pendencia_nota, proximo_passo FROM demanda WHERE id = ?').bind(id).first();
  if (!atual) return c.json({ erro: 'demanda não encontrada' }, 404);

  const corpo = await c.req.json().catch(() => null);
  if (!objetoSimples(corpo)) return falha(c, 'corpo', 'envie os campos a alterar');
  for (const campo of Object.keys(corpo)) {
    if (!(campo in EDITAVEIS)) return falha(c, campo, `"${campo}" não pode ser alterado aqui: o status e os dados da trilha vêm só do trilha.py`);
  }

  const novos = {};
  for (const campo of Object.keys(EDITAVEIS)) {
    if (!Object.prototype.hasOwnProperty.call(corpo, campo)) continue;
    const v = corpo[campo];
    if (v === null || v === undefined) {
      novos[campo] = null;
      continue;
    }
    if (typeof v !== 'string') return falha(c, campo, `${ROTULOS[campo]}: envie texto`);
    const texto = v.trim();
    if (campo === 'prazo') {
      if (texto !== '' && !dataValida(texto)) return falha(c, campo, 'prazo: informe uma data real no formato AAAA-MM-DD (entre 2020 e 2100)');
    } else {
      if (texto.length > LIMITES[campo]) return falha(c, campo, `${ROTULOS[campo]}: use até ${LIMITES[campo]} caracteres`);
      const barrado = texto === '' ? null : verificarTexto(texto);
      if (barrado) return falha(c, campo, `Dado sensível em "${ROTULOS[campo]}": ${barrado.motivo}. Não registre dado de paciente, senha ou chave aqui.`, barrado.motivo);
    }
    novos[campo] = texto === '' ? null : texto;
  }

  const mudou = Object.keys(novos).filter((campo) => novos[campo] !== atual[EDITAVEIS[campo]]);
  if (mudou.length === 0) return c.json({ demanda: await buscarCartao(DB, id) });

  const ok = await mudarComAuditoria(DB, {
    tabela: 'demanda',
    id,
    mudanca: Object.fromEntries(mudou.map((campo) => [EDITAVEIS[campo], novos[campo]])),
    // Só vale se as quatro anotações ainda estiverem como foram lidas (outra aba não é atropelada).
    condicao: 'prazo IS ? AND responsavel IS ? AND pendencia_nota IS ? AND proximo_passo IS ?',
    condicaoBinds: [atual.prazo, atual.responsavel, atual.pendencia_nota, atual.proximo_passo],
    usuario: c.get('usuario').email,
    acao: 'alterar',
    entidade: 'demanda',
    antes: Object.fromEntries(mudou.map((campo) => [campo, atual[EDITAVEIS[campo]]])),
    depois: Object.fromEntries(mudou.map((campo) => [campo, novos[campo]])),
  });
  if (!ok) return c.json({ erro: 'a demanda mudou enquanto você editava; recarregue a tela' }, 409);
  return c.json({ demanda: await buscarCartao(DB, id) });
});

// Liga uma demanda "sem contrato" a um contrato ativo. Não existe desligar.
demandas.post('/demandas/:id/ligar-contrato', async (c) => {
  const id = c.req.param('id');
  if (!ID_DEMANDA.test(id)) return c.json({ erro: 'demanda não encontrada' }, 404);
  const DB = c.env.DB;
  const d = await DB.prepare('SELECT contrato_id FROM demanda WHERE id = ?').bind(id).first();
  if (!d) return c.json({ erro: 'demanda não encontrada' }, 404);

  const corpo = await c.req.json().catch(() => null);
  const contratoId = objetoSimples(corpo) ? corpo.contratoId : undefined;
  if (typeof contratoId !== 'string' || contratoId.trim() === '' || contratoId.length > 100) return falha(c, 'contratoId', 'escolha o contrato');

  const k = await DB.prepare('SELECT id, status FROM contrato WHERE id = ?').bind(contratoId).first();
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);
  if (d.contrato_id) return c.json({ erro: 'esta demanda já está ligada a um contrato' }, 409);
  if (k.status !== 'ativo') return c.json({ erro: 'contrato encerrado não recebe demanda' }, 409);

  const ok = await mudarComAuditoria(DB, {
    tabela: 'demanda',
    id,
    mudanca: { contrato_id: contratoId },
    condicao: "contrato_id IS NULL AND EXISTS (SELECT 1 FROM contrato WHERE contrato.id = ? AND contrato.status = 'ativo')",
    condicaoBinds: [contratoId],
    usuario: c.get('usuario').email,
    acao: 'ligar_contrato',
    entidade: 'demanda',
    antes: { contratoId: null },
    depois: { contratoId },
  });
  if (!ok) return c.json({ erro: 'a demanda mudou enquanto você agia; recarregue a tela' }, 409);
  return c.json({ demanda: await buscarCartao(DB, id) });
});
