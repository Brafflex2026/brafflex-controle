import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { usuario } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

// As trilhas reais de simulação ficam só no PC do Rodrigo (fora do Git, repositório público). Sem o arquivo, os testes que dependem dele são pulados.
const arquivos = import.meta.glob('./fixtures/trilhas-reais.json', { eager: true, import: 'default' });
const trilhasReais = Object.values(arquivos)[0] ?? {};
const temTrilhasReais = Object.keys(trilhasReais).length > 0;

const SERVICO = 'trilha-teste.access'; // common_name do service token configurado em TRILHA_COMMON_NAME
let app;
let assinar;
const db = () => drizzle(env.DB);
let seq = 100;
const novoId = () => `D-${900 + ++seq}`;

async function sha(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Cadeia sintética no mesmo formato do trilha.py: chaves em ordem alfabética, prev = sha256 do texto da linha anterior.
async function cadeia(qtd, { cliente = 'TESTE-Cliente', alterar } = {}) {
  const linhas = [];
  let prev = '';
  for (let n = 1; n <= qtd; n++) {
    let ev = {
      ator: 'COVO',
      cmd: n === 1 ? 'abrir' : 'escalar',
      dados: n === 1 ? { caminho: 'curto', cliente, modo: 'SIMULACAO', titulo: 'TESTE titulo' } : { motivo: `motivo ${n}` },
      n,
      prev,
      ts: '2026-11-14T10:00:00',
    };
    if (alterar) ev = alterar(ev, n) ?? ev;
    const texto = JSON.stringify(ev);
    linhas.push(texto);
    prev = await sha(texto);
  }
  return linhas;
}
const estadoDe = (id, over = {}) => ({ id, cliente: 'TESTE-Cliente', modo: 'SIMULACAO', custo_alto: false, caminho: 'curto', status: 'Aguardando Rodrigo', versao: 0, devolucoes: 0, ...over });
const verificacaoDe = (n) => `ÍNTEGRO: ${n} eventos íntegros`;
const corpoDe = (id, linhas, over = {}) => ({ linhas, estado: estadoDe(id), verificacao: verificacaoDe(linhas.length), ...over });

async function enviar(id, corpo, { email, commonName = SERVICO, aud, ambiente = env, semJwt = false, metodo = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (!semJwt) {
    const claims = email ? { email } : { common_name: commonName };
    headers['cf-access-jwt-assertion'] = await assinar(claims, aud ? { audience: aud } : {});
  }
  return app.request(`/api/trilha/${id}`, { method: metodo, headers, body: metodo === 'GET' ? undefined : JSON.stringify(corpo) }, ambiente);
}
const lerDemanda = (id) => env.DB.prepare('SELECT * FROM demanda WHERE id = ?').bind(id).first();
const contarEventos = async (id) => (await env.DB.prepare('SELECT COUNT(*) AS c FROM trilha_evento WHERE demanda_id = ?').bind(id).first()).c;
const json = (r) => r.json();

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-tri@exemplo.com', nome: 'TESTE-TRI', papel: 'rodrigo' });
});

// ---------------------------------------------------------------- J-DEM-01
it.skipIf(!temTrilhasReais)('J-DEM-01: as 9 trilhas reais são gravadas com o estado igual ao calculado pelo trilha.py', async () => {
  for (const [id, pacote] of Object.entries(trilhasReais)) {
    const r = await enviar(id, pacote);
    expect(r.status, `${id}: ${JSON.stringify(await r.clone().json())}`).toBe(200);
    const j = await json(r);
    expect(j.aceitas).toBe(pacote.linhas.length);
    expect(j.ignoradas).toBe(0);

    const d = await lerDemanda(id);
    expect(JSON.parse(d.estado)).toEqual(pacote.estado); // o estado gravado é exatamente o do trilha.py
    expect(d.status).toBe(pacote.estado.status);
    expect(d.versao).toBe(pacote.estado.versao);
    expect(d.devolucoes).toBe(pacote.estado.devolucoes);
    expect(d.n_eventos).toBe(pacote.linhas.length);
    expect(await contarEventos(id)).toBe(pacote.linhas.length);

    const eventos = (await env.DB.prepare('SELECT n, linha, hash, prev FROM trilha_evento WHERE demanda_id = ? ORDER BY n').bind(id).all()).results;
    expect(eventos.map((e) => e.linha)).toEqual(pacote.linhas); // o texto exato, na ordem
    expect(eventos[0].prev).toBe('');
    expect(d.trilha_head).toBe(eventos.at(-1).hash);
  }
});

