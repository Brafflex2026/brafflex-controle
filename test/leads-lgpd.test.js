import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { usuario } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { aplicarRetencao } from '../worker/retencao.js';
import { cenarioToken } from './ajuda-token.js';

let app;
let assinar;
let n = 0;
const db = () => drizzle(env.DB);
const json = (r) => r.json();

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-lgpd@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const telefone = () => `2199${String(2000000 + ++n).slice(-7)}`;
const placeId = () => `ChIJ${'B'.repeat(10)}${String(200000 + ++n)}_teste`;
const base = (extra = {}) => ({ funilId: 'etiqueteria', empresa: `TESTE-Gráfica LGPD ${++n}`, origem: 'Google Maps (API)', baseLegal: 'legítimo interesse', ...extra });
const criar = (corpo = base(), chave = `lgpd-${++n}`) => chamar('/api/leads', { metodo: 'POST', corpo, chave });
const novo = async (extra) => (await json(await criar(base(extra)))).lead;
const evento = (id, corpo) => chamar(`/api/leads/${id}/eventos`, { metodo: 'POST', corpo });
const optout = (id, corpo) => chamar(`/api/leads/${id}/optout`, { metodo: 'POST', corpo });
const converter = (id, corpo) => chamar(`/api/leads/${id}/converter`, { metodo: 'POST', corpo });
const ganho = async (extra) => {
  const l = await novo(extra);
  expect((await evento(l.id, { tipo: 'estagio', estagioId: 'etiqueteria-8' })).status).toBe(201);
  return l;
};
const perdido = async (extra) => {
  const l = await novo(extra);
  expect((await evento(l.id, { tipo: 'estagio', estagioId: 'etiqueteria-11', motivoPerda: 'sem resposta', nota: 'falou com a dona Zuleide' })).status).toBe(201);
  return l;
};
const auditorias = async (id) => (await env.DB.prepare('SELECT * FROM auditoria_app WHERE entidade_id = ? ORDER BY id').bind(id).all()).results;
const linha = (id) => env.DB.prepare('SELECT * FROM lead WHERE id = ?').bind(id).first();

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-lgpd@exemplo.com', nome: 'TESTE-LGPD', papel: 'rodrigo' });
});

// ---------------------------------------------------------------- J-LEAD-03: opt-out
it('opt-out apaga o contato, move para Não contatar e guarda só o hash do telefone e do Place ID', async () => {
  const tel = telefone();
  const pid = placeId();
  const l = await novo({ contato: 'Dona Zuleide Pereira', telefone: tel, placeId: pid, observacoes: 'tem filha que ajuda', consentimentoComo: 'x', proximoPasso: 'ligar', proximoPassoEm: '2030-01-01' });
  const r = await optout(l.id);
  expect(r.status).toBe(200);
  const { lead } = await json(r);
  expect(lead).toMatchObject({ estagioNome: 'Não contatar', final: 'Não contatar', contato: null, telefone: null, placeId: null, observacoes: null, proximoPasso: null, proximoPassoEm: null, empresa: l.empresa, vencido: false });
  expect(lead.optOutEm).toBeTruthy();

  const c = await linha(l.id);
  expect(c).toMatchObject({ contato: null, telefone: null, place_id: null, observacoes: null, consentimento_como: null });
  const bloq = (await env.DB.prepare('SELECT * FROM contato_bloqueado').all()).results;
  const meus = bloq.filter((b) => /^[0-9a-f]{64}$/.test(b.hash));
  expect(meus.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(bloq)).not.toContain(tel);
  expect(JSON.stringify(bloq)).not.toContain(pid);
  expect(new Set(bloq.map((b) => b.tipo))).toEqual(new Set(['telefone', 'place_id']));
});

it('depois do opt-out, recadastrar o telefone ou o Place ID dá 409 sem dizer qual lead era', async () => {
  const tel = telefone();
  const pid = placeId();
  const l = await novo({ telefone: tel, placeId: pid });
  await optout(l.id);
  for (const variante of [tel, `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`, `+55${tel}`]) {
    const r = await criar(base({ telefone: variante }));
    expect(r.status, variante).toBe(409);
    const j = await json(r);
    expect(j).toMatchObject({ campo: 'telefone', optOut: true });
    expect(j).not.toHaveProperty('leadId');
    expect(JSON.stringify(j)).not.toContain(l.id);
  }
  const rp = await criar(base({ placeId: pid }));
  expect(rp.status).toBe(409);
  expect(await json(rp)).toMatchObject({ campo: 'placeId', optOut: true });

  // Também na edição de outro lead.
  const outro = await novo({});
  const e = await chamar(`/api/leads/${outro.id}`, { metodo: 'PATCH', corpo: { telefone: tel } });
  expect(e.status).toBe(409);
  expect((await json(e)).optOut).toBe(true);
  expect((await linha(outro.id)).telefone).toBeNull();
});

