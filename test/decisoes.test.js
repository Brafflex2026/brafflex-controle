import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { usuario } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

let app;
let assinar;
let n = 0;
const db = () => drizzle(env.DB);
const json = (r) => r.json();
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-dec@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const base = (extra = {}) => ({ data: hoje(), nivel: 3, quem: 'TESTE-Rodrigo', titulo: `TESTE decisão ${++n}`, decisao: 'decidiu isto', ...extra });
const criar = (corpo = base(), chave = `dec-${++n}`) => chamar('/api/decisoes', { metodo: 'POST', corpo, chave });
const criarProposta = (corpo = { titulo: `TESTE proposta ${++n}`, texto: 'texto da proposta' }, chave = `prop-${++n}`) => chamar('/api/propostas', { metodo: 'POST', corpo, chave });
const auditorias = async (entidade, id) => (await env.DB.prepare('SELECT * FROM auditoria_app WHERE entidade = ? AND entidade_id = ? ORDER BY id').bind(entidade, id).all()).results;

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-dec@exemplo.com', nome: 'TESTE-DEC', papel: 'rodrigo' });
});

// ---------------------------------------------------------------- J-DEC-01
it('registra uma decisão com número DEC-NNN e auditoria', async () => {
  const r = await criar(base({ demandaRef: 'D-001', motivo: 'porque sim', comoDesfazer: 'nova decisão' }));
  expect(r.status).toBe(201);
  const { decisao } = await json(r);
  expect(decisao.id).toMatch(/^DEC-\d{3,}$/);
  expect(decisao).toMatchObject({ nivel: 3, quem: 'TESTE-Rodrigo', demandaRef: 'D-001', motivo: 'porque sim', comoDesfazer: 'nova decisão', origem: 'app', criadoPor: 'teste-dec@exemplo.com' });
  expect(decisao).not.toHaveProperty('chave');
  const aud = await auditorias('decisao', decisao.id);
  expect(aud).toHaveLength(1);
  expect(aud[0].acao).toBe('criar');
});

it('numera em sequência, sem repetir', async () => {
  const a = (await json(await criar())).decisao.id;
  const b = (await json(await criar())).decisao.id;
  expect(Number(b.slice(4))).toBe(Number(a.slice(4)) + 1);
});

it('repetir o mesmo envio (mesma chave) não cria outra decisão', async () => {
  const corpo = base();
  const a = await criar(corpo, 'dec-fixa');
  const b = await criar(corpo, 'dec-fixa');
  expect(a.status).toBe(201);
  expect(b.status).toBe(200);
  const id = (await json(a)).decisao.id;
  expect((await json(b)).decisao.id).toBe(id);
  expect(await auditorias('decisao', id)).toHaveLength(1);
});

it('decisão e proposta não podem ser alteradas nem apagadas: 405', async () => {
  const d = (await json(await criar())).decisao.id;
  const p = (await json(await criarProposta())).proposta.id;
  for (const [metodo, caminho] of [['PATCH', `/api/decisoes/${d}`], ['PUT', `/api/decisoes/${d}`], ['DELETE', `/api/decisoes/${d}`], ['DELETE', '/api/decisoes'], ['PATCH', `/api/propostas/${p}`], ['PUT', `/api/propostas/${p}`], ['DELETE', `/api/propostas/${p}`], ['DELETE', '/api/propostas']]) {
    const r = await chamar(caminho, { metodo, corpo: { titulo: 'x' } });
    expect(r.status, `${metodo} ${caminho}`).toBe(405);
  }
  expect((await json(await chamar(`/api/decisoes/${d}`))).decisao.decisao).toBe('decidiu isto');
});