it('reenvio idêntico é ignorado e não grava nada', async () => {
  const id = novoId();
  const linhas = await cadeia(6);
  const pacote = corpoDe(id, linhas);
  expect((await enviar(id, pacote)).status).toBe(200);
  const antes = await lerDemanda(id);
  const r = await enviar(id, pacote);
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j.aceitas).toBe(0);
  expect(j.ignoradas).toBe(pacote.linhas.length);
  expect(await lerDemanda(id)).toEqual(antes);
  expect(await contarEventos(id)).toBe(pacote.linhas.length);
});

it('envio incremental: linhas novas entram, as antigas são ignoradas', async () => {
  const id = novoId();
  const todas = await cadeia(8);
  expect((await enviar(id, corpoDe(id, todas.slice(0, 5)))).status).toBe(200);
  const r = await enviar(id, corpoDe(id, todas));
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j.aceitas).toBe(3);
  expect(j.ignoradas).toBe(5);
  expect(await contarEventos(id)).toBe(8);
  expect((await lerDemanda(id)).n_eventos).toBe(8);
});

it('envio só das linhas novas (sem repetir as antigas) também encaixa na cadeia', async () => {
  const id = novoId();
  const todas = await cadeia(6);
  await enviar(id, corpoDe(id, todas.slice(0, 4)));
  const r = await enviar(id, { linhas: todas.slice(4), estado: estadoDe(id), verificacao: verificacaoDe(6) });
  expect(r.status).toBe(200);
  expect((await json(r)).aceitas).toBe(2);
  expect(await contarEventos(id)).toBe(6);
});

it('demanda sem contrato vai para "sem contrato"; com marca igual a um único contrato, é ligada', async () => {
  const semContrato = novoId();
  await enviar(semContrato, corpoDe(semContrato, await cadeia(2, { cliente: 'TESTE-Ninguém' }), { estado: estadoDe(semContrato, { cliente: 'TESTE-Ninguém' }) }));
  const a = await lerDemanda(semContrato);
  expect(a.contrato_id).toBeNull();

  // cria cliente e contrato pelo app, como o Rodrigo faria
  const h = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-tri@exemplo.com' }), 'content-type': 'application/json' };
  const cli = await json(await app.request('/api/clientes', { method: 'POST', headers: { ...h, 'idempotency-key': 'tri-cli' }, body: JSON.stringify({ nome: 'TESTE-Cli', tipo: 'empresa' }) }, env));
  const con = await json(await app.request(`/api/clientes/${cli.id}/contratos`, { method: 'POST', headers: { ...h, 'idempotency-key': 'tri-con' }, body: JSON.stringify({ marca: 'TESTE-Marca Ligada', tipo: 'só marketing' }) }, env));

  const ligada = novoId();
  await enviar(ligada, corpoDe(ligada, await cadeia(2, { cliente: 'teste-marca ligada' }), { estado: estadoDe(ligada, { cliente: 'teste-marca ligada' }) }));
  expect((await lerDemanda(ligada)).contrato_id).toBe(con.id);
});