it('opt-out não deixa dado pessoal na auditoria nem nas notas do histórico, mas guarda o fato', async () => {
  const l = await novo({ contato: 'Seu Joaquim Alves', telefone: telefone() });
  await evento(l.id, { tipo: 'contato', canal: 'whatsapp', nota: 'conversei com o Joaquim Alves' });
  await optout(l.id);
  const det = await json(await chamar(`/api/leads/${l.id}`));
  expect(det.eventos.every((e) => e.nota === null)).toBe(true);
  expect(det.eventos.map((e) => e.tipo)).toEqual(['criacao', 'contato', 'estagio']);
  expect(det.eventos.at(-1)).toMatchObject({ de: 'Captado', para: 'Não contatar' });
  const aud = await auditorias(l.id);
  expect(aud.at(-1)).toMatchObject({ acao: 'optout', entidade: 'lead', usuario: 'teste-lgpd@exemplo.com' });
  const tudo = JSON.stringify(aud);
  for (const proibido of ['Joaquim', 'Alves', l.telefone]) expect(tudo).not.toContain(proibido);
});

it('o histórico continua só de acréscimo: só a nota de lead que saiu pode ser apagada', async () => {
  const ativo = await novo({});
  await evento(ativo.id, { tipo: 'contato', canal: 'email', nota: 'primeira conversa' });
  await expect(env.DB.prepare("UPDATE lead_evento SET nota = NULL WHERE lead_id = ?").bind(ativo.id).run()).rejects.toThrow();
  await expect(env.DB.prepare('DELETE FROM lead_evento WHERE lead_id = ?').bind(ativo.id).run()).rejects.toThrow();
  const saiu = await novo({});
  await evento(saiu.id, { tipo: 'contato', canal: 'email', nota: 'outra conversa' });
  await optout(saiu.id);
  await expect(env.DB.prepare("UPDATE lead_evento SET canal = 'x' WHERE lead_id = ?").bind(saiu.id).run()).rejects.toThrow();
  await expect(env.DB.prepare('DELETE FROM lead_evento WHERE lead_id = ?').bind(saiu.id).run()).rejects.toThrow();
});

it('opt-out repetido, de lead ganho, de lead que não existe ou com corpo estranho é recusado', async () => {
  const l = await novo({ telefone: telefone() });
  expect((await optout(l.id)).status).toBe(200);
  const de_novo = await optout(l.id);
  expect(de_novo.status).toBe(409);
  const g = await ganho({ telefone: telefone() });
  expect((await optout(g.id)).status).toBe(409);
  expect((await linha(g.id)).telefone).not.toBeNull();
  expect((await optout('nao-existe')).status).toBe(404);
  const x = await novo({});
  expect((await optout(x.id, { telefone: 'x' })).status).toBe(422);
  expect((await linha(x.id)).opt_out_em).toBeNull();
});

