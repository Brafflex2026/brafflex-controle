import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { usuario } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

const SERVICO = 'trilha-teste.access';
let app;
let assinar;
const db = () => drizzle(env.DB);
let n = 0;
let unico = 0;
const json = (r) => r.json();

async function sha(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function cadeia(qtd, cliente) {
  const linhas = [];
  let prev = '';
  for (let i = 1; i <= qtd; i++) {
    const ev = {
      ator: i === 1 ? 'COVO' : 'REVISOR',
      cmd: i === 1 ? 'abrir' : 'escalar',
      dados: i === 1 ? { caminho: 'curto', cliente, modo: 'SIMULACAO', titulo: `TESTE demanda ${++unico}` } : { motivo: `motivo ${i}` },
      n: i,
      prev,
      ts: `2026-11-1${i}T10:00:00`,
    };
    const texto = JSON.stringify(ev);
    linhas.push(texto);
    prev = await sha(texto);
  }
  return linhas;
}

// Entra uma demanda pelo mesmo caminho da vida real: o envio da trilha com o service token.
async function semear({ cliente = 'TESTE-Cliente Dem', status = 'Em produção', caminho = 'curto', eventos = 3, versao = 1, linhas: dadas } = {}) {
  const id = `D-${600 + ++n}`;
  const linhas = dadas ?? (await cadeia(eventos, cliente));
  const estado = { id, cliente, modo: 'SIMULACAO', custo_alto: false, caminho, status, versao, devolucoes: 0, pendencia: 'aguardando algo', bloqueios: [], escalacoes: [] };
  const r = await app.request(
    `/api/trilha/${id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': await assinar({ common_name: SERVICO }) },
      body: JSON.stringify({ linhas, estado, verificacao: `ÍNTEGRO: ${linhas.length} eventos íntegros` }),
    },
    env,
  );
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
  return { id, linhas, estado };
}

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-dem@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const editar = (id, corpo) => chamar(`/api/demandas/${id}`, { metodo: 'PATCH', corpo });
const ligar = (id, contratoId) => chamar(`/api/demandas/${id}/ligar-contrato`, { metodo: 'POST', corpo: { contratoId } });
const lerDemanda = (id) => env.DB.prepare('SELECT * FROM demanda WHERE id = ?').bind(id).first();
const auditorias = async (id, acao) =>
  (await env.DB.prepare('SELECT * FROM auditoria_app WHERE entidade = ? AND entidade_id = ? AND acao = ? ORDER BY id').bind('demanda', id, acao).all()).results;

async function novoContrato(marca) {
  const cli = await json(await chamar('/api/clientes', { metodo: 'POST', corpo: { nome: `TESTE-${marca}`, tipo: 'empresa' }, chave: `dcli-${++n}` }));
  return json(await chamar(`/api/clientes/${cli.id}/contratos`, { metodo: 'POST', corpo: { marca: `TESTE-${marca}`, tipo: 'só marketing' }, chave: `dcon-${++n}` }));
}

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-dem@exemplo.com', nome: 'TESTE-DEM', papel: 'rodrigo' });
});

// ---------------------------------------------------------------- J-DEM-04: quadro
it('a lista traz as demandas com os campos do cartão e a contagem por status', async () => {
  const a = await semear({ cliente: 'TESTE-Lista Um', status: 'Portão 1 — REVISOR' });
  await semear({ cliente: 'TESTE-Lista Um', status: 'Portão 1 — REVISOR' });
  const r = await chamar('/api/demandas?cliente=TESTE-Lista Um');
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j.itens).toHaveLength(2);
  expect(j.contagens['Portão 1 — REVISOR']).toBe(2);
  const item = j.itens.find((i) => i.id === a.id);
  expect(item).toMatchObject({ id: a.id, status: 'Portão 1 — REVISOR', clienteTexto: 'TESTE-Lista Um', caminho: 'curto', versao: 1, devolucoes: 0, semContrato: true });
  expect(item.titulo).toMatch(/^TESTE demanda/);
  expect(item).not.toHaveProperty('estado'); // o cartão não carrega o estado inteiro
  expect(item).not.toHaveProperty('linha');
});

it('os filtros por caminho, status, responsável e "sem contrato" funcionam', async () => {
  const longo = await semear({ cliente: 'TESTE-Filtro X', caminho: 'longo', status: 'Aprovado' });
  const curto = await semear({ cliente: 'TESTE-Filtro X', caminho: 'curto', status: 'Em produção' });
  await editar(curto.id, { responsavel: 'TESTE-Ana' });

  const ids = async (q) => (await json(await chamar(`/api/demandas?cliente=TESTE-Filtro X&${q}`))).itens.map((i) => i.id);
  expect(await ids('caminho=longo')).toEqual([longo.id]);
  expect(await ids('status=Em produção')).toEqual([curto.id]);
  expect(await ids('responsavel=TESTE-Ana')).toEqual([curto.id]);
  expect((await ids('semContrato=1')).sort()).toEqual([longo.id, curto.id].sort());
  expect(await ids('caminho=inexistente')).toEqual([]);
});

it('o filtro por contrato mostra só as demandas ligadas a ele', async () => {
  const k = await novoContrato('Filtro Contrato');
  const d = await semear({ cliente: 'TESTE-Outro Nome' });
  await semear({ cliente: 'TESTE-Outro Nome' });
  expect((await ligar(d.id, k.id)).status).toBe(200);
  const j = await json(await chamar(`/api/demandas?contrato=${k.id}`));
  expect(j.itens.map((i) => i.id)).toEqual([d.id]);
  expect(j.itens[0].marca).toBe('TESTE-Filtro Contrato');
  expect(j.itens[0].semContrato).toBe(false);
});

it('o filtro de cliente não trata % e _ como curingas', async () => {
  await semear({ cliente: 'TESTE-Curinga Z' });
  expect((await json(await chamar('/api/demandas?cliente=%25'))).itens).toHaveLength(0);
  expect((await json(await chamar('/api/demandas?cliente=_'))).itens).toHaveLength(0);
});

it('limita a lista e recusa status ou filtro absurdo sem quebrar', async () => {
  const r = await chamar('/api/demandas?status=' + 'x'.repeat(500));
  expect(r.status).toBe(200);
  expect((await json(r)).itens).toEqual([]);
  expect((await chamar('/api/demandas?contrato=nao-existe')).status).toBe(200);
});

it('o detalhe traz o estado inteiro e a linha do tempo na ordem', async () => {
  const d = await semear({ eventos: 4 });
  const r = await chamar(`/api/demandas/${d.id}`);
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j.demanda.id).toBe(d.id);
  expect(j.demanda.status).toBe('Em produção');
  expect(j.estado.pendencia).toBe('aguardando algo');
  expect(j.verificacao).toBe('ÍNTEGRO: 4 eventos íntegros');
  expect(j.eventos.map((e) => e.n)).toEqual([1, 2, 3, 4]);
  expect(j.eventos[0]).toMatchObject({ n: 1, cmd: 'abrir', ator: 'COVO' });
  expect(j.eventos[0].dados.caminho).toBe('curto');
  expect(j.eventos[0].hash).toMatch(/^[0-9a-f]{64}$/);
  expect(j.eventos[1].prev).toBe(j.eventos[0].hash);
  expect(j.eventos[0]).not.toHaveProperty('linha'); // o texto bruto fica no banco
});

it('demanda inexistente ou id estranho dá 404', async () => {
  expect((await chamar('/api/demandas/D-999999')).status).toBe(404);
  expect((await chamar('/api/demandas/qualquer-coisa')).status).toBe(404);
  expect((await editar('D-999999', { prazo: '2027-01-01' })).status).toBe(404);
  expect((await ligar('D-999999', 'x')).status).toBe(404);
});

// ---------------------------------------------------------------- J-DEM-05: edição limitada
it('edita prazo, responsável, minha pendência e próximo passo, com auditoria', async () => {
  const d = await semear();
  const r = await editar(d.id, { prazo: '2026-12-01', responsavel: 'TESTE-Rodrigo', pendenciaNota: 'esperar o logo', proximoPasso: 'enviar para aprovação' });
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j.demanda).toMatchObject({ prazo: '2026-12-01', responsavel: 'TESTE-Rodrigo', pendenciaNota: 'esperar o logo', proximoPasso: 'enviar para aprovação' });
  const linha = await lerDemanda(d.id);
  expect(linha.prazo).toBe('2026-12-01');
  expect(linha.status).toBe('Em produção'); // intocado
  const aud = await auditorias(d.id, 'alterar');
  expect(aud).toHaveLength(1);
  expect(aud[0].usuario).toBe('teste-dem@exemplo.com');
  expect(JSON.parse(aud[0].antes)).toEqual({ prazo: null, responsavel: null, pendenciaNota: null, proximoPasso: null });
  expect(JSON.parse(aud[0].depois).prazo).toBe('2026-12-01');
});

it('só grava o que mudou; igual não gera auditoria; vazio volta a "a confirmar"', async () => {
  const d = await semear();
  await editar(d.id, { responsavel: 'TESTE-Bia' });
  expect((await editar(d.id, { responsavel: 'TESTE-Bia' })).status).toBe(200);
  expect(await auditorias(d.id, 'alterar')).toHaveLength(1);
  const r = await editar(d.id, { responsavel: '   ' });
  expect(r.status).toBe(200);
  expect((await lerDemanda(d.id)).responsavel).toBeNull();
  expect(await auditorias(d.id, 'alterar')).toHaveLength(2);
});

it('o status e o resto não são editáveis pela API: recusa com 422 e nada muda', async () => {
  const d = await semear({ status: 'Em produção' });
  for (const campo of ['status', 'estado', 'titulo', 'contratoId', 'contrato_id', 'versao', 'devolucoes', 'nEventos', 'trilhaHead', 'id']) {
    const r = await editar(d.id, { [campo]: campo === 'versao' || campo === 'devolucoes' || campo === 'nEventos' ? 9 : 'Concluído' });
    expect(r.status, campo).toBe(422);
    expect((await json(r)).campo).toBe(campo);
  }
  // mesmo misturado com campo permitido: nada é gravado
  const r = await editar(d.id, { responsavel: 'TESTE-Zé', status: 'Concluído' });
  expect(r.status).toBe(422);
  const linha = await lerDemanda(d.id);
  expect(linha.status).toBe('Em produção');
  expect(linha.responsavel).toBeNull();
  expect(await auditorias(d.id, 'alterar')).toHaveLength(0);
});

it('corpo que não é um objeto é recusado', async () => {
  const d = await semear();
  for (const corpo of [[], 'texto', 5, null]) {
    const r = await editar(d.id, corpo);
    expect([422], JSON.stringify(corpo)).toContain(r.status);
  }
});

it('valida a data do prazo e os limites de tamanho', async () => {
  const d = await semear();
  for (const prazo of ['2026-02-30', '01/12/2026', '2019-01-01', '2101-01-01', 'amanhã', 20261201]) {
    const r = await editar(d.id, { prazo });
    expect(r.status, String(prazo)).toBe(422);
    expect((await json(r)).campo).toBe('prazo');
  }
  expect((await editar(d.id, { responsavel: 'x'.repeat(121) })).status).toBe(422);
  expect((await editar(d.id, { pendenciaNota: 'x'.repeat(501) })).status).toBe(422);
  expect((await editar(d.id, { proximoPasso: 'x'.repeat(501) })).status).toBe(422);
  expect((await editar(d.id, { proximoPasso: 'x'.repeat(500) })).status).toBe(200);
  expect((await lerDemanda(d.id)).prazo).toBeNull();
});

it('as anotações passam pela barreira de dado sensível', async () => {
  const d = await semear();
  for (const [campo, valor] of [
    ['pendenciaNota', 'paciente João da Silva, CPF 123.456.789-09'],
    ['proximoPasso', 'ligar para (11) 98765-4321'],
    ['responsavel', 'ana@clinica.com.br'],
    ['pendenciaNota', 'senha: abc12345'],
  ]) {
    const r = await editar(d.id, { [campo]: valor });
    expect(r.status, valor).toBe(422);
    const j = await json(r);
    expect(j.campo).toBe(campo);
    expect(JSON.stringify(j)).not.toContain('98765');
  }
  const linha = await lerDemanda(d.id);
  expect(linha.pendencia_nota).toBeNull();
  expect(await auditorias(d.id, 'alterar')).toHaveLength(0);
});

it('duas edições do mesmo ponto de partida: só uma vale, a outra recebe 409', async () => {
  const d = await semear();
  const [a, b] = await Promise.all([editar(d.id, { responsavel: 'TESTE-Primeira' }), editar(d.id, { responsavel: 'TESTE-Segunda' })]);
  const status = [a.status, b.status].sort();
  expect(status[0]).toBe(200);
  expect([200, 409]).toContain(status[1]);
  const venceu = (await lerDemanda(d.id)).responsavel;
  expect(['TESTE-Primeira', 'TESTE-Segunda']).toContain(venceu);
  expect((await auditorias(d.id, 'alterar')).length).toBe(status.filter((s) => s === 200).length);
});

it('reenviar a trilha depois da edição mantém as anotações e a ligação ao contrato', async () => {
  const k = await novoContrato('Mantem');
  const todas = await cadeia(5, 'TESTE-Cliente Dem');
  const d = await semear({ linhas: todas.slice(0, 3) });
  await editar(d.id, { prazo: '2026-12-15', proximoPasso: 'conferir' });
  expect((await ligar(d.id, k.id)).status).toBe(200);

  // a trilha anda: chegam mais dois eventos e o status muda
  const r = await app.request(
    `/api/trilha/${d.id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': await assinar({ common_name: SERVICO }) },
      body: JSON.stringify({ linhas: todas, estado: { ...d.estado, status: 'Aprovado', versao: 2 }, verificacao: 'ÍNTEGRO: 5 eventos íntegros' }),
    },
    env,
  );
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
  const linha = await lerDemanda(d.id);
  expect(linha.status).toBe('Aprovado');
  expect(linha.n_eventos).toBe(5);
  expect(linha.prazo).toBe('2026-12-15');
  expect(linha.proximo_passo).toBe('conferir');
  expect(linha.contrato_id).toBe(k.id);
});