// ---------------------------------------------------------------- J-DEM-02
it('J-DEM-02: linha adulterada no meio → 409 e nada gravado', async () => {
  const id = novoId();
  const linhas = await cadeia(6);
  const adulterada = [...linhas];
  adulterada[2] = adulterada[2].replace('motivo 3', 'motivo TROCADO');
  const r = await enviar(id, corpoDe(id, adulterada));
  expect(r.status).toBe(409);
  const j = await json(r);
  expect(j.linha).toBe(4); // a linha seguinte à adulterada não fecha o hash
  expect(j.motivo).toMatch(/cadeia/i);
  expect(await lerDemanda(id)).toBeNull();
  expect(await contarEventos(id)).toBe(0);
});

it('J-DEM-02: linhas fora de ordem e com buraco → 409 e nada gravado', async () => {
  const id = novoId();
  const linhas = await cadeia(5);
  const trocada = [linhas[0], linhas[2], linhas[1], linhas[3], linhas[4]];
  expect((await enviar(id, corpoDe(id, trocada))).status).toBe(409);
  const buraco = [linhas[0], linhas[1], linhas[3], linhas[4]];
  expect((await enviar(id, corpoDe(id, buraco))).status).toBe(409);
  expect(await contarEventos(id)).toBe(0);
  expect(await lerDemanda(id)).toBeNull();
});

it('J-DEM-02: começar em n maior que o gravado (buraco com o que já existe) → 409', async () => {
  const id = novoId();
  const linhas = await cadeia(6);
  await enviar(id, corpoDe(id, linhas.slice(0, 2)));
  const r = await enviar(id, { linhas: linhas.slice(3), estado: estadoDe(id), verificacao: verificacaoDe(6) });
  expect(r.status).toBe(409);
  expect(await contarEventos(id)).toBe(2);
});

it('J-DEM-02: linha com n já gravado mas conteúdo diferente → 409 e nada novo gravado', async () => {
  const id = novoId();
  const linhas = await cadeia(5);
  await enviar(id, corpoDe(id, linhas.slice(0, 3)));
  const outra = await cadeia(5, { alterar: (ev, n) => (n === 2 ? { ...ev, dados: { motivo: 'REESCRITA' } } : ev) });
  const r = await enviar(id, corpoDe(id, outra));
  expect(r.status).toBe(409);
  expect((await json(r)).motivo).toMatch(/diferente/i);
  expect(await contarEventos(id)).toBe(3);
});

it('J-DEM-02: primeira linha tem que ser "abrir" com n = 1 e prev vazio', async () => {
  const id = novoId();
  const semAbrir = await cadeia(3, { alterar: (ev, n) => (n === 1 ? { ...ev, cmd: 'escalar' } : ev) });
  expect((await enviar(id, corpoDe(id, semAbrir))).status).toBe(409);
  const prevErrado = await cadeia(3, { alterar: (ev, n) => (n === 1 ? { ...ev, prev: 'a'.repeat(64) } : ev) });
  expect((await enviar(id, corpoDe(id, prevErrado))).status).toBe(409);
  expect(await lerDemanda(id)).toBeNull();
});

it('verificação do PC que não é "ÍNTEGRO" ou não bate com as linhas → 409', async () => {
  const id = novoId();
  const linhas = await cadeia(4);
  expect((await enviar(id, corpoDe(id, linhas, { verificacao: 'ADULTERADO: cadeia quebrada na linha 3' }))).status).toBe(409);
  expect((await enviar(id, corpoDe(id, linhas, { verificacao: verificacaoDe(9) }))).status).toBe(409);
  expect((await enviar(id, corpoDe(id, linhas, { verificacao: undefined }))).status).toBe(422);
  expect(await lerDemanda(id)).toBeNull();
});

// ---------------------------------------------------------------- J-DEM-03
it('J-DEM-03: dado sensível numa linha → 422 com linha e motivo, sem devolver o valor e sem gravar', async () => {
  const id = novoId();
  const linhas = await cadeia(5, { alterar: (ev, n) => (n === 3 ? { ...ev, dados: { motivo: 'paciente com CPF 111.444.777-35' } } : ev) });
  const r = await enviar(id, corpoDe(id, linhas));
  expect(r.status).toBe(422);
  const j = await json(r);
  expect(j.campo).toBe('linhas');
  expect(j.linha).toBe(3);
  expect(j.motivo).toMatch(/CPF/);
  expect(JSON.stringify(j)).not.toContain('111.444.777-35');
  expect(await lerDemanda(id)).toBeNull();
  expect(await contarEventos(id)).toBe(0);
});