it('duas ações de opt-out ao mesmo tempo: uma vale, a outra recebe 409, e o histórico tem um só evento', async () => {
  const l = await novo({ telefone: telefone() });
  const [a, b] = await Promise.all([optout(l.id), optout(l.id)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const det = await json(await chamar(`/api/leads/${l.id}`));
  expect(det.eventos.filter((e) => e.tipo === 'estagio')).toHaveLength(1);
  expect((await auditorias(l.id)).filter((x) => x.acao === 'optout')).toHaveLength(1);
});

it('lead que saiu não volta para outro estágio, não recebe contato nem edição', async () => {
  const l = await novo({});
  await optout(l.id);
  expect((await evento(l.id, { tipo: 'estagio', estagioId: 'etiqueteria-2' })).status).toBe(409);
  expect((await evento(l.id, { tipo: 'contato', canal: 'email' })).status).toBe(409);
  expect((await chamar(`/api/leads/${l.id}`, { metodo: 'PATCH', corpo: { telefone: telefone() } })).status).toBe(409);
  expect((await linha(l.id)).telefone).toBeNull();
});

// ---------------------------------------------------------------- J-LEAD-04: converter
it('converte lead ganho em cliente com o nome da empresa e deixa o resto a confirmar', async () => {
  const l = await ganho({ contato: 'Dona Rosa', telefone: telefone() });
  const r = await converter(l.id);
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
  const j = await json(r);
  expect(j.lead.clienteId).toBe(j.clienteId);
  const cli = await json(await chamar(`/api/clientes/${j.clienteId}`));
  expect(cli).toMatchObject({ nome: l.empresa, tipo: 'empresa', profissao: null, saude: null });
  expect(JSON.stringify(cli)).not.toContain('Rosa');
  const aud = await auditorias(l.id);
  expect(aud.at(-1)).toMatchObject({ acao: 'converter', entidade: 'lead' });
  expect(JSON.stringify(aud)).not.toContain('Rosa');
  const audCli = await auditorias(j.clienteId);
  expect(audCli).toHaveLength(1);
  expect(audCli[0]).toMatchObject({ acao: 'criar', entidade: 'cliente' });
});

it('converter aceita o tipo pessoa e recusa tipo inválido ou campo estranho', async () => {
  const l = await ganho();
  expect((await converter(l.id, { tipo: 'robô' })).status).toBe(422);
  expect((await converter(l.id, { nome: 'x' })).status).toBe(422);
  const r = await converter(l.id, { tipo: 'pessoa' });
  expect(r.status).toBe(201);
  expect((await json(await chamar(`/api/clientes/${(await json(r)).clienteId}`))).tipo).toBe('pessoa');
});

it('só lead ganho vira cliente; converter de novo dá 409 com o cliente já criado', async () => {
  const andamento = await novo({});
  expect((await converter(andamento.id)).status).toBe(409);
  const l = await ganho();
  const a = await converter(l.id);
  const b = await converter(l.id);
  expect(b.status).toBe(409);
  expect((await json(b)).clienteId).toBe((await json(a)).clienteId);
  expect((await converter('nao-existe')).status).toBe(404);
});

it('duas conversões ao mesmo tempo criam um só cliente', async () => {
  const l = await ganho();
  const [a, b] = await Promise.all([converter(l.id), converter(l.id)]);
  expect([a.status, b.status].sort()).toEqual([201, 409]);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM cliente WHERE nome = ?").bind(l.empresa).first();
  expect(total.n).toBe(1);
});

// ---------------------------------------------------------------- J-RET-01: retenção
const mesesAtras = (m) => { const d = new Date('2026-11-20T09:00:00Z'); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString(); };
const hojeSimulado = new Date('2026-11-20T09:00:00Z');
const envelhecer = (id, iso) => env.DB.prepare('UPDATE lead SET estagio_desde = ? WHERE id = ?').bind(iso, id).run();

it('apaga o contato de lead perdido há mais de 12 meses, mantém o resto e registra na auditoria', async () => {
  const l = await perdido({ contato: 'Dona Zuleide', telefone: telefone(), placeId: placeId(), observacoes: 'filha ajuda', consentimentoComo: 'x' });
  await envelhecer(l.id, mesesAtras(13));
  const bloqueadosAntes = (await env.DB.prepare('SELECT COUNT(*) AS n FROM contato_bloqueado').first()).n;
  const r = await aplicarRetencao(env.DB, { agora: hojeSimulado });
  expect(r.apagados).toBeGreaterThanOrEqual(1);
  const c = await linha(l.id);
  expect(c).toMatchObject({ contato: null, telefone: null, place_id: null, observacoes: null, consentimento_como: null, empresa: l.empresa, motivo_perda: 'sem resposta' });
  expect(c.contato_apagado_em).toBeTruthy();
  const det = await json(await chamar(`/api/leads/${l.id}`));
  expect(det.lead.contatoApagadoEm).toBeTruthy();
  expect(det.eventos.every((e) => e.nota === null)).toBe(true);
  const aud = (await auditorias(l.id)).at(-1);
  expect(aud).toMatchObject({ acao: 'apagar_contato', usuario: 'sistema:retencao' });
  expect(JSON.stringify(aud)).not.toContain('Zuleide');
  // Não foi pedido de opt-out: nada entra na lista de bloqueio.
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM contato_bloqueado').first()).n).toBe(bloqueadosAntes);
});

it('não apaga lead perdido há menos de 12 meses, nem lead que não está perdido', async () => {
  const recente = await perdido({ telefone: telefone() });
  await envelhecer(recente.id, mesesAtras(11));
  const ativo = await novo({ telefone: telefone() });
  await envelhecer(ativo.id, mesesAtras(30));
  const ganhoVelho = await ganho({ telefone: telefone() });
  await envelhecer(ganhoVelho.id, mesesAtras(30));
  await aplicarRetencao(env.DB, { agora: hojeSimulado });
  for (const l of [recente, ativo, ganhoVelho]) expect((await linha(l.id)).telefone, l.empresa).not.toBeNull();
});

it('rodar a retenção de novo não repete a auditoria', async () => {
  const l = await perdido({ telefone: telefone() });
  await envelhecer(l.id, mesesAtras(14));
  await aplicarRetencao(env.DB, { agora: hojeSimulado });
  await aplicarRetencao(env.DB, { agora: hojeSimulado });
  expect((await auditorias(l.id)).filter((a) => a.acao === 'apagar_contato')).toHaveLength(1);
});

it('o agendamento mensal chama a retenção', async () => {
  const mod = (await import('../worker/index.js')).default;
  expect(typeof mod.scheduled).toBe('function');
  expect(typeof mod.fetch).toBe('function');
  const l = await perdido({ telefone: telefone() });
  await envelhecer(l.id, mesesAtras(13));
  const esperas = [];
  await mod.scheduled({ scheduledTime: hojeSimulado.getTime() }, env, { waitUntil: (p) => esperas.push(p) });
  await Promise.all(esperas);
  expect((await linha(l.id)).telefone).toBeNull();
});

// ---------------------------------------------------------------- acesso
it('service token da trilha não entra nas rotas novas', async () => {
  const h = { 'cf-access-jwt-assertion': await assinar({ common_name: 'trilha-teste.access' }), 'content-type': 'application/json' };
  const l = await novo({});
  for (const rota of ['optout', 'converter']) {
    expect((await app.request(`/api/leads/${l.id}/${rota}`, { method: 'POST', headers: h, body: '{}' }, env)).status).toBe(403);
    expect((await app.request(`/api/leads/${l.id}/${rota}`, { method: 'POST' }, env)).status).toBe(401);
  }
});
