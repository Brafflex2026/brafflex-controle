import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, sql } from 'drizzle-orm';
import { contrato, briefing } from '../db/schema.js';
import { gravarComAuditoria } from '../db/auditoria.js';
import { verificarCampos } from '../barreira.js';

export const briefings = new Hono();

const LIMITE_TEXTO = 20000;
const publico = ({ chave, ...resto }) => resto;
const hojeEmBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

briefings.get('/contratos/:id/briefings', async (c) => {
  const db = drizzle(c.env.DB);
  const [k] = await db.select().from(contrato).where(eq(contrato.id, c.req.param('id')));
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);
  const linhas = await db.select().from(briefing).where(eq(briefing.contratoId, k.id)).orderBy(desc(briefing.versao));
  return c.json(linhas.map(publico));
});

briefings.post('/contratos/:id/briefings', async (c) => {
  const chave = c.req.header('idempotency-key');
  if (!chave || chave.length > 100) return c.json({ erro: 'falta a chave de envio (Idempotency-Key)' }, 400);

  const db = drizzle(c.env.DB);
  const [k] = await db.select().from(contrato).where(eq(contrato.id, c.req.param('id')));
  if (!k) return c.json({ erro: 'contrato não encontrado' }, 404);

  const [repetido] = await db.select().from(briefing).where(eq(briefing.chave, chave));
  if (repetido) {
    if (repetido.contratoId !== k.id) return c.json({ erro: 'chave de envio já usada em outro cadastro' }, 409);
    return c.json(publico(repetido), 200);
  }
  if (k.status === 'encerrado') return c.json({ erro: 'contrato encerrado não recebe novo briefing' }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const original = typeof corpo.conteudo === 'string' ? corpo.conteudo : '';
  const conteudo = original.trim();
  if (!conteudo || original.length > LIMITE_TEXTO) {
    return c.json({ erro: 'escreva o briefing, com até 20.000 caracteres', campo: 'conteudo' }, 422);
  }
  // A barreira olha o texto como foi digitado, para a linha informada bater com a caixa de texto.
  const barrado = verificarCampos({ conteudo: original });
  if (barrado) {
    const onde = barrado.linha ? ` (na linha ${barrado.linha})` : '';
    return c.json({ erro: `Dado sensível no briefing${onde}: ${barrado.motivo}.`, campo: 'conteudo', motivo: barrado.motivo, ...(barrado.linha ? { linha: barrado.linha } : {}) }, 422);
  }

  const usuario = c.get('usuario').email;
  const id = crypto.randomUUID();
  // O número da versão é calculado dentro do próprio INSERT (um comando só, atômico no banco), então envios
  // simultâneos nunca recebem o mesmo número. O índice único (contrato, versão) fica como segunda proteção.
  const proximaVersao = sql`(SELECT COALESCE(MAX(${briefing.versao}), 0) + 1 FROM ${briefing} WHERE ${briefing.contratoId} = ${k.id})`;
  try {
    await gravarComAuditoria(
      db,
      { usuario, acao: 'criar', entidade: 'briefing', entidadeId: id, antes: null, depois: { contratoId: k.id, tamanho: conteudo.length } },
      db.insert(briefing).values({ id, chave, contratoId: k.id, versao: proximaVersao, conteudo, criadoPor: usuario }),
    );
  } catch (e) {
    // Mesmo envio repetido ao mesmo tempo: devolve o que o primeiro criou. Chave de outro contrato: 409.
    const [jaCriado] = await db.select().from(briefing).where(eq(briefing.chave, chave));
    if (jaCriado) {
      if (jaCriado.contratoId !== k.id) return c.json({ erro: 'chave de envio já usada em outro cadastro' }, 409);
      return c.json(publico(jaCriado), 200);
    }
    throw e;
  }
  const [criado] = await db.select().from(briefing).where(eq(briefing.id, id));
  return c.json(publico(criado), 201);
});

briefings.post('/briefings/:id/confirmar', async (c) => {
  const db = drizzle(c.env.DB);
  const [b] = await db.select().from(briefing).where(eq(briefing.id, c.req.param('id')));
  if (!b) return c.json({ erro: 'briefing não encontrado' }, 404);
  const [k] = await db.select().from(contrato).where(eq(contrato.id, b.contratoId));
  if (k?.status === 'encerrado') return c.json({ erro: 'contrato encerrado não aceita confirmação' }, 409);
  if (b.confirmadoEm) return c.json({ erro: 'esta versão já foi confirmada' }, 409);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const data = corpo.confirmadoEm ?? hojeEmBrasilia();
  if (!dataValida(data)) return c.json({ erro: 'informe a data do “é isso” no formato AAAA-MM-DD', campo: 'confirmadoEm' }, 422);
  if (data > hojeEmBrasilia()) return c.json({ erro: 'a data do “é isso” não pode ser no futuro', campo: 'confirmadoEm' }, 422);

  // Confirmação e auditoria no mesmo lote, ambas só se a versão AINDA estiver sem confirmação e o contrato
  // ainda ativo. Assim, duas confirmações simultâneas ou um encerramento no meio não passam as duas.
  const usuario = c.get('usuario').email;
  const condicao = `confirmado_em IS NULL AND EXISTS (SELECT 1 FROM contrato WHERE contrato.id = briefing.contrato_id AND contrato.status = 'ativo')`;
  const agora = new Date().toISOString();
  const resultados = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois)
       SELECT ?, ?, 'confirmar', 'briefing', id, ?, ? FROM briefing WHERE id = ? AND ${condicao}`,
    ).bind(agora, usuario, JSON.stringify({ confirmadoEm: null }), JSON.stringify({ versao: b.versao, confirmadoEm: data }), b.id),
    c.env.DB.prepare(`UPDATE briefing SET confirmado_em = ?, confirmado_por = ? WHERE id = ? AND ${condicao}`).bind(data, usuario, b.id),
  ]);
  if (resultados[1].meta.changes !== 1) return c.json({ erro: 'esta versão já foi confirmada ou o contrato foi encerrado' }, 409);
  const [novo] = await db.select().from(briefing).where(eq(briefing.id, b.id));
  return c.json(publico(novo));
});
