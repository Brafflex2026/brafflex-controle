import { env } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { usuario } from '../worker/db/schema.js';
import { criarApp } from '../worker/index.js';
import { cenarioToken } from './ajuda-token.js';

// Os arquivos reais ficam só no PC (fora do Git); sem eles, o teste da prévia real é pulado.
const reais = import.meta.glob('./fixtures/*-real.md', { eager: true, query: '?raw', import: 'default' });
const decisoesReal = reais['./fixtures/decisoes-real.md'];
const propostasReal = reais['./fixtures/propostas-real.md'];

// Este arquivo roda sozinho com banco limpo: a importação só vale quando os números originais ainda estão livres.
let app;
let assinar;
const db = () => drizzle(env.DB);
const json = (r) => r.json();

async function chamar(caminho, corpo, metodo = 'POST') {
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-imp@exemplo.com' }), 'content-type': 'application/json' };
  return app.request(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }, env);
}
const previa = (corpo) => chamar('/api/decisoes/importar/previa', corpo);
const importar = (corpo) => chamar('/api/decisoes/importar', corpo);
const contar = async (t) => (await env.DB.prepare(`SELECT COUNT(*) c FROM ${t}`).first()).c;

const DEC = `## Entradas

### DEC-002 — P-001 aprovada: algo
- Data: 2026-10-27
- Demanda: construção da agência
- Nível: 3 (Rodrigo)
- Quem decidiu: Rodrigo
- Decisão: aprovado
- Observação de registro: nota extra

### DEC-001 — Primeiro
- Data: 2026-10-02
- Demanda: D-001
- Nível: 2 (COVO)
- Quem decidiu: COVO
- Decisão: texto
`;
const PROP = `# Propostas

## P-001 — Primeira

Texto da primeira.

## P-002 — Segunda

Texto da segunda.

**Decisão do Rodrigo (27/10, DEC-002):** aprovo.
`;
const pacote = (over = {}) => ({ decisoes: DEC, propostas: PROP, ...over });

beforeAll(async () => {
  const c = await cenarioToken();
  assinar = c.assinar;
  app = criarApp({ jwks: c.jwks });
  await db().insert(usuario).values({ email: 'teste-imp@exemplo.com', nome: 'TESTE-IMP', papel: 'rodrigo' });
});

it('a prévia mostra as contagens e as entradas e não grava nada', async () => {
  const r = await previa(pacote());
  expect(r.status).toBe(200);
  const j = await json(r);
  expect(j.decisoes.total).toBe(2);
  expect(j.propostas.total).toBe(2);
  expect(j.problemas).toEqual([]);
  expect(j.decisoes.itens.map((d) => d.id)).toEqual(['DEC-002', 'DEC-001']);
  expect(j.propostas.itens.find((p) => p.id === 'P-002').decisaoId).toBe('DEC-002');
  expect(j.jaImportado).toBe(false);
  expect(await contar('decisao')).toBe(0);
  expect(await contar('proposta')).toBe(0);
});

it.skipIf(!decisoesReal)('prévia dos arquivos reais: 10 decisões, 8 propostas, nenhum problema', async () => {
  const j = await json(await previa({ decisoes: decisoesReal, propostas: propostasReal }));
  expect(j.problemas, JSON.stringify(j.problemas)).toEqual([]);
  expect([j.decisoes.total, j.propostas.total]).toEqual([10, 8]);
  console.log('avisos da prévia real:', JSON.stringify(j.avisos));
});

it('a prévia aponta problemas do arquivo e do dado sensível, e a importação é recusada', async () => {
  const ruim = DEC.replace('- Decisão: texto', '- Decisão: ligar para (11) 98765-4321');
  const j = await json(await previa(pacote({ decisoes: ruim })));
  expect(j.problemas.length).toBeGreaterThan(0);
  expect(j.problemas[0].id).toBe('DEC-001');
  expect(JSON.stringify(j)).not.toContain('98765');
  const r = await importar({ ...pacote({ decisoes: ruim }), confirmar: { decisoes: 2, propostas: 2 } });
  expect(r.status).toBe(422);
  expect(await contar('decisao')).toBe(0);
});

