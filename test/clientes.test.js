import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq, like } from 'drizzle-orm';
import { usuario, cliente, auditoriaApp } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

let app;
let assinar;
const db = () => drizzle(env.DB);
let contador = 0;

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-cli@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const criar = (corpo, chave = `chave-${++contador}`) => chamar('/api/clientes', { metodo: 'POST', corpo, chave });

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-cli@exemplo.com', nome: 'TESTE-CLI', papel: 'rodrigo' });
});

it('sem login → 401', async () => {
  const r = await app.request('/api/clientes', {}, env);
  expect(r.status).toBe(401);
});

it('cria cliente só com nome e tipo; o resto fica "a confirmar"', async () => {
  const r = await criar({ nome: 'TESTE-Clínica Aurora', tipo: 'empresa' });
  expect(r.status).toBe(201);
  const c = await r.json();
  expect(c.nome).toBe('TESTE-Clínica Aurora');
  expect(c.profissao).toBeNull();
  expect(c.pendencias).toEqual(expect.arrayContaining(['profissao', 'conselho', 'registroUf', 'registroNumero', 'saude']));
});

it('o dado persiste e aparece no detalhe com a lista de pendências', async () => {
  const c = await (await criar({ nome: 'TESTE-Persiste', tipo: 'pessoa', profissao: 'Dermatologista' })).json();
  const r = await chamar(`/api/clientes/${c.id}`);
  expect(r.status).toBe(200);
  const d = await r.json();
  expect(d.profissao).toBe('Dermatologista');
  expect(d.pendencias).not.toContain('profissao');
  expect(d.pendencias).toContain('conselho');
});

it('texto vazio significa "não se aplica" e não é pendência', async () => {
  const c = await (await criar({ nome: 'TESTE-NaoSeAplica', tipo: 'empresa', conselho: '', registroUf: '', registroNumero: '' })).json();
  expect(c.pendencias).not.toContain('conselho');
  expect(c.pendencias).not.toContain('registroNumero');
});

it('RQE só é pendência quando a área é saúde', async () => {
  const a = await (await criar({ nome: 'TESTE-Saude', tipo: 'pessoa', saude: 'sim' })).json();
  expect(a.pendencias).toContain('rqe');
  const b = await (await criar({ nome: 'TESTE-Outra', tipo: 'pessoa', saude: 'nao' })).json();
  expect(b.pendencias).not.toContain('rqe');
});

it('timeout no salvar: repetir a mesma chave não duplica', async () => {
  const corpo = { nome: 'TESTE-Duplicado', tipo: 'pessoa' };
  const r1 = await criar(corpo, 'chave-fixa');
  const r2 = await criar(corpo, 'chave-fixa');
  expect(r1.status).toBe(201);
  expect(r2.status).toBe(200);
  expect((await r2.json()).id).toBe((await r1.json()).id);
  expect((await db().select().from(cliente).where(eq(cliente.nome, 'TESTE-Duplicado'))).length).toBe(1);
});

it('sem Idempotency-Key → 400', async () => {
  const r = await chamar('/api/clientes', { metodo: 'POST', corpo: { nome: 'TESTE-SemChave', tipo: 'pessoa' } });
  expect(r.status).toBe(400);
});

it('validação: nome vazio, tipo inválido e saúde inválida → 422 com campo', async () => {
  expect((await (await criar({ nome: '  ', tipo: 'pessoa' })).json()).campo).toBe('nome');
  expect((await (await criar({ nome: 'TESTE-X', tipo: 'outro' })).json()).campo).toBe('tipo');
  expect((await (await criar({ nome: 'TESTE-X', tipo: 'pessoa', saude: 'talvez' })).json()).campo).toBe('saude');
  expect((await criar({ nome: 'TESTE-X', tipo: 'pessoa', rqe: 'a'.repeat(300) })).status).toBe(422);
});

