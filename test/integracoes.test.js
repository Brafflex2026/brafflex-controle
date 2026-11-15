import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usuario, auditoriaApp } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { verificarIdentificador } from '../worker/barreira.js';
import { cenarioToken } from './ajuda-token.js';

let app;
let assinar;
let contratoA;
let contratoB;
const db = () => drizzle(env.DB);
let n = 0;

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-int@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const json = (r) => r.json();
async function novoContrato(marca) {
  const cli = await json(await chamar('/api/clientes', { metodo: 'POST', corpo: { nome: `TESTE-${marca}`, tipo: 'empresa' }, chave: `cli-${++n}` }));
  return json(await chamar(`/api/clientes/${cli.id}/contratos`, { metodo: 'POST', corpo: { marca: `TESTE-${marca}`, tipo: 'só marketing' }, chave: `con-${++n}` }));
}
const criar = (contratoId, corpo, chave = `int-${++n}`) => chamar(`/api/contratos/${contratoId}/integracoes`, { metodo: 'POST', corpo, chave });
const acao = (id, a, corpo) => chamar(`/api/integracoes/${id}/${a}`, { metodo: 'POST', corpo });
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-int@exemplo.com', nome: 'TESTE-INT', papel: 'rodrigo' });
  contratoA = await novoContrato('A');
  contratoB = await novoContrato('B');
});

// ---------- a barreira de identificador ----------
it('aceita identificadores legítimos de cada sistema', () => {
  for (const ok of ['act_1234567890', '1234567890', '123-456-7890', '123456789012345', '1234567890123456', 'https://clinica-aurora.com.br', 'RD Station', 'https://www.instagram.com/clinica.aurora', '@clinica.aurora']) {
    expect(verificarIdentificador(ok), ok).toBeNull();
  }
});

it('recusa valores com cara de segredo', () => {
  const ruins = [
    'EAAGm0PX4ZCpsBAKZBexemplo123456789012345',
    'ya29.a0AfH6SMBexemplo123456',
    'GOCSPX-abcdefghijklmnopqrstuvwx',
    'sk-abcdefghijklmnopqrstuvwxyz123456',
    '0123456789abcdef'.repeat(4),
    'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc-def_123',
    'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    'token: abc12345678',
    'https://site.com/?token=abc12345678',
    'fulano@exemplo.com',
  ];
  for (const ruim of ruins) expect(verificarIdentificador(ruim), ruim).not.toBeNull();
});

it('recusa formas escondidas de chave: parâmetros de URL, fragmentada, curtas e com credencial', () => {
  const ruins = [
    'https://x.com/?access_token=abcdEFGH1234',
    'https://x.com/?client_secret=abcdEFGH',
    'https://x.com/?apikey=abcdEFGH',
    'https://x.com/?sig=abcd1234',
    'AbCd1234 EfGh5678 IjKl9012 MnOp3456',
    'AbCd1234.EfGh5678.IjKl9012.MnOp3456',
    'AbCd1234:EfGh5678:IjKl9012:MnOp3456',
    'eyJhbGciOi.eyJzdWIiOiIx.abc1',
    'ya29.a0AfH6SMB',
    'Bearer abcdefgh12345678',
    'ghp_abc123',
    'sk-abc123',
    'https://admin:Senha123@clinica.com.br',
    'https://user:pw1@localhost/',
    'joao%40clinica.com',
  ];
  for (const ruim of ruins) expect(verificarIdentificador(ruim), ruim).not.toBeNull();
});

it('não recusa endereços longos e legítimos de site e perfil', () => {
  for (const ok of [
    'https://www.clinicadermatologicamaria-silva-2020.com.br/agendamento',
    'clinica-dermatologica-dra-ana-silva-2024-sp',
    'https://www.instagram.com/clinica.dermatologica.dra.ana.silva',
    'https://www.facebook.com/profile.php?id=100012345678901',
    'https://clinica.com.br/blog/como-escolher-um-dermatologista-em-sao-paulo',
  ]) {
    expect(verificarIdentificador(ok), ok).toBeNull();
  }
});

it('identificador enorme é analisado rápido', () => {
  const inicio = performance.now();
  verificarIdentificador('a1'.repeat(10000));
  verificarIdentificador('token' + ' '.repeat(10000));
  expect(performance.now() - inicio).toBeLessThan(250);
});

// ---------- a API ----------
it('sem login → 401', async () => {
  expect((await app.request(`/api/contratos/${contratoA.id}/integracoes`, {}, env)).status).toBe(401);
});

it('cria integração só com o tipo; o resto fica "a confirmar", em estado pendente', async () => {
  const r = await criar(contratoA.id, { tipo: 'conta Meta' });
  expect(r.status).toBe(201);
  const i = await json(r);
  expect(i.estado).toBe('pendente');
  expect(i.idExterno).toBeNull();
  expect(i.chave).toBeUndefined();
  expect(i.verificadaEm).toBeNull();
});