it('o banco também recusa UPDATE e DELETE de decisão e de proposta', async () => {
  const d = (await json(await criar())).decisao.id;
  const p = (await json(await criarProposta())).proposta.id;
  await expect(env.DB.prepare('UPDATE decisao SET decisao = ? WHERE id = ?').bind('outra', d).run()).rejects.toThrow();
  await expect(env.DB.prepare('DELETE FROM decisao WHERE id = ?').bind(d).run()).rejects.toThrow();
  await expect(env.DB.prepare('UPDATE proposta SET texto = ? WHERE id = ?').bind('outro', p).run()).rejects.toThrow();
  await expect(env.DB.prepare('DELETE FROM proposta WHERE id = ?').bind(p).run()).rejects.toThrow();
});

// ---------------------------------------------------------------- validação
it('exige data, nível 2 ou 3, quem, título e decisão', async () => {
  for (const [campo, valor] of [['data', undefined], ['data', '2026-02-30'], ['data', '01/11/2026'], ['nivel', 1], ['nivel', '3'], ['quem', ''], ['titulo', '  '], ['decisao', undefined]]) {
    const r = await criar({ ...base(), [campo]: valor });
    expect(r.status, `${campo}=${valor}`).toBe(422);
    expect((await json(r)).campo).toBe(campo);
  }
});

it('data no futuro é recusada; limites de tamanho valem', async () => {
  expect((await criar(base({ data: '2099-01-01' }))).status).toBe(422);
  expect((await criar(base({ titulo: 'x'.repeat(201) }))).status).toBe(422);
  expect((await criar(base({ decisao: 'x'.repeat(20_001) }))).status).toBe(422);
  expect((await criar(base({ demandaRef: 'x'.repeat(121) }))).status).toBe(422);
});

it('corpo que não é objeto é recusado e a chave é obrigatória', async () => {
  for (const corpo of [[], 'texto', null]) expect((await criar(corpo)).status).toBe(422);
  const semChave = await app.request('/api/decisoes', { method: 'POST', headers: { 'cf-access-jwt-assertion': await assinar({ email: 'teste-dec@exemplo.com' }), 'content-type': 'application/json' }, body: JSON.stringify(base()) }, env);
  expect(semChave.status).toBe(400);
});

it('campos desconhecidos (id, origem, criadoPor) são recusados', async () => {
  for (const campo of ['id', 'origem', 'criadoPor', 'chave']) {
    const r = await criar({ ...base(), [campo]: 'DEC-999' });
    expect(r.status, campo).toBe(422);
    expect((await json(r)).campo).toBe(campo);
  }
});

it('dado sensível nos textos é barrado e nada é gravado', async () => {
  const antes = (await env.DB.prepare('SELECT COUNT(*) c FROM decisao').first()).c;
  for (const campo of ['decisao', 'motivo', 'titulo', 'comoDesfazer']) {
    const r = await criar(base({ [campo]: 'paciente João da Silva, CPF 123.456.789-09' }));
    expect(r.status, campo).toBe(422);
    const j = await json(r);
    expect(j.campo).toBe(campo);
    expect(JSON.stringify(j)).not.toContain('123.456');
  }
  expect((await env.DB.prepare('SELECT COUNT(*) c FROM decisao').first()).c).toBe(antes);
});

// ---------------------------------------------------------------- correção e ligações
it('correção: nova decisão aponta a antiga, que continua igual', async () => {
  const antiga = (await json(await criar(base({ decisao: 'versão errada' })))).decisao;
  const r = await criar(base({ decisao: 'versão certa', corrigeId: antiga.id }));
  expect(r.status).toBe(201);
  const nova = (await json(r)).decisao;
  expect(nova.corrigeId).toBe(antiga.id);
  const lida = (await json(await chamar(`/api/decisoes/${antiga.id}`))).decisao;
  expect(lida.decisao).toBe('versão errada');
  expect((await json(await chamar(`/api/decisoes/${antiga.id}`))).corrigidaPor).toEqual([nova.id]);
});

