import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
import { contrato, integracao, TIPOS_INTEGRACAO } from '../db/schema.js';
import { gravarComAuditoria } from '../db/auditoria.js';
import { mudarComAuditoria } from '../db/transicao.js';
import { verificarTexto, verificarIdentificador } from '../barreira.js';

export const integracoes = new Hono();

const LIMITES = { idExterno: 200, dono: 120, oQueFalta: 300 };
const ROTULOS = { idExterno: 'identificador', dono: 'dono', oQueFalta: 'o que falta' };
const publico = ({ chave, ...resto }) => resto;
const hojeEmBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const CONTRATO_ATIVO = `EXISTS (SELECT 1 FROM contrato WHERE contrato.id = integracao.contrato_id AND contrato.status = 'ativo')`;

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const falha = (c, campo, mensagem, motivo) => c.json({ erro: mensagem, campo, ...(motivo ? { motivo } : {}) }, 422);

// Valida os campos informados. Vazio vira null ("a confirmar"). Identificador passa pela barreira própria.
function validar(corpo, { criando }) {
  const tem = (k) => Object.prototype.hasOwnProperty.call(corpo, k);
  const dados = {};
  if (criando && !TIPOS_INTEGRACAO.includes(corpo.tipo)) return { falha: ['tipo', `escolha um tipo: ${TIPOS_INTEGRACAO.join(', ')}`] };
  if (criando) dados.tipo = corpo.tipo;

  for (const campo of ['idExterno', 'dono', 'oQueFalta']) {
    if (!tem(campo)) continue;
    const v = corpo[campo];
    if (v === null || v === undefined) {
      dados[campo] = null;
      continue;
    }
    if (typeof v !== 'string' || v.trim().length > LIMITES[campo]) return { falha: [campo, `${ROTULOS[campo]}: use até ${LIMITES[campo]} caracteres`] };
    const texto = v.trim();
    const barrado = (campo === 'idExterno' ? verificarIdentificador : verificarTexto)(texto);
    if (barrado) {
      const msg = campo === 'idExterno'
        ? `O identificador parece um segredo (${barrado.motivo}). Informe só o id público da conta, nunca senha, token ou chave.`
        : `Dado sensível em "${ROTULOS[campo]}": ${barrado.motivo}.`;
      return { falha: [campo, msg, barrado.motivo] };
    }
    dados[campo] = texto === '' ? null : texto;
  }
  return { dados };
}

const resumir = (itens) => ({
  pendente: itens.filter((i) => i.estado === 'pendente').length,
  verificada: itens.filter((i) => i.estado === 'verificada').length,
  revogada: itens.filter((i) => i.estado === 'revogada').length,
});

const carregarContrato = async (c, id) => (await drizzle(c.env.DB).select().from(contrato).where(eq(contrato.id, id)))[0];
const carregar = async (c) => (await drizzle(c.env.DB).select().from(integracao).where(eq(integracao.id, c.req.param('id'))))[0];
const relido = async (c, id) => publico((await drizzle(c.env.DB).select().from(integracao).where(eq(integracao.id, id)))[0]);

integracoes.get('/contratos/:id/integracoes', async (c) => {
  const k = await carregarContrato(c, c.req.param('id'));
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);
  const itens = await drizzle(c.env.DB).select().from(integracao).where(eq(integracao.contratoId, k.id)).orderBy(desc(integracao.criadoEm));
  return c.json({ itens: itens.map(publico), resumo: resumir(itens) });
});

integracoes.post('/contratos/:id/integracoes', async (c) => {
  const chave = c.req.header('idempotency-key');
  if (!chave || chave.length > 100) return c.json({ erro: 'falta a chave de envio (Idempotency-Key)' }, 400);

  const db = drizzle(c.env.DB);
  const k = await carregarContrato(c, c.req.param('id'));
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);

  const [repetido] = await db.select().from(integracao).where(eq(integracao.chave, chave));
  if (repetido) {
    if (repetido.contratoId !== k.id) return c.json({ erro: 'chave de envio já usada em outro cadastro' }, 409);
    return c.json(publico(repetido), 200);
  }
  if (k.status === 'encerrado') return c.json({ erro: 'contrato encerrado não recebe integração' }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const v = validar(corpo, { criando: true });
  if (v.falha) return falha(c, ...v.falha);

  const id = crypto.randomUUID();
  const novo = { id, chave, contratoId: k.id, idExterno: null, dono: null, oQueFalta: null, estado: 'pendente', verificadaEm: null, revogadaEm: null, ...v.dados };
  try {
    await gravarComAuditoria(
      db,
      { usuario: c.get('usuario').email, acao: 'criar', entidade: 'integracao', entidadeId: id, antes: null, depois: { contratoId: k.id, ...v.dados } },
      db.insert(integracao).values(novo),
    );
  } catch (e) {
    const [jaCriado] = await db.select().from(integracao).where(eq(integracao.chave, chave));
    if (jaCriado) {
      if (jaCriado.contratoId !== k.id) return c.json({ erro: 'chave de envio já usada em outro cadastro' }, 409);
      return c.json(publico(jaCriado), 200);
    }
    // Sem chave repetida, o motivo mais provável é o índice único: mesmo tipo e identificador no mesmo contrato.
    if (novo.idExterno !== null) return c.json({ erro: 'já existe uma integração deste tipo com este identificador neste contrato', campo: 'idExterno' }, 409);
    throw e;
  }
  return c.json(await relido(c, id), 201);
});