it('guarda identificador, dono e o que falta; persiste no detalhe da lista com resumo', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'pixel', idExterno: '123456789012345', dono: 'TESTE-Cliente', oQueFalta: 'Instalar o pixel no site' }));
  const lista = await json(await chamar(`/api/contratos/${contratoA.id}/integracoes`));
  const achada = lista.itens.find((x) => x.id === i.id);
  expect(achada.idExterno).toBe('123456789012345');
  expect(achada.dono).toBe('TESTE-Cliente');
  expect(achada.oQueFalta).toBe('Instalar o pixel no site');
  expect(lista.resumo.pendente).toBeGreaterThanOrEqual(1);
  expect(lista.resumo).toEqual(expect.objectContaining({ pendente: expect.any(Number), verificada: expect.any(Number), revogada: expect.any(Number) }));
});

it('valida o tipo e o tamanho dos campos → 422 com campo', async () => {
  expect((await json(await criar(contratoA.id, { tipo: 'tiktok' }))).campo).toBe('tipo');
  expect((await json(await criar(contratoA.id, { tipo: 'site', idExterno: 'a'.repeat(300) }))).campo).toBe('idExterno');
  expect((await json(await criar(contratoA.id, { tipo: 'site', dono: 'a'.repeat(200) }))).campo).toBe('dono');
});

it('recusa token no identificador e não devolve o valor nem grava', async () => {
  const segredo = 'EAAGm0PX4ZCpsBAKZBexemplo123456789012345';
  const r = await criar(contratoA.id, { tipo: 'conta Meta', idExterno: segredo });
  expect(r.status).toBe(422);
  const j = await json(r);
  expect(j.campo).toBe('idExterno');
  expect(JSON.stringify(j)).not.toContain(segredo);
  const lista = await json(await chamar(`/api/contratos/${contratoA.id}/integracoes`));
  expect(lista.itens.some((x) => x.idExterno === segredo)).toBe(false);
});

it('barreira de texto comum vale para dono e o que falta', async () => {
  expect((await json(await criar(contratoA.id, { tipo: 'site', dono: 'ligar (11) 91234-5678' }))).campo).toBe('dono');
  expect((await json(await criar(contratoA.id, { tipo: 'site', oQueFalta: 'senha: abc12345' }))).campo).toBe('oQueFalta');
});

it('o mesmo tipo e identificador no mesmo contrato só entram uma vez → 409', async () => {
  expect((await criar(contratoA.id, { tipo: 'conta Google', idExterno: '1112223334' })).status).toBe(201);
  expect((await criar(contratoA.id, { tipo: 'conta Google', idExterno: '1112223334' })).status).toBe(409);
  expect((await criar(contratoB.id, { tipo: 'conta Google', idExterno: '1112223334' })).status).toBe(201);
});

it('repetir a mesma chave não duplica; chave de outro contrato → 409; sem chave → 400', async () => {
  const a = await criar(contratoA.id, { tipo: 'site', idExterno: 'https://aurora.com.br' }, 'int-fixa');
  const b = await criar(contratoA.id, { tipo: 'site', idExterno: 'https://aurora.com.br' }, 'int-fixa');
  expect(a.status).toBe(201);
  expect(b.status).toBe(200);
  expect((await json(b)).id).toBe((await json(a)).id);
  expect((await criar(contratoB.id, { tipo: 'site' }, 'int-fixa')).status).toBe(409);
  expect((await chamar(`/api/contratos/${contratoA.id}/integracoes`, { metodo: 'POST', corpo: { tipo: 'site' } })).status).toBe(400);
});

it('isolamento: cada contrato vê só as suas integrações', async () => {
  const c = await novoContrato('Isolado');
  await criar(c.id, { tipo: 'CRM do cliente', idExterno: 'TESTE-RD Station' });
  const lista = await json(await chamar(`/api/contratos/${c.id}/integracoes`));
  expect(lista.itens.length).toBe(1);
  expect((await chamar('/api/integracoes')).status).toBe(404);
  expect((await chamar('/api/contratos/nao-existe/integracoes')).status).toBe(404);
});

it('verificar exige identificador preenchido e data não futura; grava a data', async () => {
  const sem = await json(await criar(contratoA.id, { tipo: 'página/IG' }));
  const r0 = await acao(sem.id, 'verificar', {});
  expect(r0.status).toBe(409);

  const i = await json(await criar(contratoA.id, { tipo: 'página/IG', idExterno: 'TESTE-pagina-aurora' }));
  const amanha = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  expect((await json(await acao(i.id, 'verificar', { verificadaEm: amanha }))).campo).toBe('verificadaEm');
  expect((await json(await acao(i.id, 'verificar', { verificadaEm: '10/11/2026' }))).campo).toBe('verificadaEm');

  const ok = await json(await acao(i.id, 'verificar', {}));
  expect(ok.estado).toBe('verificada');
  expect(ok.verificadaEm).toBe(hoje());
  expect((await acao(i.id, 'verificar', {})).status).toBe(409);
});

