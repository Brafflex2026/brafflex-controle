import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usuario, briefing, auditoriaApp } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

let app;
let assinar;
let contratoA;
let contratoB;
const db = () => drizzle(env.DB);
let n = 0;

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-bri@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const json = async (r) => r.json();
async function novoContrato(marca) {
  const cli = await json(await chamar('/api/clientes', { metodo: 'POST', corpo: { nome: `TESTE-${marca}`, tipo: 'empresa' }, chave: `cli-${++n}` }));
  return json(await chamar(`/api/clientes/${cli.id}/contratos`, { metodo: 'POST', corpo: { marca: `TESTE-${marca}`, tipo: 'só marketing' }, chave: `con-${++n}` }));
}
const nova = (contratoId, conteudo, chave = `bri-${++n}`) => chamar(`/api/contratos/${contratoId}/briefings`, { metodo: 'POST', corpo: { conteudo }, chave });
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-bri@exemplo.com', nome: 'TESTE-BRI', papel: 'rodrigo' });
  contratoA = await novoContrato('A');
  contratoB = await novoContrato('B');
});

it('sem login → 401', async () => {
  expect((await app.request(`/api/contratos/${contratoA.id}/briefings`, {}, env)).status).toBe(401);
});

it('as versões nascem numeradas 1, 2, 3 e a lista vem da mais nova para a mais antiga', async () => {
  const a = await json(await nova(contratoA.id, 'Versão um do briefing'));
  const b = await json(await nova(contratoA.id, 'Versão dois'));
  const c = await json(await nova(contratoA.id, 'Versão três'));
  expect([a.versao, b.versao, c.versao]).toEqual([1, 2, 3]);
  expect(a.confirmadoEm).toBeNull();
  expect(a.chave).toBeUndefined();
  const lista = await json(await chamar(`/api/contratos/${contratoA.id}/briefings`));
  expect(lista.map((x) => x.versao)).toEqual([3, 2, 1]);
  expect(lista[2].conteudo).toBe('Versão um do briefing');
});

it('cada contrato tem a sua própria numeração (isolamento)', async () => {
  const b = await json(await nova(contratoB.id, 'Primeiro do B'));
  expect(b.versao).toBe(1);
  const lista = await json(await chamar(`/api/contratos/${contratoB.id}/briefings`));
  expect(lista.length).toBe(1);
});

it('não existe rota para editar uma versão', async () => {
  const v = await json(await nova(contratoB.id, 'Fixa'));
  expect((await chamar(`/api/briefings/${v.id}`, { metodo: 'PATCH', corpo: { conteudo: 'outro' } })).status).toBe(404);
});

it('texto vazio ou grande demais → 422 com campo', async () => {
  expect((await json(await nova(contratoA.id, '   '))).campo).toBe('conteudo');
  const r = await nova(contratoA.id, 'a'.repeat(20001));
  expect(r.status).toBe(422);
  expect((await json(r)).campo).toBe('conteudo');
});

it('barreira: dado sensível → 422 com a linha, sem devolver o valor e sem criar versão', async () => {
  const antes = (await json(await chamar(`/api/contratos/${contratoA.id}/briefings`))).length;
  const r = await nova(contratoA.id, 'Linha 1 ok\nLinha 2 ok\nLigar para (11) 91234-5678 hoje');
  expect(r.status).toBe(422);
  const j = await json(r);
  expect(j.campo).toBe('conteudo');
  expect(j.linha).toBe(3);
  expect(JSON.stringify(j)).not.toContain('91234');
  expect((await json(await chamar(`/api/contratos/${contratoA.id}/briefings`))).length).toBe(antes);
});

it('repetir a mesma chave não cria outra versão; chave de outro contrato → 409', async () => {
  const a = await nova(contratoA.id, 'Com chave', 'bri-fixa');
  const b = await nova(contratoA.id, 'Com chave', 'bri-fixa');
  expect(a.status).toBe(201);
  expect(b.status).toBe(200);
  expect((await json(b)).id).toBe((await json(a)).id);
  expect((await nova(contratoB.id, 'Outro', 'bri-fixa')).status).toBe(409);
});

it('dois envios simultâneos geram versões diferentes, sem repetir número', async () => {
  const c = await novoContrato('Corrida');
  const [x, y] = await Promise.all([nova(c.id, 'Um'), nova(c.id, 'Dois')]);
  const versoes = [(await json(x)).versao, (await json(y)).versao].sort();
  expect(versoes).toEqual([1, 2]);
});

