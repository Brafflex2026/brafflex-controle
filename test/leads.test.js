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
const somarDias = (d) => new Date(Date.now() + d * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

async function chamar(caminho, { metodo = 'GET', corpo, chave } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-lead@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (chave) headers['idempotency-key'] = chave;
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
// Telefone e Place ID novos a cada chamada, para os testes não se esbarrarem.
const telefone = () => `1199${String(1000000 + ++n).slice(-7)}`;
const placeId = () => `ChIJ${'A'.repeat(10)}${String(100000 + ++n)}_teste`;
const base = (extra = {}) => ({ funilId: 'etiqueteria', empresa: `TESTE-Gráfica ${++n}`, origem: 'Google Maps (API)', baseLegal: 'legítimo interesse', ...extra });
const criar = (corpo = base(), chave = `lead-${++n}`) => chamar('/api/leads', { metodo: 'POST', corpo, chave });
const novo = async (extra) => (await json(await criar(base(extra)))).lead;
const evento = (id, corpo) => chamar(`/api/leads/${id}/eventos`, { metodo: 'POST', corpo });
const auditorias = async (id) => (await env.DB.prepare("SELECT * FROM auditoria_app WHERE entidade = 'lead' AND entidade_id = ? ORDER BY id").bind(id).all()).results;

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-lead@exemplo.com', nome: 'TESTE-LEAD', papel: 'rodrigo' });
});

// ---------------------------------------------------------------- funis
it('os três funis vêm prontos, com os estágios do desenho do CRM', async () => {
  const { itens } = await json(await chamar('/api/funis'));
  expect(itens.map((f) => f.id).sort()).toEqual(['brafflex', 'etiqueteria', 'ravclin']);
  const nomes = (id) => itens.find((f) => f.id === id).estagios.map((e) => e.nome);
  expect(nomes('ravclin').slice(0, 6)).toEqual(['Novo', 'Em contato', 'Conversa', 'Reunião ou demo', 'Proposta', 'Ganho']);
  expect(nomes('etiqueteria')).toContain('Gráfica ativa');
  expect(nomes('brafflex')).toContain('Diagnóstico feito');
  for (const f of itens) {
    const finais = f.estagios.filter((e) => e.final).map((e) => e.final);
    expect(finais).toEqual(expect.arrayContaining(['Ganho', 'Perdido', 'Não contatar']));
    expect(f.estagios.map((e) => e.ordem)).toEqual([...f.estagios.map((e) => e.ordem)].sort((a, b) => a - b));
  }
});

// ---------------------------------------------------------------- J-LEAD-01
it('cria um lead válido no primeiro estágio, com evento de criação e auditoria', async () => {
  const r = await criar(base({ contato: 'Dona Maria', telefone: '(11) 98765-4321', placeId: placeId(), nota: 82, faixa: 'Quente', responsavel: 'TESTE-Rodrigo', proximoPasso: 'enviar mensagem', proximoPassoEm: somarDias(2) }));
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
  const { lead } = await json(r);
  expect(lead).toMatchObject({ funilId: 'etiqueteria', estagioNome: 'Captado', final: null, origem: 'Google Maps (API)', baseLegal: 'legítimo interesse', telefone: '11987654321', nota: 82, faixa: 'Quente', vencido: false, criadoPor: 'teste-lead@exemplo.com' });
  expect(lead).not.toHaveProperty('chave');
  const aud = await auditorias(lead.id);
  expect(aud).toHaveLength(1);
  expect(aud[0].acao).toBe('criar');
  const det = await json(await chamar(`/api/leads/${lead.id}`));
  expect(det.eventos.map((e) => e.tipo)).toEqual(['criacao']);
  expect(det.eventos[0].para).toBe('Captado');
});

it('a auditoria nunca guarda telefone nem nome do contato', async () => {
  const lead = await novo({ contato: 'Dona Zuleide Pereira', telefone: '11 91234-5678', placeId: placeId() });
  await chamar(`/api/leads/${lead.id}`, { metodo: 'PATCH', corpo: { telefone: '11 93333-4444', contato: 'Outro Nome Qualquer' } });
  const tudo = JSON.stringify(await auditorias(lead.id));
  for (const proibido of ['91234', '93333', 'Zuleide', 'Outro Nome']) expect(tudo).not.toContain(proibido);
  expect(tudo).toContain('telefone');
});

