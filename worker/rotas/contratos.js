import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
import { cliente, contrato } from '../db/schema.js';
import { gravarComAuditoria } from '../db/auditoria.js';
import { verificarCampos } from '../barreira.js';

export const contratos = new Hono();

const TIPOS = ['só marketing', 'só produto', 'produto + marketing'];
const LIMITE = 120;
const LIMITE_ESCOPO = 500;
const VERBA_MAXIMA = 100_000_000_00; // R$ 100 milhões, em centavos

const publico = ({ chave, ...resto }) => resto;

// Autorizada = tem data de autorização e não foi revogada depois.
const autorizada = (k) => Boolean(k.leituraAutorizadaEm) && !k.leituraRevogadaEm;

// Pendência = campo desconhecido. Fim do período vazio significa "sem data de término", não pendência.
export function pendenciasContrato(k) {
  return ['escopo', 'verbaCentavos', 'periodoInicio', 'contatoAprovador'].filter((campo) => k[campo] === null);
}
const completo = (k) => ({ ...publico(k), pendencias: pendenciasContrato(k), leituraAutorizada: autorizada(k) });

const falha = (c, campo, mensagem, motivo) => c.json({ erro: mensagem, campo, ...(motivo ? { motivo } : {}) }, 422);

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Valida o corpo. `parcial` = edição: só confere o que veio. `atual` = contrato existente (para cruzar as datas).
function validar(corpo, parcial, atual = {}) {
  const tem = (k) => Object.prototype.hasOwnProperty.call(corpo, k);
  const saida = {};

  if (!parcial || tem('marca')) {
    const marca = typeof corpo.marca === 'string' ? corpo.marca.trim() : '';
    if (!marca || marca.length > LIMITE) return { falha: ['marca', 'informe a marca com até 120 caracteres'] };
    saida.marca = marca;
  }
  if (!parcial || tem('tipo')) {
    if (!TIPOS.includes(corpo.tipo)) return { falha: ['tipo', 'escolha só marketing, só produto ou produto + marketing'] };
    saida.tipo = corpo.tipo;
  }
  for (const [k, max, rotulo] of [['escopo', LIMITE_ESCOPO, 'escopo'], ['contatoAprovador', LIMITE, 'contato que aprova']]) {
    if (!tem(k)) continue;
    const v = corpo[k];
    if (v === null) saida[k] = null;
    else if (typeof v !== 'string' || v.trim().length > max) return { falha: [k, `${rotulo}: use até ${max} caracteres`] };
    else saida[k] = v.trim();
  }
  if (tem('verbaCentavos')) {
    const v = corpo.verbaCentavos;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > VERBA_MAXIMA)) return { falha: ['verbaCentavos', 'informe a verba em reais, sem valor negativo'] };
    saida.verbaCentavos = v;
  }
  for (const k of ['periodoInicio', 'periodoFim']) {
    if (!tem(k)) continue;
    const v = corpo[k];
    if (v !== null && !dataValida(v)) return { falha: [k, 'informe uma data válida'] };
    saida[k] = v;
  }
  const inicio = tem('periodoInicio') ? saida.periodoInicio : atual.periodoInicio;
  const fim = tem('periodoFim') ? saida.periodoFim : atual.periodoFim;
  if (inicio && fim && fim < inicio) return { falha: ['periodoFim', 'o fim do período não pode ser antes do início'] };

  const barrado = verificarCampos(saida);
  if (barrado) return { falha: [barrado.campo, `Dado sensível em "${barrado.campo}": ${barrado.motivo}.`, barrado.motivo] };
  return { dados: saida };
}

const agora = () => new Date().toISOString();

async function carregar(c) {
  const [k] = await drizzle(c.env.DB).select().from(contrato).where(eq(contrato.id, c.req.param('id')));
  return k;
}

contratos.get('/clientes/:id/contratos', async (c) => {
  const db = drizzle(c.env.DB);
  const [cli] = await db.select().from(cliente).where(eq(cliente.id, c.req.param('id')));
  if (!cli) return c.json({ erro: 'cliente não encontrado' }, 404);
  const linhas = await db.select().from(contrato).where(eq(contrato.clienteId, cli.id)).orderBy(desc(contrato.criadoEm));
  return c.json(linhas.map(completo));
});

