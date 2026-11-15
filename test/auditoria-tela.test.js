import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';
import { drizzle } from 'drizzle-orm/d1';
import { usuario } from '../worker/db/schema.js';

let app;
let assinar;
let n = 0;
let cliente;
const db = () => drizzle(env.DB);

async function chamar(caminho, { metodo = 'GET', corpo, chave, email = 'teste-aud@exemplo.com' } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const json = (r) => r.json();

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values([
    { email: 'teste-aud@exemplo.com', nome: 'TESTE-AUD', papel: 'rodrigo' },
    { email: 'teste-aud2@exemplo.com', nome: 'TESTE-AUD2', papel: 'revisor_humano' },
  ]);
  cliente = await json(await chamar('/api/clientes', { metodo: 'POST', corpo: { nome: 'TESTE-Auditado', tipo: 'empresa' }, chave: `cli-${++n}` }));
  await chamar(`/api/clientes/${cliente.id}`, { metodo: 'PATCH', corpo: { profissao: 'Dentista' } });
  await chamar(`/api/clientes/${cliente.id}`, { metodo: 'PATCH', corpo: { profissao: 'Dermatologista' }, email: 'teste-aud2@exemplo.com' });
});

it('sem login → 401', async () => {
  expect((await app.request('/api/auditoria', {}, env)).status).toBe(401);
});

it('J-AUD-01: mostra quem mudou o quê, com antes e depois corretos', async () => {
  const r = await json(await chamar(`/api/auditoria?entidade=cliente&entidadeId=${cliente.id}&acao=alterar`));
  expect(r.itens.length).toBe(2);
  const [novo, velho] = r.itens; // do mais novo para o mais velho
  expect(novo.usuario).toBe('teste-aud2@exemplo.com');
  expect(novo.antes).toEqual({ profissao: 'Dentista' });
  expect(novo.depois).toEqual({ profissao: 'Dermatologista' });
  expect(velho.usuario).toBe('teste-aud@exemplo.com');
  expect(velho.antes).toEqual({ profissao: null });
  expect(velho.depois).toEqual({ profissao: 'Dentista' });
  expect(typeof novo.ts).toBe('string');
});

it('filtra por usuário e por ação', async () => {
  const porUsuario = await json(await chamar('/api/auditoria?usuario=teste-aud2@exemplo.com'));
  expect(porUsuario.itens.length).toBeGreaterThan(0);
  expect(porUsuario.itens.every((i) => i.usuario === 'teste-aud2@exemplo.com')).toBe(true);
  const criacoes = await json(await chamar(`/api/auditoria?acao=criar&entidadeId=${cliente.id}`));
  expect(criacoes.itens.map((i) => i.acao)).toEqual(['criar']);
});

it('filtra por período em horário de Brasília', async () => {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const dentro = await json(await chamar(`/api/auditoria?de=${hoje}&ate=${hoje}&entidadeId=${cliente.id}`));
  expect(dentro.itens.length).toBe(3);
  const fora = await json(await chamar(`/api/auditoria?de=2020-01-01&ate=2020-01-31&entidadeId=${cliente.id}`));
  expect(fora.itens.length).toBe(0);
});

it('pagina sem repetir nem perder linhas', async () => {
  const todos = await json(await chamar(`/api/auditoria?limite=100`));
  const ids = [];
  let cursor = null;
  for (let pagina = 0; pagina < 50; pagina++) {
    const r = await json(await chamar(`/api/auditoria?limite=2${cursor ? `&antes=${cursor}` : ''}`));
    expect(r.itens.length).toBeLessThanOrEqual(2);
    ids.push(...r.itens.map((i) => i.id));
    if (!r.proximo) break;
    cursor = r.proximo;
  }
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(todos.itens.map((i) => i.id).slice(0, ids.length));
  expect(ids.length).toBe(todos.itens.length);
});

it('valida os parâmetros → 422 com campo', async () => {
  const campo = async (q) => {
    const r = await chamar(`/api/auditoria?${q}`);
    expect(r.status).toBe(422);
    return (await json(r)).campo;
  };
  expect(await campo('limite=0')).toBe('limite');
  expect(await campo('limite=101')).toBe('limite');
  expect(await campo('limite=abc')).toBe('limite');
  expect(await campo('antes=-1')).toBe('antes');
  expect(await campo('antes=abc')).toBe('antes');
  expect(await campo('de=10/11/2026')).toBe('de');
  expect(await campo('ate=2026-02-30')).toBe('ate');
  expect(await campo('de=2026-12-01&ate=2026-11-01')).toBe('ate');
  expect(await campo(`entidade=${'a'.repeat(100)}`)).toBe('entidade');
});

it('parâmetro com aspas ou SQL não quebra nada e não devolve nada de fora', async () => {
  const r = await chamar(`/api/auditoria?usuario=${encodeURIComponent("' OR 1=1 --")}`);
  expect(r.status).toBe(200);
  expect((await json(r)).itens).toEqual([]);
});

it('lista as opções dos filtros a partir do que existe', async () => {
  const f = await json(await chamar('/api/auditoria/filtros'));
  expect(f.entidades).toEqual(expect.arrayContaining(['cliente']));
  expect(f.acoes).toEqual(expect.arrayContaining(['criar', 'alterar']));
  expect(f.usuarios).toEqual(expect.arrayContaining(['teste-aud@exemplo.com', 'teste-aud2@exemplo.com']));
});

it('não tem rota de alteração nem de exclusão: 405', async () => {
  for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const caminho of ['/api/auditoria', '/api/auditoria/1', '/api/auditoria/filtros']) {
      const r = await chamar(caminho, { metodo, corpo: metodo === 'DELETE' ? undefined : {} });
      expect(r.status, `${metodo} ${caminho}`).toBe(405);
    }
  }
});

it('o banco recusa UPDATE e DELETE na auditoria, mesmo por dentro do código', async () => {
  await expect(env.DB.prepare('UPDATE auditoria_app SET usuario = ? WHERE id = (SELECT MIN(id) FROM auditoria_app)').bind('x').run()).rejects.toThrow(/acréscimo/);
  await expect(env.DB.prepare('DELETE FROM auditoria_app WHERE id = (SELECT MIN(id) FROM auditoria_app)').run()).rejects.toThrow(/acréscimo/);
});

it('registro com antes ou depois que não é JSON volta como texto, sem erro', async () => {
  await env.DB.prepare("INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) VALUES (?, 'x', 'teste', 'teste', 'z1', 'texto solto', NULL)").bind(new Date().toISOString()).run();
  const r = await json(await chamar('/api/auditoria?entidade=teste&entidadeId=z1'));
  expect(r.itens[0].antes).toBe('texto solto');
  expect(r.itens[0].depois).toBeNull();
});