it('revogar e reativar seguem as transições; revogada não se edita', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'site', idExterno: 'https://revoga.com.br' }));
  await acao(i.id, 'verificar', { verificadaEm: '2026-11-10' });
  const rev = await json(await acao(i.id, 'revogar'));
  expect(rev.estado).toBe('revogada');
  expect(rev.revogadaEm).toBeTruthy();
  expect((await acao(i.id, 'revogar')).status).toBe(409);
  expect((await chamar(`/api/integracoes/${i.id}`, { metodo: 'PATCH', corpo: { dono: 'x' } })).status).toBe(409);
  const rea = await json(await acao(i.id, 'reativar'));
  expect(rea.estado).toBe('pendente');
  expect(rea.verificadaEm).toBeNull();
  expect(rea.revogadaEm).toBeNull();
  expect((await acao(i.id, 'reativar')).status).toBe(409);
});

it('revogar uma verificada limpa a data de verificação', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'site', idExterno: 'https://limpa.com.br' }));
  await acao(i.id, 'verificar', {});
  const rev = await json(await acao(i.id, 'revogar'));
  expect(rev.verificadaEm).toBeNull();
});

it('apagar o identificador e verificar ao mesmo tempo nunca deixa verificada sem identificador', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'conta Meta', idExterno: 'act_777' }));
  await Promise.all([chamar(`/api/integracoes/${i.id}`, { metodo: 'PATCH', corpo: { idExterno: null } }), acao(i.id, 'verificar', {})]);
  const lista = await json(await chamar(`/api/contratos/${contratoA.id}/integracoes`));
  const final = lista.itens.find((x) => x.id === i.id);
  expect(final.estado === 'verificada' && final.idExterno === null).toBe(false);
});

it('erro que não é de duplicata não vira "já existe" no PATCH', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'CRM do cliente', idExterno: 'TESTE-CRM-A' }));
  const r = await chamar(`/api/integracoes/${i.id}`, { metodo: 'PATCH', corpo: { dono: 'TESTE-Novo dono' } });
  expect(r.status).toBe(200);
});

it('mudar o identificador de uma integração verificada volta para pendente', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'conta Meta', idExterno: 'act_111' }));
  await acao(i.id, 'verificar', {});
  const novo = await json(await chamar(`/api/integracoes/${i.id}`, { metodo: 'PATCH', corpo: { idExterno: 'act_222' } }));
  expect(novo.estado).toBe('pendente');
  expect(novo.verificadaEm).toBeNull();
  expect(novo.idExterno).toBe('act_222');
});

it('mudar só o dono de uma verificada mantém verificada', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'conta Meta', idExterno: 'act_333' }));
  await acao(i.id, 'verificar', {});
  const novo = await json(await chamar(`/api/integracoes/${i.id}`, { metodo: 'PATCH', corpo: { dono: 'TESTE-Agência' } }));
  expect(novo.estado).toBe('verificada');
});

it('edição com token → 422 e nada muda; edição que duplica → 409', async () => {
  const a = await json(await criar(contratoB.id, { tipo: 'pixel', idExterno: '999000111222333' }));
  const r = await chamar(`/api/integracoes/${a.id}`, { metodo: 'PATCH', corpo: { idExterno: 'ya29.a0AfH6SMBexemplo123456' } });
  expect(r.status).toBe(422);
  const b = await json(await criar(contratoB.id, { tipo: 'pixel', idExterno: '999000111222444' }));
  expect((await chamar(`/api/integracoes/${b.id}`, { metodo: 'PATCH', corpo: { idExterno: '999000111222333' } })).status).toBe(409);
});

it('contrato encerrado não recebe nem muda integração → 409', async () => {
  const c = await novoContrato('Encerrado');
  const i = await json(await criar(c.id, { tipo: 'site', idExterno: 'https://encerrado.com.br' }));
  await chamar(`/api/contratos/${c.id}/encerrar`, { metodo: 'POST' });
  expect((await criar(c.id, { tipo: 'pixel' })).status).toBe(409);
  expect((await chamar(`/api/integracoes/${i.id}`, { metodo: 'PATCH', corpo: { dono: 'x' } })).status).toBe(409);
  expect((await acao(i.id, 'verificar', {})).status).toBe(409);
  expect((await acao(i.id, 'revogar')).status).toBe(409);
});

it('grava auditoria de criar, verificar, revogar e reativar', async () => {
  const i = await json(await criar(contratoA.id, { tipo: 'site', idExterno: 'https://auditoria.com.br' }));
  await acao(i.id, 'verificar', {});
  await acao(i.id, 'revogar');
  await acao(i.id, 'reativar');
  const acoes = (await db().select().from(auditoriaApp).where(eq(auditoriaApp.entidadeId, i.id))).map((l) => l.acao);
  expect(acoes).toEqual(expect.arrayContaining(['criar', 'verificar', 'revogar', 'reativar']));
});

it('integração inexistente → 404', async () => {
  expect((await acao('nao-existe', 'verificar', {})).status).toBe(404);
  expect((await chamar('/api/integracoes/nao-existe', { metodo: 'PATCH', corpo: {} })).status).toBe(404);
});