it('sem origem, com origem fora da lista, sem base legal ou com base fora da lista: 422 com o campo', async () => {
  for (const [campo, valor] of [['origem', undefined], ['origem', 'cartaz na rua'], ['baseLegal', undefined], ['baseLegal', 'porque sim'], ['empresa', ''], ['funilId', 'outro'], ['funilId', undefined]]) {
    const r = await criar({ ...base(), [campo]: valor });
    expect(r.status, `${campo}=${valor}`).toBe(422);
    expect((await json(r)).campo).toBe(campo);
  }
});

it('contato de grupo de WhatsApp não entra enquanto a base legal não for registrada', async () => {
  const r = await criar(base({ origem: 'grupo de WhatsApp' }));
  expect(r.status).toBe(422);
  const j = await json(r);
  expect(j.campo).toBe('origem');
  expect(j.erro).toMatch(/WhatsApp/);
});

it('base legal "consentimento" exige a data e como foi dado', async () => {
  expect((await criar(base({ baseLegal: 'consentimento' }))).status).toBe(422);
  expect((await criar(base({ baseLegal: 'consentimento', consentimentoEm: hoje() }))).status).toBe(422);
  const r = await criar(base({ baseLegal: 'consentimento', consentimentoEm: hoje(), consentimentoComo: 'formulário do site' }));
  expect(r.status).toBe(201);
  expect((await criar(base({ baseLegal: 'consentimento', consentimentoEm: '2099-01-01', consentimentoComo: 'formulário' }))).status).toBe(422);
});

it('duplicata de telefone é recusada com 409, mesmo com pontuação ou código do país', async () => {
  const tel = telefone();
  const a = await novo({ telefone: tel });
  for (const variante of [tel, `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`, `+55 ${tel.slice(0, 2)} ${tel.slice(2)}`, `55${tel}`]) {
    const r = await criar(base({ telefone: variante }));
    expect(r.status, variante).toBe(409);
    const j = await json(r);
    expect(j.campo).toBe('telefone');
    expect(j.leadId).toBe(a.id);
    expect(JSON.stringify(j)).not.toContain(tel);
  }
});

it('duplicata de Place ID é recusada com 409', async () => {
  const pid = placeId();
  const a = await novo({ placeId: pid });
  const r = await criar(base({ placeId: pid }));
  expect(r.status).toBe(409);
  const j = await json(r);
  expect(j.campo).toBe('placeId');
  expect(j.leadId).toBe(a.id);
});

it('telefone e Place ID inválidos são recusados', async () => {
  for (const telefoneRuim of ['123', '1198765432123456', 'abc', '(11) 8765-432']) {
    expect((await criar(base({ telefone: telefoneRuim }))).status, telefoneRuim).toBe(422);
  }
  for (const p of ['curto', 'ChIJ com espaço e coisa', `ChIJ${'x'.repeat(200)}`, 'EAAGm0PX4ZCpsBAKZBexemplo123456789012345']) {
    const r = await criar(base({ placeId: p }));
    expect(r.status, p).toBe(422);
    expect((await json(r)).campo).toBe('placeId');
  }
});

it('dois leads sem telefone e sem Place ID convivem (vazio não é duplicata)', async () => {
  expect((await criar(base())).status).toBe(201);
  expect((await criar(base())).status).toBe(201);
});

it('repetir o envio com a mesma chave não cria outro lead', async () => {
  const corpo = base({ telefone: telefone() });
  const a = await criar(corpo, 'lead-fixo');
  const b = await criar(corpo, 'lead-fixo');
  expect([a.status, b.status]).toEqual([201, 200]);
  const id = (await json(a)).lead.id;
  expect((await json(b)).lead.id).toBe(id);
  expect(await auditorias(id)).toHaveLength(1);
});

it('barreira: dado sensível nos textos livres é recusado e não aparece na resposta', async () => {
  for (const campo of ['empresa', 'contato', 'observacoes', 'proximoPasso', 'responsavel', 'consentimentoComo']) {
    const r = await criar(base({ [campo]: 'ligar 11 98765-4321 paciente João da Silva CPF 123.456.789-09', baseLegal: 'consentimento', consentimentoEm: hoje(), consentimentoComo: campo === 'consentimentoComo' ? 'ligar 11 98765-4321' : 'formulário' }));
    expect(r.status, campo).toBe(422);
    expect(JSON.stringify(await json(r))).not.toContain('98765');
  }
});

it('campos que o app controla (id, estágio, origem de registro) não podem ser enviados', async () => {
  for (const campo of ['id', 'estagioId', 'chave', 'criadoPor', 'optOutEm', 'clienteId', 'motivoPerda']) {
    const r = await criar({ ...base(), [campo]: 'x' });
    expect(r.status, campo).toBe(422);
    expect((await json(r)).campo).toBe(campo);
  }
  expect((await criar([])).status).toBe(422);
  expect((await app.request('/api/leads', { method: 'POST', headers: { 'cf-access-jwt-assertion': await assinar({ email: 'teste-lead@exemplo.com' }), 'content-type': 'application/json' }, body: JSON.stringify(base()) }, env)).status).toBe(400);
});

