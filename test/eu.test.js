import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usuario, auditoriaApp } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

let app;
let assinar;
const db = () => drizzle(env.DB);
const chamar = async (caminho, init = {}, email = 'teste-eu@exemplo.com') => {
  const headers = { ...(init.headers ?? {}) };
  if (email) headers['cf-access-jwt-assertion'] = await assinar({ email });
  return app.request(caminho, { ...init, headers }, env);
};

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-eu@exemplo.com', nome: 'TESTE-EU', papel: 'rodrigo' });
});

it('/api/saude é pública', async () => {
  const r = await app.request('/api/saude', {}, env);
  expect(r.status).toBe(200);
});

it('sem credencial → 401', async () => {
  const r = await chamar('/api/eu', {}, null);
  expect(r.status).toBe(401);
});

it('token forjado → 401', async () => {
  const r = await app.request('/api/eu', { headers: { 'cf-access-jwt-assertion': 'abc.def.ghi' } }, env);
  expect(r.status).toBe(401);
});

it('e-mail fora da lista → 403', async () => {
  const r = await chamar('/api/eu', {}, 'intruso@exemplo.com');
  expect(r.status).toBe(403);
});

it('GET /api/eu devolve o usuário', async () => {
  const r = await chamar('/api/eu');
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ email: 'teste-eu@exemplo.com', nome: 'TESTE-EU', papel: 'rodrigo' });
});

it('PATCH /api/eu altera o nome e grava a auditoria com antes e depois', async () => {
  const antes = (await db().select().from(auditoriaApp)).length;
  const r = await chamar('/api/eu', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome: 'TESTE-EU-NOVO' }),
  });
  expect(r.status).toBe(200);
  expect((await r.json()).nome).toBe('TESTE-EU-NOVO');
  const log = await db().select().from(auditoriaApp);
  expect(log.length).toBe(antes + 1);
  const ultimo = log.at(-1);
  expect(ultimo.usuario).toBe('teste-eu@exemplo.com');
  expect(JSON.parse(ultimo.antes)).toEqual({ nome: 'TESTE-EU' });
  expect(JSON.parse(ultimo.depois)).toEqual({ nome: 'TESTE-EU-NOVO' });
});

it('PATCH com nome vazio → 422 e nenhuma auditoria nova', async () => {
  const antes = (await db().select().from(auditoriaApp)).length;
  const r = await chamar('/api/eu', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome: '   ' }),
  });
  expect(r.status).toBe(422);
  expect((await r.json()).campo).toBe('nome');
  expect((await db().select().from(auditoriaApp)).length).toBe(antes);
});
