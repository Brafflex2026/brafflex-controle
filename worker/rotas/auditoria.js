import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, gte, lt, desc, sql } from 'drizzle-orm';
import { auditoriaApp } from '../db/schema.js';

export const auditoria = new Hono();

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 100;
// Brasília é UTC−3 o ano todo (sem horário de verão desde 2019). Se o horário de verão voltar, revisar aqui.
const FUSO = '-03:00';

const lerJson = (valor) => {
  if (valor === null || valor === undefined) return null;
  try {
    return JSON.parse(valor);
  } catch {
    return valor;
  }
};

function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  const ano = Number(s.slice(0, 4));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && ano >= 2020 && ano <= 2100;
}
const inicioDoDia = (dia) => new Date(`${dia}T00:00:00${FUSO}`).toISOString();
const inicioDoDiaSeguinte = (dia) => new Date(new Date(`${dia}T00:00:00${FUSO}`).getTime() + 86_400_000).toISOString();

const erro = (c, campo, mensagem) => c.json({ erro: mensagem, campo }, 422);

// Filtros e lista de opções vêm antes da rota geral. Só leitura: qualquer outro método responde 405.
auditoria.get('/auditoria/filtros', async (c) => {
  const db = drizzle(c.env.DB);
  const distintos = async (coluna) => (await db.selectDistinct({ v: coluna }).from(auditoriaApp).orderBy(coluna)).map((l) => l.v);
  return c.json({ entidades: await distintos(auditoriaApp.entidade), acoes: await distintos(auditoriaApp.acao), usuarios: await distintos(auditoriaApp.usuario) });
});

auditoria.get('/auditoria', async (c) => {
  const q = c.req.query();
  const condicoes = [];

  for (const [campo, max] of [['entidade', 40], ['entidadeId', 100], ['acao', 40], ['usuario', 120]]) {
    if (q[campo] === undefined || q[campo] === '') continue;
    if (q[campo].length > max) return erro(c, campo, `${campo}: use até ${max} caracteres`);
    const coluna = { entidade: auditoriaApp.entidade, entidadeId: auditoriaApp.entidadeId, acao: auditoriaApp.acao, usuario: auditoriaApp.usuario }[campo];
    condicoes.push(eq(coluna, q[campo]));
  }

  let limite = LIMITE_PADRAO;
  if (q.limite !== undefined) {
    if (!/^\d+$/.test(q.limite) || Number(q.limite) < 1 || Number(q.limite) > LIMITE_MAXIMO) return erro(c, 'limite', `limite: informe de 1 a ${LIMITE_MAXIMO}`);
    limite = Number(q.limite);
  }
  if (q.antes !== undefined && q.antes !== '') {
    if (!/^\d+$/.test(q.antes) || Number(q.antes) < 1) return erro(c, 'antes', 'antes: informe o número da última linha já vista');
    condicoes.push(lt(auditoriaApp.id, Number(q.antes)));
  }
  if (q.de) {
    if (!dataValida(q.de)) return erro(c, 'de', 'de: informe uma data válida (AAAA-MM-DD)');
    condicoes.push(gte(auditoriaApp.ts, inicioDoDia(q.de)));
  }
  if (q.ate) {
    if (!dataValida(q.ate)) return erro(c, 'ate', 'ate: informe uma data válida (AAAA-MM-DD)');
    if (q.de && q.ate < q.de) return erro(c, 'ate', 'ate: a data final não pode ser antes da inicial');
    condicoes.push(lt(auditoriaApp.ts, inicioDoDiaSeguinte(q.ate)));
  }

  // Busca uma linha a mais para saber se há próxima página, sem contar a tabela toda.
  const linhas = await drizzle(c.env.DB)
    .select()
    .from(auditoriaApp)
    .where(condicoes.length ? and(...condicoes) : sql`1 = 1`)
    .orderBy(desc(auditoriaApp.id))
    .limit(limite + 1);

  const pagina = linhas.slice(0, limite);
  return c.json({
    itens: pagina.map((l) => ({ id: l.id, ts: l.ts, usuario: l.usuario, acao: l.acao, entidade: l.entidade, entidadeId: l.entidadeId, antes: lerJson(l.antes), depois: lerJson(l.depois) })),
    proximo: linhas.length > limite ? pagina[pagina.length - 1].id : null,
  });
});

// A auditoria não tem rota de alteração nem de exclusão.
auditoria.all('/auditoria', (c) => c.json({ erro: 'a auditoria é só de leitura' }, 405, { Allow: 'GET' }));
auditoria.all('/auditoria/*', (c) => c.json({ erro: 'a auditoria é só de leitura' }, 405, { Allow: 'GET' }));
