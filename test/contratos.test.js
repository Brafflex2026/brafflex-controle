import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usuario, contrato, auditoriaApp } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

let app;
let assinar;
let clienteA;
let clienteB;
const db = () => drizzle(env.DB);
let n = 0;

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-con@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const novoCliente = async (nome) => (await (await chamar('/api/clientes', { metodo: 'POST', corpo: { nome, tipo: 'empresa' }, chave: `cli-${++n}` })).json());
const criar = (clienteId, corpo, chave = `con-${++n}`) => chamar(`/api/clientes/${clienteId}/contratos`, { metodo: 'POST', corpo, chave });
const base = { marca: 'TESTE-Marca Aurora', tipo: 'produto + marketing' };

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-con@exemplo.com', nome: 'TESTE-CON', papel: 'rodrigo' });
  clienteA = await novoCliente('TESTE-Cliente A');
  clienteB = await novoCliente('TESTE-Cliente B');
});

it('sem login → 401', async () => {
  expect((await app.request(`/api/clientes/${clienteA.id}/contratos`, {}, env)).status).toBe(401);
});

it('não existe lista geral de contratos (isolamento)', async () => {
  expect((await chamar('/api/contratos')).status).toBe(404);
});

it('cria contrato só com marca e tipo; o resto fica a confirmar', async () => {
  const r = await criar(clienteA.id, base);
  expect(r.status).toBe(201);
  const c = await r.json();
  expect(c.marca).toBe('TESTE-Marca Aurora');
  expect(c.status).toBe('ativo');
  expect(c.chave).toBeUndefined();
  expect(c.pendencias).toEqual(expect.arrayContaining(['escopo', 'verbaCentavos', 'periodoInicio', 'contatoAprovador']));
  expect(c.pendencias).not.toContain('periodoFim');
  expect(c.leituraAutorizada).toBe(false);
});

it('guarda a verba em centavos e o dado persiste no detalhe', async () => {
  const c = await (await criar(clienteA.id, { ...base, marca: 'TESTE-Verba', verbaCentavos: 150000, escopo: 'Gestão de anúncios', periodoInicio: '2026-12-01', periodoFim: '2027-05-31', contatoAprovador: 'TESTE-Dra. Beatriz' })).json();
  const d = await (await chamar(`/api/contratos/${c.id}`)).json();
  expect(d.verbaCentavos).toBe(150000);
  expect(d.periodoFim).toBe('2027-05-31');
  expect(d.pendencias).toEqual([]);
});

it('validação: marca, tipo, verba e período → 422 com campo', async () => {
  const campo = async (corpo) => (await (await criar(clienteA.id, { ...base, ...corpo })).json()).campo;
  expect(await campo({ marca: ' ' })).toBe('marca');
  expect(await campo({ tipo: 'outro' })).toBe('tipo');
  expect(await campo({ verbaCentavos: -5 })).toBe('verbaCentavos');
  expect(await campo({ verbaCentavos: 10.5 })).toBe('verbaCentavos');
  expect(await campo({ periodoInicio: '31/12/2026' })).toBe('periodoInicio');
  expect(await campo({ periodoInicio: '2026-02-30' })).toBe('periodoInicio');
  expect(await campo({ periodoInicio: '2027-01-01', periodoFim: '2026-01-01' })).toBe('periodoFim');
});

it('barreira: e-mail no contato que aprova → 422 sem gravar', async () => {
  const r = await criar(clienteA.id, { ...base, marca: 'TESTE-Barreira', contatoAprovador: 'ana@exemplo.com' });
  expect(r.status).toBe(422);
  const j = await r.json();
  expect(j.campo).toBe('contatoAprovador');
  expect(JSON.stringify(j)).not.toContain('ana@exemplo.com');
});

it('repetir a mesma chave não duplica', async () => {
  const corpo = { ...base, marca: 'TESTE-Duplicado' };
  const a = await criar(clienteA.id, corpo, 'con-fixa');
  const b = await criar(clienteA.id, corpo, 'con-fixa');
  expect(a.status).toBe(201);
  expect(b.status).toBe(200);
  expect((await b.json()).id).toBe((await a.json()).id);
  expect((await db().select().from(contrato).where(eq(contrato.marca, 'TESTE-Duplicado'))).length).toBe(1);
});

it('sem Idempotency-Key → 400; cliente inexistente → 404', async () => {
  expect((await chamar(`/api/clientes/${clienteA.id}/contratos`, { metodo: 'POST', corpo: base })).status).toBe(400);
  expect((await criar('nao-existe', base)).status).toBe(404);
});

it('isolamento: cada cliente vê só os seus contratos', async () => {
  await criar(clienteA.id, { ...base, marca: 'TESTE-Só do A' });
  await criar(clienteB.id, { ...base, marca: 'TESTE-Só do B' });
  const doA = (await (await chamar(`/api/clientes/${clienteA.id}/contratos`)).json()).map((c) => c.marca);
  const doB = (await (await chamar(`/api/clientes/${clienteB.id}/contratos`)).json()).map((c) => c.marca);
  expect(doA).toContain('TESTE-Só do A');
  expect(doA).not.toContain('TESTE-Só do B');
  expect(doB).toEqual(['TESTE-Só do B']);
});

it('cliente arquivado não recebe contrato novo → 409', async () => {
  const c = await novoCliente('TESTE-Arquivado');
  await chamar(`/api/clientes/${c.id}/arquivar`, { metodo: 'POST' });
  expect((await criar(c.id, base)).status).toBe(409);
});