// ---------------------------------------------------------------- ligar a contrato
it('liga uma demanda sem contrato a um contrato ativo, com auditoria', async () => {
  const k = await novoContrato('Ligar Ok');
  const d = await semear({ cliente: 'TESTE-Sem Marca Igual' });
  expect((await lerDemanda(d.id)).contrato_id).toBeNull();
  const r = await ligar(d.id, k.id);
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j.demanda.contratoId).toBe(k.id);
  expect(j.demanda.semContrato).toBe(false);
  expect((await lerDemanda(d.id)).contrato_id).toBe(k.id);
  const aud = await auditorias(d.id, 'ligar_contrato');
  expect(aud).toHaveLength(1);
  expect(JSON.parse(aud[0].antes)).toEqual({ contratoId: null });
  expect(JSON.parse(aud[0].depois)).toEqual({ contratoId: k.id });
});

it('demanda que já tem contrato não troca de contrato (409) e nada muda', async () => {
  const k1 = await novoContrato('Primeiro');
  const k2 = await novoContrato('Segundo');
  const d = await semear();
  await ligar(d.id, k1.id);
  const r = await ligar(d.id, k2.id);
  expect(r.status).toBe(409);
  expect((await lerDemanda(d.id)).contrato_id).toBe(k1.id);
  expect(await auditorias(d.id, 'ligar_contrato')).toHaveLength(1);
});