it('J-DEM-03: dado sensível no estado → 422; hashes de 64 caracteres NÃO são barrados', async () => {
  const id = novoId();
  const linhas = await cadeia(2, { alterar: (ev, n) => (n === 2 ? { ...ev, dados: { hash: 'ab'.repeat(32), motivo: 'ok' } } : ev) });
  const ruim = await enviar(id, corpoDe(id, linhas, { estado: estadoDe(id, { pendencia: 'ligar para (11) 91234-5678' }) }));
  expect(ruim.status).toBe(422);
  expect((await json(ruim)).campo).toBe('estado');
  expect(await lerDemanda(id)).toBeNull();
  const bom = await enviar(id, corpoDe(id, linhas));
  expect(bom.status).toBe(200);
});

// ---------------------------------------------------------------- formato e limites
it('corpo e linhas mal formados → 422', async () => {
  const id = novoId();
  const linhas = await cadeia(2);
  const casos = [
    { linhas: 'texto', estado: estadoDe(id), verificacao: verificacaoDe(1) },
    { linhas: [], estado: estadoDe(id), verificacao: verificacaoDe(0) },
    { linhas: ['isto não é json'], estado: estadoDe(id), verificacao: verificacaoDe(1) },
    { linhas: [JSON.stringify({ n: 1 })], estado: estadoDe(id), verificacao: verificacaoDe(1) },
    { linhas: [linhas[0].replace('"cmd"', '"intruso":1,"cmd"')], estado: estadoDe(id), verificacao: verificacaoDe(1) },
    { linhas: [linhas[0]], estado: 'nada', verificacao: verificacaoDe(1) },
    { linhas: [linhas[0]], estado: estadoDe('D-999'), verificacao: verificacaoDe(1) }, // id do estado diferente da rota
    { linhas: [linhas[0]], estado: estadoDe(id, { versao: -1 }), verificacao: verificacaoDe(1) },
  ];
  for (const c of casos) expect((await enviar(id, c)).status, JSON.stringify(c).slice(0, 80)).toBe(422);
  expect((await enviar('X-1', corpoDe('X-1', linhas))).status).toBe(422); // id da demanda inválido
  expect(await lerDemanda(id)).toBeNull();
});