integracoes.patch('/integracoes/:id', async (c) => {
  const i = await carregar(c);
  if (!i) return c.json({ erro: 'integração não encontrada' }, 404);
  if (i.estado === 'revogada') return c.json({ erro: 'integração revogada não pode ser editada; reative antes' }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const v = validar(corpo, { criando: false });
  if (v.falha) return falha(c, ...v.falha);

  const mudou = Object.keys(v.dados).filter((campo) => v.dados[campo] !== i[campo]);
  if (mudou.length === 0) return c.json(publico(i));
  const antes = Object.fromEntries(mudou.map((campo) => [campo, i[campo]]));
  const depois = Object.fromEntries(mudou.map((campo) => [campo, v.dados[campo]]));

  // Trocar o identificador invalida a verificação, que valia para o id antigo.
  const mudanca = { ...Object.fromEntries(mudou.map((campo) => [{ idExterno: 'id_externo', dono: 'dono', oQueFalta: 'o_que_falta' }[campo], v.dados[campo]])), atualizado_em: new Date().toISOString() };
  if (mudou.includes('idExterno') && i.estado === 'verificada') {
    mudanca.estado = 'pendente';
    mudanca.verificada_em = null;
    depois.estado = 'pendente';
    antes.estado = 'verificada';
  }

  let ok;
  try {
    ok = await mudarComAuditoria(c.env.DB, {
      tabela: 'integracao',
      id: i.id,
      mudanca,
      condicao: `estado != 'revogada' AND ${CONTRATO_ATIVO}`,
      usuario: c.get('usuario').email,
      acao: 'alterar',
      entidade: 'integracao',
      antes,
      depois,
    });
  } catch {
    return c.json({ erro: 'já existe uma integração deste tipo com este identificador neste contrato', campo: 'idExterno' }, 409);
  }
  if (!ok) return c.json({ erro: 'integração revogada ou contrato encerrado: não é possível editar' }, 409);
  return c.json(await relido(c, i.id));
});

// Troca de estado atômica: só vale se o estado de partida ainda for o esperado e o contrato estiver ativo.
async function transicao(c, { de, para, acao, extra = () => ({}), exigir }) {
  const i = await carregar(c);
  if (!i) return c.json({ erro: 'integração não encontrada' }, 404);
  const k = await carregarContrato(c, i.contratoId);
  if (k?.status === 'encerrado') return c.json({ erro: 'contrato encerrado não aceita mudança de integração' }, 409);
  if (!de.includes(i.estado)) return c.json({ erro: `não é possível ${acao}: a integração está ${i.estado}` }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const extras = extra(i, corpo);
  if (extras.falha) return falha(c, ...extras.falha);
  if (exigir) {
    const msg = exigir(i);
    if (msg) return c.json({ erro: msg }, 409);
  }

  const agora = new Date().toISOString();
  const ok = await mudarComAuditoria(c.env.DB, {
    tabela: 'integracao',
    id: i.id,
    mudanca: { estado: para, atualizado_em: agora, ...extras.mudanca },
    condicao: `estado IN (${de.map((e) => `'${e}'`).join(', ')}) AND ${CONTRATO_ATIVO}`,
    usuario: c.get('usuario').email,
    acao,
    entidade: 'integracao',
    antes: { estado: i.estado },
    depois: { estado: para, ...(extras.auditoria ?? {}) },
  });
  if (!ok) return c.json({ erro: 'a integração mudou enquanto você agia; recarregue a tela' }, 409);
  return c.json(await relido(c, i.id));
}

integracoes.post('/integracoes/:id/verificar', (c) =>
  transicao(c, {
    de: ['pendente'],
    para: 'verificada',
    acao: 'verificar',
    exigir: (i) => (i.idExterno === null ? 'preencha o identificador antes de verificar' : null),
    extra: (_i, corpo) => {
      const data = corpo.verificadaEm ?? hojeEmBrasilia();
      if (!dataValida(data)) return { falha: ['verificadaEm', 'informe a data no formato AAAA-MM-DD'] };
      if (data > hojeEmBrasilia()) return { falha: ['verificadaEm', 'a data da verificação não pode ser no futuro'] };
      return { mudanca: { verificada_em: data, revogada_em: null }, auditoria: { verificadaEm: data } };
    },
  }),
);

integracoes.post('/integracoes/:id/revogar', (c) =>
  transicao(c, {
    de: ['pendente', 'verificada'],
    para: 'revogada',
    acao: 'revogar',
    extra: () => ({ mudanca: { revogada_em: new Date().toISOString() } }),
  }),
);

integracoes.post('/integracoes/:id/reativar', (c) =>
  transicao(c, {
    de: ['revogada'],
    para: 'pendente',
    acao: 'reativar',
    extra: () => ({ mudanca: { verificada_em: null, revogada_em: null } }),
  }),
);