it('muitos envios ao mesmo tempo no mesmo contrato: todos entram, com números 1 a 8', async () => {
  const c = await novoContrato('Muitos');
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => nova(c.id, `Texto ${i}`)));
  expect(rs.map((r) => r.status)).toEqual(Array(8).fill(201));
  const versoes = (await Promise.all(rs.map(json))).map((b) => b.versao).sort((a, b) => a - b);
  expect(versoes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

it('a linha informada bate com o que a pessoa digitou, mesmo com linhas em branco no começo', async () => {
  const r = await nova(contratoA.id, '\n\n\nlinha quatro com cpf 111.444.777-35');
  expect(r.status).toBe(422);
  expect((await json(r)).linha).toBe(4);
});

it('duas confirmações ao mesmo tempo: uma vale, a outra recebe 409, com uma só auditoria', async () => {
  const v = await json(await nova(contratoA.id, 'Confirmação concorrente'));
  const [x, y] = await Promise.all([
    chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: { confirmadoEm: '2026-11-10' } }),
    chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: { confirmadoEm: '2026-11-11' } }),
  ]);
  expect([x.status, y.status].sort()).toEqual([200, 409]);
  const log = (await db().select().from(auditoriaApp).where(eq(auditoriaApp.entidadeId, v.id))).filter((l) => l.acao === 'confirmar');
  expect(log.length).toBe(1);
});

it('sem Idempotency-Key → 400; contrato inexistente → 404', async () => {
  expect((await chamar(`/api/contratos/${contratoA.id}/briefings`, { metodo: 'POST', corpo: { conteudo: 'x' } })).status).toBe(400);
  expect((await nova('nao-existe', 'x')).status).toBe(404);
  expect((await chamar('/api/contratos/nao-existe/briefings')).status).toBe(404);
});

it('confirma uma versão com a data do "é isso" e grava auditoria sem o texto inteiro', async () => {
  const v = await json(await nova(contratoA.id, 'Texto para confirmar'));
  const r = await chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: { confirmadoEm: '2026-11-10' } });
  expect(r.status).toBe(200);
  expect((await json(r)).confirmadoEm).toBe('2026-11-10');
  const log = (await db().select().from(auditoriaApp).where(eq(auditoriaApp.entidadeId, v.id))).map((l) => ({ acao: l.acao, depois: l.depois }));
  expect(log.map((l) => l.acao)).toEqual(expect.arrayContaining(['criar', 'confirmar']));
  expect(JSON.stringify(log)).not.toContain('Texto para confirmar');
});

it('sem data informada, confirma com a data de hoje em Brasília', async () => {
  const v = await json(await nova(contratoA.id, 'Hoje'));
  const r = await json(await chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: {} }));
  expect(r.confirmadoEm).toBe(hoje());
});

it('data futura ou inválida → 422; já confirmada → 409; inexistente → 404', async () => {
  const v = await json(await nova(contratoA.id, 'Datas'));
  const amanha = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  expect((await json(await chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: { confirmadoEm: amanha } }))).campo).toBe('confirmadoEm');
  expect((await json(await chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: { confirmadoEm: '10/11/2026' } }))).campo).toBe('confirmadoEm');
  expect((await chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: { confirmadoEm: '2026-11-10' } })).status).toBe(200);
  expect((await chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: { confirmadoEm: '2026-11-11' } })).status).toBe(409);
  expect((await chamar('/api/briefings/nao-existe/confirmar', { metodo: 'POST', corpo: {} })).status).toBe(404);
});

it('contrato encerrado não recebe versão nem confirmação → 409', async () => {
  const c = await novoContrato('Encerrado');
  const v = await json(await nova(c.id, 'Antes de encerrar'));
  await chamar(`/api/contratos/${c.id}/encerrar`, { metodo: 'POST' });
  expect((await nova(c.id, 'Depois')).status).toBe(409);
  expect((await chamar(`/api/briefings/${v.id}/confirmar`, { metodo: 'POST', corpo: {} })).status).toBe(409);
  expect((await json(await chamar(`/api/contratos/${c.id}/briefings`))).length).toBe(1);
});

it('o índice único impede duas versões com o mesmo número', async () => {
  const c = await novoContrato('Indice');
  const v = await json(await nova(c.id, 'Primeira'));
  await expect(
    db().insert(briefing).values({ id: 'x1', chave: 'k-x1', contratoId: c.id, versao: v.versao, conteudo: 'dup', criadoPor: 'teste' }),
  ).rejects.toThrow();
});