it('corrigeId e propostaId precisam existir', async () => {
  const a = await criar(base({ corrigeId: 'DEC-999999' }));
  expect(a.status).toBe(422);
  expect((await json(a)).campo).toBe('corrigeId');
  const b = await criar(base({ propostaId: 'P-999999' }));
  expect(b.status).toBe(422);
  expect((await json(b)).campo).toBe('propostaId');
});

it('proposta recebe número P-NNN e a decisão que a aprova aparece ligada a ela', async () => {
  const rp = await criarProposta({ titulo: 'TESTE mudar algo', texto: 'texto longo\ncom linhas' });
  expect(rp.status).toBe(201);
  const p = (await json(rp)).proposta;
  expect(p.id).toMatch(/^P-\d{3,}$/);
  expect(p.texto).toBe('texto longo\ncom linhas');
  const d = (await json(await criar(base({ propostaId: p.id, titulo: `${p.id} aprovada` })))).decisao;
  const detalhe = await json(await chamar(`/api/propostas/${p.id}`));
  expect(detalhe.decisoes.map((x) => x.id)).toEqual([d.id]);
  expect(await auditorias('proposta', p.id)).toHaveLength(1);
});

it('proposta: valida título e texto, barra dado sensível e é idempotente', async () => {
  expect((await criarProposta({ titulo: '', texto: 'x' })).status).toBe(422);
  expect((await criarProposta({ titulo: 'x', texto: '' })).status).toBe(422);
  expect((await criarProposta({ titulo: 'x', texto: 'y'.repeat(20_001) })).status).toBe(422);
  expect((await criarProposta({ titulo: 'x', texto: 'senha: abc12345' })).status).toBe(422);
  const a = await criarProposta(undefined, 'prop-fixa');
  const b = await criarProposta(undefined, 'prop-fixa');
  expect([a.status, b.status]).toEqual([201, 200]);
});

// ---------------------------------------------------------------- leitura
it('lista com filtros de demanda, nível e busca; detalhe 404 para número que não existe', async () => {
  const x = (await json(await criar(base({ demandaRef: 'D-777', nivel: 2, titulo: 'TESTE buscável zzz' })))).decisao;
  await criar(base({ demandaRef: 'D-778', nivel: 3 }));
  const ids = async (q) => (await json(await chamar(`/api/decisoes?${q}`))).itens.map((i) => i.id);
  expect((await json(await chamar('/api/decisoes'))).importada).toBe(false);
  expect(await ids('demanda=D-777')).toEqual([x.id]);
  expect(await ids('demanda=D-777&nivel=3')).toEqual([]);
  expect(await ids('q=buscável zzz')).toEqual([x.id]);
  expect(await ids('q=%25')).toEqual([]);
  expect((await chamar('/api/decisoes/DEC-999999')).status).toBe(404);
  expect((await chamar('/api/decisoes/qualquer')).status).toBe(404);
  expect((await chamar('/api/propostas/P-999999')).status).toBe(404);
});

it('a lista da demanda traz só as decisões dela', async () => {
  const d = (await json(await criar(base({ demandaRef: 'D-880' })))).decisao;
  const j = await json(await chamar('/api/decisoes?demanda=D-880'));
  expect(j.itens.map((i) => i.id)).toEqual([d.id]);
  expect(j.itens[0]).toHaveProperty('titulo');
});

// ---------------------------------------------------------------- acesso
it('sem login não lê nem registra; service token da trilha não entra', async () => {
  expect((await app.request('/api/decisoes', {}, env)).status).toBe(401);
  expect((await app.request('/api/propostas', { method: 'POST', body: '{}' }, env)).status).toBe(401);
  const h = { 'cf-access-jwt-assertion': await assinar({ common_name: 'trilha-teste.access' }), 'content-type': 'application/json' };
  expect((await app.request('/api/decisoes', { headers: h }, env)).status).toBe(403);
  expect((await app.request('/api/propostas', { method: 'POST', headers: { ...h, 'idempotency-key': 'k' }, body: '{}' }, env)).status).toBe(403);
});