it('autorizar leitura exige quem autorizou; revogar e autorizar de novo', async () => {
  const c = await (await criar(clienteA.id, { ...base, marca: 'TESTE-Autoriza' })).json();
  const sem = await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: {} });
  expect(sem.status).toBe(422);
  expect((await sem.json()).campo).toBe('autorizadaPor');

  const ok = await (await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Dra. Beatriz' } })).json();
  expect(ok.leituraAutorizada).toBe(true);
  expect(ok.leituraAutorizadaPor).toBe('TESTE-Dra. Beatriz');
  expect(ok.leituraAutorizadaEm).toBeTruthy();

  const rev = await (await chamar(`/api/contratos/${c.id}/revogar-leitura`, { metodo: 'POST' })).json();
  expect(rev.leituraAutorizada).toBe(false);
  expect(rev.leituraRevogadaEm).toBeTruthy();

  const de = await (await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Dra. Beatriz' } })).json();
  expect(de.leituraAutorizada).toBe(true);
  expect(de.leituraRevogadaEm).toBeNull();

  const log = (await db().select().from(auditoriaApp).where(eq(auditoriaApp.entidadeId, c.id))).map((l) => l.acao);
  expect(log).toEqual(expect.arrayContaining(['criar', 'autorizar_leitura', 'revogar_leitura']));
});

it('autorizar de novo com autorização ativa → 409, sem sobrescrever quem e quando', async () => {
  const c = await (await criar(clienteA.id, { ...base, marca: 'TESTE-DuplaAut' })).json();
  const a = await (await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Primeira' } })).json();
  const r = await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Segunda' } });
  expect(r.status).toBe(409);
  const d = await (await chamar(`/api/contratos/${c.id}`)).json();
  expect(d.leituraAutorizadaPor).toBe('TESTE-Primeira');
  expect(d.leituraAutorizadaEm).toBe(a.leituraAutorizadaEm);
});

it('contrato encerrado nunca aparece com leitura autorizada, mesmo que o banco tenha ficado inconsistente', async () => {
  const c = await (await criar(clienteA.id, { ...base, marca: 'TESTE-Inconsistente' })).json();
  await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Alguém' } });
  await db().update(contrato).set({ status: 'encerrado' }).where(eq(contrato.id, c.id));
  expect((await (await chamar(`/api/contratos/${c.id}`)).json()).leituraAutorizada).toBe(false);
});

it('a mesma chave em outro cliente → 409, sem devolver o contrato do primeiro', async () => {
  const a = await criar(clienteA.id, { ...base, marca: 'TESTE-ChaveCompartilhada' }, 'chave-entre-clientes');
  expect(a.status).toBe(201);
  const b = await criar(clienteB.id, { ...base, marca: 'TESTE-Outra' }, 'chave-entre-clientes');
  expect(b.status).toBe(409);
  expect(JSON.stringify(await b.json())).not.toContain('TESTE-ChaveCompartilhada');
});

it('cliente arquivado não recebe autorização de leitura → 409', async () => {
  const cli = await novoCliente('TESTE-ArquivaDepois');
  const c = await (await criar(cli.id, { ...base, marca: 'TESTE-DoArquivado' })).json();
  await chamar(`/api/clientes/${cli.id}/arquivar`, { metodo: 'POST' });
  expect((await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Alguém' } })).status).toBe(409);
});

it('revogar sem autorização ativa → 409', async () => {
  const c = await (await criar(clienteA.id, { ...base, marca: 'TESTE-SemAut' })).json();
  expect((await chamar(`/api/contratos/${c.id}/revogar-leitura`, { metodo: 'POST' })).status).toBe(409);
});

it('encerrar revoga a leitura, mantém o histórico e bloqueia novas mudanças', async () => {
  const c = await (await criar(clienteA.id, { ...base, marca: 'TESTE-Encerra' })).json();
  await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Alguém' } });
  const e = await (await chamar(`/api/contratos/${c.id}/encerrar`, { metodo: 'POST' })).json();
  expect(e.status).toBe('encerrado');
  expect(e.encerradoEm).toBeTruthy();
  expect(e.leituraAutorizada).toBe(false);
  expect((await chamar(`/api/contratos/${c.id}/autorizar-leitura`, { metodo: 'POST', corpo: { autorizadaPor: 'TESTE-Alguém' } })).status).toBe(409);
  expect((await chamar(`/api/contratos/${c.id}`, { metodo: 'PATCH', corpo: { escopo: 'novo' } })).status).toBe(409);
  const lista = (await (await chamar(`/api/clientes/${clienteA.id}/contratos`)).json()).map((x) => x.id);
  expect(lista).toContain(c.id);
});

it('edita e grava auditoria só com o que mudou', async () => {
  const c = await (await criar(clienteA.id, { ...base, marca: 'TESTE-Edita', escopo: 'antigo' })).json();
  const r = await chamar(`/api/contratos/${c.id}`, { metodo: 'PATCH', corpo: { escopo: 'novo', marca: 'TESTE-Edita' } });
  expect(r.status).toBe(200);
  expect((await r.json()).escopo).toBe('novo');
  const log = (await db().select().from(auditoriaApp).where(eq(auditoriaApp.entidadeId, c.id))).filter((l) => l.acao === 'alterar');
  expect(log.length).toBe(1);
  expect(JSON.parse(log[0].antes)).toEqual({ escopo: 'antigo' });
  expect(JSON.parse(log[0].depois)).toEqual({ escopo: 'novo' });
});

it('contrato inexistente → 404', async () => {
  expect((await chamar('/api/contratos/nao-existe')).status).toBe(404);
  expect((await chamar('/api/contratos/nao-existe/encerrar', { metodo: 'POST' })).status).toBe(404);
});