it('não liga a contrato inexistente, encerrado ou sem informar', async () => {
  const k = await novoContrato('Encerrado');
  expect((await chamar(`/api/contratos/${k.id}/encerrar`, { metodo: 'POST' })).status).toBe(200);
  const d = await semear();
  expect((await ligar(d.id, k.id)).status).toBe(409);
  expect((await ligar(d.id, 'nao-existe')).status).toBe(404);
  expect((await ligar(d.id, undefined)).status).toBe(422);
  expect((await ligar(d.id, 123)).status).toBe(422);
  expect((await lerDemanda(d.id)).contrato_id).toBeNull();
  expect(await auditorias(d.id, 'ligar_contrato')).toHaveLength(0);
});

it('duas ligações ao mesmo tempo: só uma vale', async () => {
  const k1 = await novoContrato('Corrida 1');
  const k2 = await novoContrato('Corrida 2');
  const d = await semear();
  const [a, b] = await Promise.all([ligar(d.id, k1.id), ligar(d.id, k2.id)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect(await auditorias(d.id, 'ligar_contrato')).toHaveLength(1);
});

// ---------------------------------------------------------------- acesso
it('o service token da trilha não entra nas rotas de demandas', async () => {
  const d = await semear();
  const h = { 'cf-access-jwt-assertion': await assinar({ common_name: SERVICO }), 'content-type': 'application/json' };
  expect((await app.request('/api/demandas', { headers: h }, env)).status).toBe(403);
  expect((await app.request(`/api/demandas/${d.id}`, { headers: h }, env)).status).toBe(403);
  expect((await app.request(`/api/demandas/${d.id}`, { method: 'PATCH', headers: h, body: '{"prazo":"2026-12-01"}' }, env)).status).toBe(403);
  expect((await app.request(`/api/demandas/${d.id}/ligar-contrato`, { method: 'POST', headers: h, body: '{}' }, env)).status).toBe(403);
});

it('sem login não lê nem edita', async () => {
  expect((await app.request('/api/demandas', {}, env)).status).toBe(401);
  expect((await app.request('/api/demandas/D-601', { method: 'PATCH', body: '{}' }, env)).status).toBe(401);
});