it('valida nota, faixa e datas', async () => {
  for (const extra of [{ nota: 101 }, { nota: -1 }, { nota: 1.5 }, { nota: '80' }, { faixa: 'Gelado' }, { proximoPassoEm: '2026-02-30' }, { proximoPassoEm: 'amanhã' }, { proximoPasso: 'x'.repeat(301) }]) {
    expect((await criar(base(extra))).status, JSON.stringify(extra)).toBe(422);
  }
});

// ---------------------------------------------------------------- J-LEAD-02
it('mover de estágio e registrar contato aparecem no histórico, em ordem', async () => {
  const lead = await novo();
  const funil = (await json(await chamar('/api/funis'))).itens.find((f) => f.id === 'etiqueteria');
  const id = (nome) => funil.estagios.find((e) => e.nome === nome).id;

  const a = await evento(lead.id, { tipo: 'estagio', estagioId: id('Abordado'), nota: 'enviei a mensagem' });
  expect(a.status, JSON.stringify(await a.clone().json())).toBe(201);
  expect((await json(a)).lead.estagioNome).toBe('Abordado');
  const b = await evento(lead.id, { tipo: 'contato', canal: 'WhatsApp', nota: 'respondeu que quer ver a demo', proximoPasso: 'agendar demo', proximoPassoEm: somarDias(3) });
  expect(b.status, JSON.stringify(await b.clone().json())).toBe(201);
  const lido = (await json(b)).lead;
  expect(lido).toMatchObject({ ultimoContatoCanal: 'WhatsApp', proximoPasso: 'agendar demo', proximoPassoEm: somarDias(3) });
  expect(lido.ultimoContatoEm).toBeTruthy();

  const det = await json(await chamar(`/api/leads/${lead.id}`));
  expect(det.eventos.map((e) => [e.tipo, e.de, e.para])).toEqual([['criacao', null, 'Captado'], ['estagio', 'Captado', 'Abordado'], ['contato', null, null]]);
  expect(det.eventos[1].nota).toBe('enviei a mensagem');
  expect(det.eventos[2]).toMatchObject({ canal: 'WhatsApp', nota: 'respondeu que quer ver a demo', usuario: 'teste-lead@exemplo.com' });
  expect((await auditorias(lead.id)).map((x) => x.acao)).toEqual(['criar', 'mudar_estagio', 'registrar_contato']);
});

it('estágio de outro funil, inexistente ou igual ao atual é recusado', async () => {
  const lead = await novo();
  expect((await evento(lead.id, { tipo: 'estagio', estagioId: 'ravclin-2' })).status).toBe(422);
  expect((await evento(lead.id, { tipo: 'estagio', estagioId: 'nao-existe' })).status).toBe(422);
  expect((await evento(lead.id, { tipo: 'estagio', estagioId: 'etiqueteria-1' })).status).toBe(409);
  expect((await evento(lead.id, { tipo: 'outro' })).status).toBe(422);
  expect((await evento('nao-existe', { tipo: 'contato', canal: 'WhatsApp' })).status).toBe(404);
});

it('Perdido exige motivo da lista; Nutrir exige data; Não contatar só pelo opt-out', async () => {
  const lead = await novo();
  const perdido = 'etiqueteria-11';
  const semMotivo = await evento(lead.id, { tipo: 'estagio', estagioId: perdido });
  expect(semMotivo.status).toBe(422);
  expect((await json(semMotivo)).campo).toBe('motivoPerda');
  expect((await evento(lead.id, { tipo: 'estagio', estagioId: perdido, motivoPerda: 'porque sim' })).status).toBe(422);
  const ok = await evento(lead.id, { tipo: 'estagio', estagioId: perdido, motivoPerda: 'sem resposta' });
  expect(ok.status).toBe(201);
  expect((await json(ok)).lead).toMatchObject({ estagioNome: 'Perdido', final: 'Perdido', motivoPerda: 'sem resposta' });

  const outro = await novo();
  const semData = await evento(outro.id, { tipo: 'estagio', estagioId: 'etiqueteria-9' });
  expect(semData.status).toBe(422);
  expect((await json(semData)).campo).toBe('proximoPassoEm');
  expect((await evento(outro.id, { tipo: 'estagio', estagioId: 'etiqueteria-9', proximoPassoEm: somarDias(30), proximoPasso: 'retomar' })).status).toBe(201);

  const terceiro = await novo();
  const nc = await evento(terceiro.id, { tipo: 'estagio', estagioId: 'etiqueteria-12' });
  expect(nc.status).toBe(409);
  expect((await json(nc)).erro).toMatch(/opt-out/i);
});

