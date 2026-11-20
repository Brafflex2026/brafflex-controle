import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { usuario } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';
import ravclinTeste from './fixtures/ravclin-teste.csv?raw';
import etiqueteriaTeste from './fixtures/etiqueteria-teste.csv?raw';

let app;
let assinar;
let n = 0;
const db = () => drizzle(env.DB);
const json = (r) => r.json();

async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-imp@exemplo.com' }) };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const previa = (fonte, arquivo) => chamar('/api/leads/importar/previa', { metodo: 'POST', corpo: { fonte, arquivo } });
const enviar = (fonte, arquivo, confirmar) => chamar('/api/leads/importar', { metodo: 'POST', corpo: { fonte, arquivo, ...(confirmar ? { confirmar } : {}) } });

const dig = () => `2299${String(3000000 + ++n).slice(-7)}`; // telefone só com dígitos, novo a cada chamada
const mascara = (d) => `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
const pid = () => `ChIJ${'C'.repeat(10)}${String(300000 + ++n)}_imp`;
const celula = (v) => (/[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (cab, linhas) => `${cab.join(',')}\n${linhas.map((l) => l.map(celula).join(',')).join('\n')}\n`;

const CAB_RAV = ['Clínica', 'Nota', 'Faixa', 'Status', 'Cidade', 'Bairro', 'Endereço', 'Telefone', 'WhatsApp', 'Site', 'Instagram', 'Place ID', 'Sinais', 'Região de busca'];
const rav = (o = {}) => {
  const v = { clinica: `TESTE-Clínica ${++n}`, nota: '82', faixa: 'Quente', status: 'Novo', cidade: 'Macaé', bairro: 'Centro', endereco: 'Rua Teste 1', telefone: mascara(dig()), whatsapp: '', site: 'https://teste.exemplo', instagram: '', place: pid(), sinais: 'só telefone', regiao: 'Macaé', ...o };
  return [v.clinica, v.nota, v.faixa, v.status, v.cidade, v.bairro, v.endereco, v.telefone, v.whatsapp, v.site, v.instagram, v.place, v.sinais, v.regiao];
};
const CAB_ETQ = ['ID', 'Empresa', 'Nota', 'Faixa', 'Cidade', 'Bairro', 'Endereço', 'Telefone', 'WhatsApp', 'E-mail', 'Site', 'Instagram', 'Place ID', 'Origem do dado', 'Data captura', 'Status', 'Canal 1º contato', 'Data 1º contato', 'Próximo passo', 'Opt-out (não contatar)', 'Observações'];
const etq = (o = {}) => {
  const v = { id: `E${++n}`, empresa: `TESTE-Gráfica ${n}`, nota: '70', faixa: 'Quente', cidade: 'Niterói', bairro: '', endereco: '', telefone: mascara(dig()), whatsapp: '', email: 'contato@teste.exemplo', site: '', instagram: '', place: pid(), origem: 'Google Maps', captura: '2026-11-01', status: 'Não contatado', canal: '', data1: '', passo: '', optout: 'Não', obs: '', ...o };
  return [v.id, v.empresa, v.nota, v.faixa, v.cidade, v.bairro, v.endereco, v.telefone, v.whatsapp, v.email, v.site, v.instagram, v.place, v.origem, v.captura, v.status, v.canal, v.data1, v.passo, v.optout, v.obs];
};
const leadPor = (empresa) => env.DB.prepare('SELECT l.*, e.nome AS estagio FROM lead l JOIN estagio e ON e.id = l.estagio_id WHERE l.empresa = ?').bind(empresa).first();
const totalLeads = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM lead').first()).n;

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-imp@exemplo.com', nome: 'TESTE-IMP', papel: 'rodrigo' });
});

// ---------------------------------------------------------------- prévia
it('a prévia conta o que entraria, não grava nada e não devolve telefone', async () => {
  const linhas = [rav({ status: 'Novo' }), rav({ status: 'Contatado' }), rav({ status: 'Cliente' }), rav({ status: 'Descartado' })];
  const antes = await totalLeads();
  const r = await previa('ravclin', csv(CAB_RAV, linhas));
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j).toMatchObject({ fonte: 'ravclin', totalLinhas: 4, importaveis: 4, duplicados: 0, optOuts: 0 });
  expect(j.recusadas).toEqual([]);
  expect(j.porEstagio).toMatchObject({ Novo: 1, 'Em contato': 1, Ganho: 1, Perdido: 1 });
  expect(await totalLeads()).toBe(antes);
  const texto = JSON.stringify(j);
  for (const l of linhas) expect(texto).not.toContain(l[7].replace(/\D/g, '').slice(2));
});

// ---------------------------------------------------------------- Ravclin
it('importa o Ravclin com o mapeamento de estágio, origem, base legal e observações', async () => {
  const a = rav({ status: 'Em negociação', instagram: 'https://instagram.com/teste' });
  const b = rav({ status: 'Descartado' });
  const c = rav({ status: 'Abordar', telefone: '', whatsapp: `+55 ${mascara(dig())}` });
  const prev = await json(await previa('ravclin', csv(CAB_RAV, [a, b, c])));
  const r = await enviar('ravclin', csv(CAB_RAV, [a, b, c]), { importaveis: prev.importaveis, optOuts: prev.optOuts });
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
  expect(await json(r)).toMatchObject({ importados: 3, duplicados: 0, optOuts: 0, recusadas: 0 });

  const la = await leadPor(a[0]);
  expect(la).toMatchObject({ funil_id: 'ravclin', estagio: 'Conversa', origem: 'Google Maps (API)', base_legal: 'legítimo interesse', nota: 82, faixa: 'Quente', place_id: a[11], motivo_perda: null, criado_por: 'teste-imp@exemplo.com' });
  expect(la.telefone).toBe(a[7].replace(/\D/g, ''));
  expect(la.observacoes).toContain('https://teste.exemplo');
  expect(la.observacoes).toContain('instagram.com/teste');
  expect(la.observacoes).toContain('Macaé');
  expect(await leadPor(b[0])).toMatchObject({ estagio: 'Perdido', motivo_perda: 'outro' });
  const lc = await leadPor(c[0]);
  expect(lc.estagio).toBe('Novo');
  expect(lc.telefone).toMatch(/^\d{10,11}$/);

  const det = await json(await chamar(`/api/leads/${la.id}`));
  expect(det.eventos).toHaveLength(1);
  expect(det.eventos[0]).toMatchObject({ tipo: 'criacao', para: 'Conversa' });
  const aud = (await env.DB.prepare("SELECT * FROM auditoria_app WHERE entidade = 'lead' AND entidade_id = ?").bind(la.id).all()).results;
  expect(aud).toHaveLength(1);
  expect(aud[0].acao).toBe('importar');
  expect(aud[0].depois).not.toContain(la.telefone);
});

it('recusa só a linha ruim, com o número da linha e o motivo, e importa as boas', async () => {
  const boa1 = rav();
  const boa2 = rav();
  const semNome = rav({ clinica: '' });
  const telRuim = rav({ telefone: '123' });
  const pidRuim = rav({ place: 'abc' });
  const statusRuim = rav({ status: 'Inventado' });
  const dupl = rav({ clinica: 'DUPLICADA — TESTE-Clínica X' });
  const arq = csv(CAB_RAV, [boa1, semNome, boa2, telRuim, pidRuim, statusRuim, dupl]);
  const j = await json(await previa('ravclin', arq));
  expect(j.importaveis).toBe(2);
  expect(j.recusadas.map((x) => x.linha)).toEqual([3, 5, 6, 7, 8]);
  expect(j.recusadas.every((x) => typeof x.motivo === 'string' && x.motivo.length > 5)).toBe(true);
  const r = await enviar('ravclin', arq, { importaveis: 2, optOuts: 0 });
  expect(await json(r)).toMatchObject({ importados: 2, recusadas: 5 });
  expect(await leadPor(boa1[0])).toBeTruthy();
  expect(await leadPor(boa2[0])).toBeTruthy();
});

it('repetido dentro do arquivo é recusado; já existente é duplicado; reenviar o arquivo não duplica', async () => {
  const a = rav();
  const mesmoTelefone = rav({ telefone: a[7] });
  const mesmoPlace = rav({ place: a[11] });
  const arq = csv(CAB_RAV, [a, mesmoTelefone, mesmoPlace]);
  const j = await json(await previa('ravclin', arq));
  expect(j).toMatchObject({ importaveis: 1 });
  expect(j.recusadas).toHaveLength(2);
  expect(j.recusadas[0].motivo).toMatch(/repetid/i);
  await enviar('ravclin', arq, { importaveis: 1, optOuts: 0 });
  const antes = await totalLeads();
  const j2 = await json(await previa('ravclin', csv(CAB_RAV, [a])));
  expect(j2).toMatchObject({ importaveis: 0, duplicados: 1 });
  const r = await enviar('ravclin', csv(CAB_RAV, [a]), { importaveis: 0, optOuts: 0 });
  expect(await json(r)).toMatchObject({ importados: 0, duplicados: 1 });
  expect(await totalLeads()).toBe(antes);
});

it('observação com dado sensível é descartada com aviso, e a linha entra', async () => {
  const a = rav({ sinais: 'ligar no 22 99876-5432 depois' });
  const arq = csv(CAB_RAV, [a]);
  const j = await json(await previa('ravclin', arq));
  expect(j.importaveis).toBe(1);
  expect(j.avisos).toHaveLength(1);
  await enviar('ravclin', arq, { importaveis: 1, optOuts: 0 });
  const l = await leadPor(a[0]);
  expect(l.observacoes).toBeNull();
});

// ---------------------------------------------------------------- Etiqueteria
it('importa a Etiqueteria: estágio pelo nome, último contato, e-mail não guardado', async () => {
  const a = etq({ status: 'Demo agendada', canal: 'WhatsApp', data1: '2026-11-05', passo: 'ligar sexta', site: 'https://grafica.teste' });
  const b = etq({ status: 'Não contatado' });
  const c = etq({ status: 'Fora do perfil' });
  const arq = csv(CAB_ETQ, [a, b, c]);
  const j = await json(await previa('etiqueteria', arq));
  expect(j).toMatchObject({ importaveis: 3, optOuts: 0 });
  await enviar('etiqueteria', arq, { importaveis: 3, optOuts: 0 });
  const la = await leadPor(a[1]);
  expect(la).toMatchObject({ funil_id: 'etiqueteria', estagio: 'Demo agendada', ultimo_contato_canal: 'WhatsApp', proximo_passo: 'ligar sexta', origem: 'Google Maps (API)' });
  expect(la.ultimo_contato_em.slice(0, 10)).toBe('2026-11-05');
  expect(await leadPor(b[1])).toMatchObject({ estagio: 'Captado' });
  expect(await leadPor(c[1])).toMatchObject({ estagio: 'Fora do perfil', motivo_perda: 'fora do perfil' });
  const tudo = JSON.stringify((await env.DB.prepare('SELECT * FROM lead WHERE empresa IN (?, ?, ?)').bind(a[1], b[1], c[1]).all()).results);
  expect(tudo).not.toContain('contato@teste.exemplo');
});

it('linha de opt-out não vira lead: o telefone e o Place ID entram só como hash e o recadastro dá 409', async () => {
  const d = dig();
  const p = pid();
  const x = etq({ optout: 'Sim', telefone: mascara(d), place: p });
  const y = etq({ status: 'Não contatar', optout: 'Não' });
  const arq = csv(CAB_ETQ, [x, y]);
  const j = await json(await previa('etiqueteria', arq));
  expect(j).toMatchObject({ importaveis: 0, optOuts: 2 });
  const antes = await totalLeads();
  const r = await enviar('etiqueteria', arq, { importaveis: 0, optOuts: 2 });
  expect(await json(r)).toMatchObject({ importados: 0, optOuts: 2 });
  expect(await totalLeads()).toBe(antes);
  expect(await leadPor(x[1])).toBeNull();
  const rec = await chamar('/api/leads', { metodo: 'POST', corpo: { funilId: 'etiqueteria', empresa: 'TESTE-Recadastro importação', origem: 'indicação', baseLegal: 'legítimo interesse', telefone: d } });
  // sem chave de envio dá 400; confere com chave pela rota direta
  expect(rec.status).toBe(400);
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-imp@exemplo.com' }), 'content-type': 'application/json', 'idempotency-key': `imp-${++n}` };
  const rec2 = await app.request('/api/leads', { method: 'POST', headers, body: JSON.stringify({ funilId: 'etiqueteria', empresa: 'TESTE-Recadastro importação', origem: 'indicação', baseLegal: 'legítimo interesse', telefone: d }) }, env);
  expect(rec2.status).toBe(409);
  expect((await json(rec2)).optOut).toBe(true);
  const bloq = JSON.stringify((await env.DB.prepare('SELECT * FROM contato_bloqueado').all()).results);
  expect(bloq).not.toContain(d);
  expect(bloq).not.toContain(p);
});

it('opt-out da planilha cujo telefone já está num lead ativo é recusado, pedindo o opt-out pela tela', async () => {
  const ativo = rav();
  await enviar('ravclin', csv(CAB_RAV, [ativo]), { importaveis: 1, optOuts: 0 });
  const x = etq({ optout: 'Sim', telefone: ativo[7], place: pid() });
  const j = await json(await previa('etiqueteria', csv(CAB_ETQ, [x])));
  expect(j.optOuts).toBe(0);
  expect(j.recusadas).toHaveLength(1);
  expect(j.recusadas[0].motivo).toMatch(/opt-out/i);
});

it('origem de grupo de WhatsApp é recusada; origem desconhecida também; origens conhecidas são mapeadas', async () => {
  const g = etq({ origem: 'Grupo de WhatsApp' });
  const desc = etq({ origem: 'cartaz' });
  const ig = etq({ origem: 'Instagram' });
  const ind = etq({ origem: 'indicação' });
  const apify = etq({ origem: 'Apify (Google Maps)' });
  const arq = csv(CAB_ETQ, [g, desc, ig, ind, apify]);
  const j = await json(await previa('etiqueteria', arq));
  expect(j.importaveis).toBe(3);
  expect(j.recusadas.map((x) => x.linha)).toEqual([2, 3]);
  expect(j.recusadas[0].motivo).toMatch(/WhatsApp/);
  await enviar('etiqueteria', arq, { importaveis: 3, optOuts: 0 });
  expect((await leadPor(ig[1])).origem).toBe('site ou Instagram público');
  expect((await leadPor(ind[1])).origem).toBe('indicação');
  expect((await leadPor(apify[1])).origem).toBe('Google Maps (API)');
});

// ---------------------------------------------------------------- confirmação e limites
it('o envio exige a confirmação e recusa se as contagens não batem com o arquivo', async () => {
  const arq = csv(CAB_RAV, [rav(), rav()]);
  const antes = await totalLeads();
  expect((await enviar('ravclin', arq)).status).toBe(422);
  expect((await enviar('ravclin', arq, { importaveis: 5, optOuts: 0 })).status).toBe(409);
  expect(await totalLeads()).toBe(antes);
});

it('fonte inválida, cabeçalho de outra fonte, arquivo vazio, grande demais ou com linhas demais são recusados', async () => {
  const ok = csv(CAB_RAV, [rav()]);
  expect((await previa('outra', ok)).status).toBe(422);
  expect((await previa('etiqueteria', ok)).status).toBe(422);
  expect((await previa('ravclin', csv(CAB_ETQ, [etq()]))).status).toBe(422);
  expect((await previa('ravclin', '')).status).toBe(422);
  expect((await previa('ravclin', 'x'.repeat(300_001))).status).toBe(413);
  const muitas = csv(CAB_RAV, Array.from({ length: 501 }, () => rav()));
  if (muitas.length < 300_000) expect((await previa('ravclin', muitas)).status).toBe(422);
  expect((await chamar('/api/leads/importar/previa', { metodo: 'POST', corpo: { fonte: 'ravclin' } })).status).toBe(422);
});

// ---------------------------------------------------------------- acesso
it('sem login não importa; service token da trilha não entra', async () => {
  for (const rota of ['/api/leads/importar/previa', '/api/leads/importar']) {
    expect((await app.request(rota, { method: 'POST' }, env)).status).toBe(401);
    const h = { 'cf-access-jwt-assertion': await assinar({ common_name: 'trilha-teste.access' }), 'content-type': 'application/json' };
    expect((await app.request(rota, { method: 'POST', headers: h, body: '{}' }, env)).status).toBe(403);
  }
});

// ---------------------------------------------------------------- arquivos fictícios que o Rodrigo usa para conferir na tela
it('os CSV fictícios de conferência dão as contagens combinadas', async () => {
  const r = await json(await previa('ravclin', ravclinTeste));
  expect(r).toMatchObject({ totalLinhas: 9, importaveis: 5, duplicados: 0, optOuts: 0 });
  expect(r.recusadas).toHaveLength(4);
  const e = await json(await previa('etiqueteria', etiqueteriaTeste));
  expect(e).toMatchObject({ totalLinhas: 8, importaveis: 4, duplicados: 0, optOuts: 1 });
  expect(e.recusadas).toHaveLength(3);
});