contratos.post('/clientes/:id/contratos', async (c) => {
  const chave = c.req.header('idempotency-key');
  if (!chave || chave.length > 100) return c.json({ erro: 'falta a chave de envio (Idempotency-Key)' }, 400);

  const db = drizzle(c.env.DB);
  const [cli] = await db.select().from(cliente).where(eq(cliente.id, c.req.param('id')));
  if (!cli) return c.json({ erro: 'cliente não encontrado' }, 404);

  const [repetido] = await db.select().from(contrato).where(eq(contrato.chave, chave));
  if (repetido) return c.json(completo(repetido), 200);
  if (cli.arquivadoEm) return c.json({ erro: 'cliente arquivado: restaure antes de criar contrato' }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const v = validar(corpo, false);
  if (v.falha) return falha(c, ...v.falha);

  const id = crypto.randomUUID();
  const novo = {
    id,
    chave,
    clienteId: cli.id,
    escopo: null,
    verbaCentavos: null,
    periodoInicio: null,
    periodoFim: null,
    contatoAprovador: null,
    status: 'ativo',
    encerradoEm: null,
    leituraAutorizadaEm: null,
    leituraAutorizadaPor: null,
    leituraRevogadaEm: null,
    ...v.dados,
  };
  try {
    await gravarComAuditoria(
      db,
      { usuario: c.get('usuario').email, acao: 'criar', entidade: 'contrato', entidadeId: id, antes: null, depois: v.dados },
      db.insert(contrato).values(novo),
    );
  } catch (e) {
    const [jaCriado] = await db.select().from(contrato).where(eq(contrato.chave, chave));
    if (jaCriado) return c.json(completo(jaCriado), 200);
    throw e;
  }
  const [criado] = await db.select().from(contrato).where(eq(contrato.id, id));
  return c.json(completo(criado), 201);
});

contratos.get('/contratos/:id', async (c) => {
  const k = await carregar(c);
  return k ? c.json(completo(k)) : c.json({ erro: 'contrato não encontrado' }, 404);
});

contratos.patch('/contratos/:id', async (c) => {
  const k = await carregar(c);
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);
  if (k.status === 'encerrado') return c.json({ erro: 'contrato encerrado não pode ser editado' }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const v = validar(corpo, true, k);
  if (v.falha) return falha(c, ...v.falha);

  // Só o que realmente mudou entra na auditoria.
  const mudou = Object.keys(v.dados).filter((campo) => v.dados[campo] !== k[campo]);
  if (mudou.length === 0) return c.json(completo(k));
  const antes = Object.fromEntries(mudou.map((campo) => [campo, k[campo]]));
  const depois = Object.fromEntries(mudou.map((campo) => [campo, v.dados[campo]]));

  const db = drizzle(c.env.DB);
  await gravarComAuditoria(
    db,
    { usuario: c.get('usuario').email, acao: 'alterar', entidade: 'contrato', entidadeId: k.id, antes, depois },
    db.update(contrato).set({ ...depois, atualizadoEm: agora() }).where(eq(contrato.id, k.id)),
  );
  const [novo] = await db.select().from(contrato).where(eq(contrato.id, k.id));
  return c.json(completo(novo));
});

contratos.post('/contratos/:id/autorizar-leitura', async (c) => {
  const k = await carregar(c);
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);
  if (k.status === 'encerrado') return c.json({ erro: 'contrato encerrado não aceita autorização' }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const por = typeof corpo.autorizadaPor === 'string' ? corpo.autorizadaPor.trim() : '';
  if (!por || por.length > LIMITE) return falha(c, 'autorizadaPor', 'informe o nome de quem autorizou (até 120 caracteres)');
  const barrado = verificarCampos({ autorizadaPor: por });
  if (barrado) return falha(c, 'autorizadaPor', `Dado sensível em "autorizadaPor": ${barrado.motivo}.`, barrado.motivo);

  const db = drizzle(c.env.DB);
  const mudanca = { leituraAutorizadaEm: agora(), leituraAutorizadaPor: por, leituraRevogadaEm: null };
  await gravarComAuditoria(
    db,
    {
      usuario: c.get('usuario').email,
      acao: 'autorizar_leitura',
      entidade: 'contrato',
      entidadeId: k.id,
      antes: { leituraAutorizada: autorizada(k) },
      depois: { leituraAutorizada: true, autorizadaPor: por },
    },
    db.update(contrato).set({ ...mudanca, atualizadoEm: agora() }).where(eq(contrato.id, k.id)),
  );
  const [novo] = await db.select().from(contrato).where(eq(contrato.id, k.id));
  return c.json(completo(novo));
});

contratos.post('/contratos/:id/revogar-leitura', async (c) => {
  const k = await carregar(c);
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);
  if (!autorizada(k)) return c.json({ erro: 'não há autorização de leitura ativa' }, 409);

  const db = drizzle(c.env.DB);
  const quando = agora();
  await gravarComAuditoria(
    db,
    {
      usuario: c.get('usuario').email,
      acao: 'revogar_leitura',
      entidade: 'contrato',
      entidadeId: k.id,
      antes: { leituraAutorizada: true },
      depois: { leituraAutorizada: false },
    },
    db.update(contrato).set({ leituraRevogadaEm: quando, atualizadoEm: quando }).where(eq(contrato.id, k.id)),
  );
  const [novo] = await db.select().from(contrato).where(eq(contrato.id, k.id));
  return c.json(completo(novo));
});

contratos.post('/contratos/:id/encerrar', async (c) => {
  const k = await carregar(c);
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);
  if (k.status === 'encerrado') return c.json({ erro: 'contrato já está encerrado' }, 409);

  const db = drizzle(c.env.DB);
  const quando = agora();
  // Encerrar também revoga a leitura dos anúncios, para a coleta nunca rodar em contrato encerrado.
  const mudanca = { status: 'encerrado', encerradoEm: quando, atualizadoEm: quando, ...(autorizada(k) ? { leituraRevogadaEm: quando } : {}) };
  await gravarComAuditoria(
    db,
    {
      usuario: c.get('usuario').email,
      acao: 'encerrar',
      entidade: 'contrato',
      entidadeId: k.id,
      antes: { status: k.status, leituraAutorizada: autorizada(k) },
      depois: { status: 'encerrado', leituraAutorizada: false },
    },
    db.update(contrato).set(mudanca).where(eq(contrato.id, k.id)),
  );
  const [novo] = await db.select().from(contrato).where(eq(contrato.id, k.id));
  return c.json(completo(novo));
});