it('lead Ganho não sai do Ganho; lead Perdido pode voltar a um estágio ativo e o motivo some', async () => {
  const g = await novo();
  expect((await evento(g.id, { tipo: 'estagio', estagioId: 'etiqueteria-8' })).status).toBe(201);
  expect((await evento(g.id, { tipo: 'estagio', estagioId: 'etiqueteria-2' })).status).toBe(409);

  const p = await novo();
  await evento(p.id, { tipo: 'estagio', estagioId: 'etiqueteria-11', motivoPerda: 'preço' });
  const volta = await evento(p.id, { tipo: 'estagio', estagioId: 'etiqueteria-3', nota: 'voltou a falar' });
  expect(volta.status).toBe(201);
  expect((await json(volta)).lead).toMatchObject({ estagioNome: 'Em conversa', motivoPerda: null });
});

it('duas trocas de estágio ao mesmo tempo: uma vale, a outra recebe 409', async () => {
  const lead = await novo();
  const [a, b] = await Promise.all([evento(lead.id, { tipo: 'estagio', estagioId: 'etiqueteria-2' }), evento(lead.id, { tipo: 'estagio', estagioId: 'etiqueteria-3' })]);
  const status = [a.status, b.status].sort();
  expect(status[0]).toBe(201);
  expect([201, 409]).toContain(status[1]);
  const det = await json(await chamar(`/api/leads/${lead.id}`));
  expect(det.eventos.filter((e) => e.tipo === 'estagio')).toHaveLength(status.filter((s) => s === 201).length);
});

it('evento: contato exige canal; notas passam pela barreira; histórico só de acréscimo', async () => {
  const lead = await novo();
  expect((await evento(lead.id, { tipo: 'contato' })).status).toBe(422);
  const r = await evento(lead.id, { tipo: 'contato', canal: 'WhatsApp', nota: 'me ligue no 11 98765-4321' });
  expect(r.status).toBe(422);
  expect(JSON.stringify(await json(r))).not.toContain('98765');
  expect((await chamar(`/api/leads/${lead.id}/eventos/1`, { metodo: 'DELETE' })).status).toBeGreaterThanOrEqual(404);
  await expect(env.DB.prepare('UPDATE lead_evento SET nota = ? WHERE lead_id = ?').bind('x', lead.id).run()).rejects.toThrow();
  await expect(env.DB.prepare('DELETE FROM lead_evento WHERE lead_id = ?').bind(lead.id).run()).rejects.toThrow();
});

// ---------------------------------------------------------------- edição
it('edita campos do lead com auditoria; mudar para telefone repetido dá 409; igual não gera auditoria', async () => {
  const tel = telefone();
  const a = await novo({ telefone: tel });
  const b = await novo({ telefone: telefone() });
  const r = await chamar(`/api/leads/${b.id}`, { metodo: 'PATCH', corpo: { telefone: tel } });
  expect(r.status).toBe(409);

  const ok = await chamar(`/api/leads/${a.id}`, { metodo: 'PATCH', corpo: { responsavel: 'TESTE-Ana', faixa: 'Morno', nota: 40 } });
  expect(ok.status).toBe(200);
  expect((await json(ok)).lead).toMatchObject({ responsavel: 'TESTE-Ana', faixa: 'Morno', nota: 40 });
  expect((await chamar(`/api/leads/${a.id}`, { metodo: 'PATCH', corpo: { responsavel: 'TESTE-Ana' } })).status).toBe(200);
  expect((await auditorias(a.id)).filter((x) => x.acao === 'alterar')).toHaveLength(1);
});

it('a edição não muda estágio, funil nem os campos controlados pelo app; origem e base legal não podem ficar vazias', async () => {
  const lead = await novo();
  for (const campo of ['estagioId', 'funilId', 'id', 'motivoPerda', 'optOutEm', 'clienteId']) {
    const r = await chamar(`/api/leads/${lead.id}`, { metodo: 'PATCH', corpo: { [campo]: 'x' } });
    expect(r.status, campo).toBe(422);
  }
  expect((await chamar(`/api/leads/${lead.id}`, { metodo: 'PATCH', corpo: { origem: null } })).status).toBe(422);
  expect((await chamar(`/api/leads/${lead.id}`, { metodo: 'PATCH', corpo: { baseLegal: '' } })).status).toBe(422);
  expect((await chamar(`/api/leads/${lead.id}`, { metodo: 'PATCH', corpo: { origem: 'indicação' } })).status).toBe(200);
  expect((await chamar('/api/leads/nao-existe', { metodo: 'PATCH', corpo: { nota: 1 } })).status).toBe(404);
  expect((await chamar(`/api/leads/${lead.id}`, { metodo: 'DELETE' })).status).toBe(405);
});