it('importação com contagem diferente da prévia é recusada', async () => {
  for (const confirmar of [{ decisoes: 1, propostas: 2 }, { decisoes: 2, propostas: 3 }, undefined, {}, { decisoes: '2', propostas: '2' }]) {
    const r = await importar({ ...pacote(), confirmar });
    expect(r.status, JSON.stringify(confirmar)).toBe(422);
  }
  expect(await contar('decisao')).toBe(0);
});

it('texto vazio, sem entradas ou grande demais é recusado', async () => {
  expect((await previa({ decisoes: '', propostas: '' })).status).toBe(422);
  expect((await previa({ decisoes: '# nada', propostas: '# nada' })).status).toBe(422);
  expect((await previa({ decisoes: 'x'.repeat(400_000), propostas: PROP })).status).toBe(413);
  expect((await previa({ decisoes: DEC })).status).toBe(422);
});

it('importa tudo de uma vez, com número original, ligações e auditoria', async () => {
  const r = await importar({ ...pacote(), confirmar: { decisoes: 2, propostas: 2 } });
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
  expect(await json(r)).toMatchObject({ decisoes: 2, propostas: 2 });
  expect((await json(await chamar('/api/decisoes', undefined, 'GET'))).importada).toBe(true);
  expect(await contar('decisao')).toBe(2);
  expect(await contar('proposta')).toBe(2);
  const d = await env.DB.prepare("SELECT * FROM decisao WHERE id = 'DEC-002'").first();
  expect(d).toMatchObject({ data: '2026-10-27', nivel: 3, quem: 'Rodrigo', origem: 'importada', proposta_id: 'P-001', criado_por: 'teste-imp@exemplo.com' });
  expect(d.observacoes).toBe('Observação de registro: nota extra');
  const p = await env.DB.prepare("SELECT * FROM proposta WHERE id = 'P-002'").first();
  expect(p).toMatchObject({ decisao_id: 'DEC-002', origem: 'importada' });
  const aud = (await env.DB.prepare("SELECT * FROM auditoria_app WHERE acao = 'importar'").all()).results;
  expect(aud).toHaveLength(1);
  expect(JSON.parse(aud[0].depois)).toEqual({ decisoes: 2, propostas: 2 });
});

it('depois de importar, a próxima decisão do app continua a numeração', async () => {
  const r = await chamar('/api/decisoes', { data: '2026-11-01', nivel: 3, quem: 'TESTE', titulo: 'nova', decisao: 'x' });
  expect(r.status).toBe(400); // sem chave: confirma que a rota exige a chave
  const headers = { 'cf-access-jwt-assertion': await assinar({ email: 'teste-imp@exemplo.com' }), 'content-type': 'application/json', 'idempotency-key': 'apos-import' };
  const ok = await app.request('/api/decisoes', { method: 'POST', headers, body: JSON.stringify({ data: '2026-11-01', nivel: 3, quem: 'TESTE', titulo: 'nova', decisao: 'x' }) }, env);
  expect((await json(ok)).decisao.id).toBe('DEC-003');
});

it('só dá para importar uma vez: a segunda tentativa recebe 409 e nada muda', async () => {
  const antes = [await contar('decisao'), await contar('proposta')];
  const r = await importar({ ...pacote(), confirmar: { decisoes: 2, propostas: 2 } });
  expect(r.status).toBe(409);
  expect([await contar('decisao'), await contar('proposta')]).toEqual(antes);
  expect((await json(await previa(pacote()))).jaImportado).toBe(true);
});

it('duas importações em paralelo depois da primeira: as duas recebem 409', async () => {
  const [a, b] = await Promise.all([importar({ ...pacote(), confirmar: { decisoes: 2, propostas: 2 } }), importar({ ...pacote(), confirmar: { decisoes: 2, propostas: 2 } })]);
  expect([a.status, b.status]).toEqual([409, 409]);
});

it('sem login não importa', async () => {
  expect((await app.request('/api/decisoes/importar', { method: 'POST', body: '{}' }, env)).status).toBe(401);
  expect((await app.request('/api/decisoes/importar/previa', { method: 'POST', body: '{}' }, env)).status).toBe(401);
});
