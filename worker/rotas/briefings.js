import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, max } from 'drizzle-orm';
import { contrato, briefing } from '../db/schema.js';
import { gravarComAuditoria } from '../db/auditoria.js';
import { verificarCampos } from '../barreira.js';

export const briefings = new Hono();

const LIMITE_TEXTO = 20000;
const TENTATIVAS = 4;
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
  const conteudo = typeof corpo.conteudo === 'string' ? corpo.conteudo.trim() : '';
  if (!conteudo || conteudo.length > LIMITE_TEXTO) {
    return c.json({ erro: 'escreva o briefing, com até 20.000 caracteres', campo: 'conteudo' }, 422);
  }
  const barrado = verificarCampos({ conteudo });
  if (barrado) {
    const onde = barrado.linha ? ` (na linha ${barrado.linha})` : '';
    return c.json({ erro: `Dado sensível no briefing${onde}: ${barrado.motivo}.`, campo: 'conteudo', motivo: barrado.motivo, ...(barrado.linha ? { linha: barrado.linha } : {}) }, 422);
  }

  const usuario = c.get('usuario').email;
  const id = crypto.randomUUID();
  // O número da versão sai do banco. Se dois envios chegarem juntos, o índice único derruba um deles
  // (junto com a auditoria dele) e ele tenta de novo com o número seguinte.
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const [{ ultima }] = await db.select({ ultima: max(briefing.versao) }).from(briefing).where(eq(briefing.contratoId, k.id));
    const versao = (ultima ?? 0) + 1;
    try {
      await gravarComAuditoria(
        db,
        { usuario, acao: 'criar', entidade: 'briefing', entidadeId: id, antes: null, depois: { contratoId: k.id, versao, tamanho: conteudo.length } },
        db.insert(briefing).values({ id, chave, contratoId: k.id, versao, conteudo, criadoPor: usuario }),
      );
      const [criado] = await db.select().from(briefing).where(eq(briefing.id, id));
      return c.json(publico(criado), 201);
    } catch (e) {
      const [jaCriado] = await db.select().from(briefing).where(eq(briefing.chave, chave));
      if (jaCriado && jaCriado.contratoId === k.id) return c.json(publico(jaCriado), 200);
      if (tentativa === TENTATIVAS) throw e;
    }
  }
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

  const usuario = c.get('usuario').email;
  await gravarComAuditoria(
    db,
    { usuario, acao: 'confirmar', entidade: 'briefing', entidadeId: b.id, antes: { confirmadoEm: null }, depois: { versao: b.versao, confirmadoEm: data } },
    db.update(briefing).set({ confirmadoEm: data, confirmadoPor: usuario }).where(eq(briefing.id, b.id)),
  );
  const [novo] = await db.select().from(briefing).where(eq(briefing.id, b.id));
  return c.json(publico(novo));
});