it('apagar telefone e Place ID (vazio) libera o número para outro lead', async () => {
  const tel = telefone();
  const a = await novo({ telefone: tel });
  expect((await chamar(`/api/leads/${a.id}`, { metodo: 'PATCH', corpo: { telefone: null } })).status).toBe(200);
  expect((await criar(base({ telefone: tel }))).status).toBe(201);
});

// ---------------------------------------------------------------- quadro e vencidos
it('a lista filtra por funil, estágio, busca e responsável e traz as contagens por estágio', async () => {
  const a = await novo({ empresa: 'TESTE-Zeta Buscável', responsavel: 'TESTE-Beto' });
  await evento(a.id, { tipo: 'estagio', estagioId: 'etiqueteria-2' });
  await novo({ funilId: 'brafflex', empresa: 'TESTE-Zeta Outro Funil' });
  const ids = async (q) => (await json(await chamar(`/api/leads?${q}`))).itens.map((i) => i.id);
  expect(await ids('funil=etiqueteria&q=Zeta Buscável')).toEqual([a.id]);
  expect(await ids('funil=brafflex&q=Zeta Buscável')).toEqual([]);
  expect(await ids('funil=etiqueteria&estagio=etiqueteria-2&q=Zeta')).toEqual([a.id]);
  expect(await ids('funil=etiqueteria&responsavel=Beto')).toEqual([a.id]);
  expect(await ids('q=%25')).toEqual([]);
  const j = await json(await chamar('/api/leads?funil=etiqueteria&q=Zeta'));
  expect(j.contagens['etiqueteria-2']).toBe(1);
  expect(j.itens[0]).not.toHaveProperty('observacoes');
});

it('próximos passos vencidos: data anterior a hoje, fora dos estágios finais; conta os sem próximo passo', async () => {
  const vencido = await novo({ empresa: 'TESTE-Vencida', proximoPasso: 'ligar', proximoPassoEm: somarDias(-3) });
  const emDia = await novo({ empresa: 'TESTE-EmDia', proximoPasso: 'ligar', proximoPassoEm: somarDias(3) });
  const hojeMesmo = await novo({ empresa: 'TESTE-Hoje', proximoPasso: 'ligar', proximoPassoEm: hoje() });
  const perdido = await novo({ empresa: 'TESTE-VencidaPerdida', proximoPasso: 'ligar', proximoPassoEm: somarDias(-5) });
  await evento(perdido.id, { tipo: 'estagio', estagioId: 'etiqueteria-11', motivoPerda: 'sem resposta' });
  const semPasso = await novo({ empresa: 'TESTE-SemPasso' });

  const j = await json(await chamar('/api/leads?funil=etiqueteria&vencidos=1&q=TESTE-'));
  const ids = j.itens.map((i) => i.id);
  expect(ids).toContain(vencido.id);
  for (const nao of [emDia, hojeMesmo, perdido, semPasso]) expect(ids).not.toContain(nao.id);
  expect(j.itens.find((i) => i.id === vencido.id).vencido).toBe(true);

  const geral = await json(await chamar('/api/leads?funil=etiqueteria&q=TESTE-'));
  expect(geral.vencidos).toBeGreaterThanOrEqual(1);
  expect(geral.semProximoPasso).toBeGreaterThanOrEqual(1);
  expect(geral.itens.find((i) => i.id === emDia.id).vencido).toBe(false);
});

it('detalhe 404 para lead que não existe', async () => {
  expect((await chamar('/api/leads/nao-existe')).status).toBe(404);
});

// ---------------------------------------------------------------- acesso
it('sem login não lê nem cria; service token da trilha não entra', async () => {
  expect((await app.request('/api/leads', {}, env)).status).toBe(401);
  expect((await app.request('/api/funis', {}, env)).status).toBe(401);
  const h = { 'cf-access-jwt-assertion': await assinar({ common_name: 'trilha-teste.access' }), 'content-type': 'application/json' };
  expect((await app.request('/api/leads', { headers: h }, env)).status).toBe(403);
  expect((await app.request('/api/leads', { method: 'POST', headers: { ...h, 'idempotency-key': 'k' }, body: '{}' }, env)).status).toBe(403);
});