it('barreira: CPF no nome → 422 com campo e motivo, sem devolver o valor e sem gravar', async () => {
  const r = await criar({ nome: 'TESTE-José 111.444.777-35', tipo: 'pessoa' });
  expect(r.status).toBe(422);
  const j = await r.json();
  expect(j.campo).toBe('nome');
  expect(j.erro).toMatch(/CPF/);
  expect(JSON.stringify(j)).not.toContain('111.444.777-35');
  expect((await db().select().from(cliente).where(like(cliente.nome, '%111.444%'))).length).toBe(0);
});

it('a resposta não devolve a chave de envio', async () => {
  const c = await (await criar({ nome: 'TESTE-SemChaveNaResposta', tipo: 'pessoa' })).json();
  expect(c.chave).toBeUndefined();
});

it('"desde" usa a data de Brasília', async () => {
  const c = await (await criar({ nome: 'TESTE-Desde', tipo: 'pessoa' })).json();
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  expect(c.desde).toBe(hoje);
});

it('dois envios simultâneos com a mesma chave criam um só cliente', async () => {
  const corpo = { nome: 'TESTE-Corrida', tipo: 'pessoa' };
  const [a, b] = await Promise.all([criar(corpo, 'chave-corrida'), criar(corpo, 'chave-corrida')]);
  expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
  expect((await db().select().from(cliente).where(eq(cliente.nome, 'TESTE-Corrida'))).length).toBe(1);
});

it('edita e grava auditoria com antes e depois', async () => {
  const c = await (await criar({ nome: 'TESTE-Editar', tipo: 'pessoa' })).json();
  const r = await chamar(`/api/clientes/${c.id}`, { metodo: 'PATCH', corpo: { profissao: 'Dentista', conselho: 'CRO' } });
  expect(r.status).toBe(200);
  const novo = await r.json();
  expect(novo.profissao).toBe('Dentista');
  expect(novo.pendencias).not.toContain('conselho');
  const log = (await db().select().from(auditoriaApp).where(eq(auditoriaApp.entidadeId, c.id))).filter((l) => l.acao === 'alterar');
  expect(log.length).toBe(1);
  expect(JSON.parse(log[0].antes).profissao).toBeNull();
  expect(JSON.parse(log[0].depois).profissao).toBe('Dentista');
});

it('edição com dado sensível → 422 e nada muda', async () => {
  const c = await (await criar({ nome: 'TESTE-Barreira', tipo: 'pessoa' })).json();
  const r = await chamar(`/api/clientes/${c.id}`, { metodo: 'PATCH', corpo: { profissao: 'senha: abc12345' } });
  expect(r.status).toBe(422);
  expect((await (await chamar(`/api/clientes/${c.id}`)).json()).profissao).toBeNull();
});

it('cliente inexistente → 404', async () => {
  expect((await chamar('/api/clientes/nao-existe')).status).toBe(404);
  expect((await chamar('/api/clientes/nao-existe', { metodo: 'PATCH', corpo: { nome: 'x' } })).status).toBe(404);
});

it('arquivar tira da lista padrão, aparece com arquivados e pode restaurar', async () => {
  const c = await (await criar({ nome: 'TESTE-Arquivar', tipo: 'empresa' })).json();
  expect((await chamar(`/api/clientes/${c.id}/arquivar`, { metodo: 'POST' })).status).toBe(200);
  const padrao = await (await chamar('/api/clientes')).json();
  expect(padrao.some((x) => x.id === c.id)).toBe(false);
  const todos = await (await chamar('/api/clientes?arquivados=1')).json();
  expect(todos.find((x) => x.id === c.id).arquivadoEm).toBeTruthy();
  expect((await chamar(`/api/clientes/${c.id}/restaurar`, { metodo: 'POST' })).status).toBe(200);
  expect((await (await chamar('/api/clientes')).json()).some((x) => x.id === c.id)).toBe(true);
});

it('a lista traz a contagem de pendências', async () => {
  const lista = await (await chamar('/api/clientes')).json();
  expect(lista.length).toBeGreaterThan(0);
  expect(typeof lista[0].totalPendencias).toBe('number');
});