it('limites: linha grande demais e linhas demais → 422 ou 413', async () => {
  const id = novoId();
  const grande = JSON.stringify({ ator: 'COVO', cmd: 'abrir', dados: { x: 'a'.repeat(21000) }, n: 1, prev: '', ts: '2026-11-14T10:00:00' });
  expect((await enviar(id, corpoDe(id, [grande]))).status).toBe(422);
  const r = await app.request(`/api/trilha/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': await assinar({ common_name: SERVICO }), 'content-length': '3000000' },
    body: JSON.stringify({ linhas: ['x'] }),
  }, env);
  expect(r.status).toBe(413);
});

it('200 linhas são gravadas em até 5 segundos', async () => {
  const id = novoId();
  const linhas = await cadeia(200);
  const inicio = performance.now();
  const r = await enviar(id, corpoDe(id, linhas));
  const ms = performance.now() - inicio;
  expect(r.status).toBe(200);
  expect(ms).toBeLessThan(5000);
  expect(await contarEventos(id)).toBe(200);
});

it('dois envios simultâneos da mesma demanda: ficam consistentes, sem duplicar', async () => {
  const id = novoId();
  const linhas = await cadeia(10);
  const [a, b] = await Promise.all([enviar(id, corpoDe(id, linhas)), enviar(id, corpoDe(id, linhas))]);
  expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
  expect([a.status, b.status]).toContain(200);
  expect(await contarEventos(id)).toBe(10);
  expect((await lerDemanda(id)).n_eventos).toBe(10);
  const auditorias = (await env.DB.prepare("SELECT COUNT(*) AS c FROM auditoria_app WHERE entidade = 'demanda' AND entidade_id = ?").bind(id).first()).c;
  expect(auditorias).toBeLessThanOrEqual(2);
});

it('grava auditoria do envio, com o serviço como autor', async () => {
  const id = novoId();
  await enviar(id, corpoDe(id, await cadeia(3)));
  const a = await env.DB.prepare("SELECT usuario, acao FROM auditoria_app WHERE entidade = 'demanda' AND entidade_id = ?").bind(id).first();
  expect(a.acao).toBe('enviar_trilha');
  expect(a.usuario).toBe(`servico:${SERVICO}`);
});

it('a trilha só aceita acréscimo: o banco recusa UPDATE e DELETE dos eventos', async () => {
  const id = novoId();
  await enviar(id, corpoDe(id, await cadeia(3)));
  await expect(env.DB.prepare('UPDATE trilha_evento SET cmd = ? WHERE demanda_id = ?').bind('x', id).run()).rejects.toThrow(/acréscimo/);
  await expect(env.DB.prepare('DELETE FROM trilha_evento WHERE demanda_id = ?').bind(id).run()).rejects.toThrow(/acréscimo/);
});

// ---------------------------------------------------------------- segurança do acesso (S1)
it('sem JWT → 401; JWT de outro aud → 401', async () => {
  const id = novoId();
  const corpo = corpoDe(id, await cadeia(2));
  expect((await enviar(id, corpo, { semJwt: true })).status).toBe(401);
  expect((await enviar(id, corpo, { aud: 'outro-aud' })).status).toBe(401);
  expect(await lerDemanda(id)).toBeNull();
});

it('service token com outro common_name → 403; sem TRILHA_COMMON_NAME configurado → 403', async () => {
  const id = novoId();
  const corpo = corpoDe(id, await cadeia(2));
  expect((await enviar(id, corpo, { commonName: 'outro-token.access' })).status).toBe(403);
  expect((await enviar(id, corpo, { ambiente: { ...env, TRILHA_COMMON_NAME: '' } })).status).toBe(403);
  expect((await enviar(id, corpo, { ambiente: { ...env, TRILHA_COMMON_NAME: undefined } })).status).toBe(403);
  expect(await lerDemanda(id)).toBeNull();
});

it('um usuário com e-mail NÃO pode usar a rota de envio da trilha → 403', async () => {
  const id = novoId();
  expect((await enviar(id, corpoDe(id, await cadeia(2)), { email: 'teste-tri@exemplo.com' })).status).toBe(403);
  expect(await lerDemanda(id)).toBeNull();
});

it('o service token só serve para o envio: em qualquer outra rota ou método → 403', async () => {
  const headers = async () => ({ 'cf-access-jwt-assertion': await assinar({ common_name: SERVICO }), 'content-type': 'application/json' });
  const tenta = async (caminho, metodo = 'GET', corpo) => (await app.request(caminho, { method: metodo, headers: await headers(), body: corpo ? JSON.stringify(corpo) : undefined }, env)).status;
  expect(await tenta('/api/eu')).toBe(403);
  expect(await tenta('/api/clientes')).toBe(403);
  expect(await tenta('/api/clientes', 'POST', { nome: 'x', tipo: 'pessoa' })).toBe(403);
  expect(await tenta('/api/auditoria')).toBe(403);
  expect(await tenta('/api/trilha/D-120', 'GET')).toBe(403);
  expect(await tenta('/api/trilha/D-120', 'PUT', {})).toBe(403);
  expect(await tenta('/api/trilha/D-120/extra', 'POST', {})).toBe(403);
});
