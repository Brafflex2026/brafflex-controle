import { it, expect } from 'vitest';
import { lerDecisoes, lerPropostas } from '../worker/decisoes-leitor.js';

// Os arquivos reais ficam só no PC (fora do Git). Sem eles, os testes que dependem deles são pulados.
const reais = import.meta.glob('./fixtures/*-real.md', { eager: true, query: '?raw', import: 'default' });
const decisoesReal = reais['./fixtures/decisoes-real.md'];
const propostasReal = reais['./fixtures/propostas-real.md'];

const MODELO = `# Registro de decisões

## Formato

### DEC-000 — <título curto>
- Data:
- Nível: 2 (COVO) | 3 (Rodrigo)

## Entradas

### DEC-002 — P-001 aprovada: algo
- Data: 2026-10-27
- Demanda: construção da agência
- Nível: 3 (Rodrigo)
- Quem decidiu: Rodrigo
- Decisão: primeira linha
  - sub-item **A:** coisa
  - sub-item B
- Motivo / dados: porque sim
- Implementação: ver outro arquivo
- Como desfazer (se aplicável): nova decisão

### DEC-001 — Primeiro
- Data: 2026-10-02
- Demanda: D-001
- Nível: 2 (COVO)
- Quem decidiu: COVO
- Decisão: texto
`;

it('lê as decisões do formato do repositório e ignora o modelo DEC-000', () => {
  const { entradas, problemas } = lerDecisoes(MODELO);
  expect(problemas).toEqual([]);
  expect(entradas.map((e) => e.id)).toEqual(['DEC-002', 'DEC-001']);
  const a = entradas[0];
  expect(a).toMatchObject({ data: '2026-10-27', demandaRef: 'construção da agência', nivel: 3, quem: 'Rodrigo', motivo: 'porque sim', comoDesfazer: 'nova decisão', propostaId: 'P-001' });
  expect(a.decisao).toContain('primeira linha');
  expect(a.decisao).toContain('sub-item B'); // sub-itens ficam na decisão
  expect(a.observacoes).toBe('Implementação: ver outro arquivo'); // campo extra não se perde
  expect(entradas[1]).toMatchObject({ nivel: 2, motivo: null, comoDesfazer: null, observacoes: null, propostaId: null });
});

it('aponta o que falta em cada decisão, sem inventar valor', () => {
  const { entradas, problemas } = lerDecisoes('## Entradas\n\n### DEC-001 — Sem nada\n- Demanda: D-001\n\n### DEC-001 — Repetida\n- Data: 2026-02-30\n- Nível: 5\n');
  expect(entradas).toHaveLength(2);
  expect(problemas.map((p) => p.id)).toEqual(['DEC-001', 'DEC-001']);
  expect(problemas[0].motivo).toMatch(/data/);
  expect(problemas[0].motivo).toMatch(/nível/);
  expect(problemas[0].motivo).toMatch(/Quem decidiu/);
  expect(problemas[1].motivo).toMatch(/repetido/);
  expect(problemas[1].motivo).toMatch(/data/);
});

it('lê as propostas e liga cada uma à decisão que a aprovou', () => {
  const dec = lerDecisoes(MODELO).entradas;
  const md = `# Propostas\n\n## P-001 — Primeira\n\nTexto longo.\n\n**Decisão do Rodrigo (27/10, DEC-002):** aprovo.\n\n## P-002 — Segunda\n\nSó texto.\n`;
  const { entradas, problemas } = lerPropostas(md, dec);
  expect(problemas).toEqual([]);
  expect(entradas.map((p) => [p.id, p.titulo, p.decisaoId])).toEqual([
    ['P-001', 'Primeira', 'DEC-002'],
    ['P-002', 'Segunda', null],
  ]);
  expect(entradas[0].texto).toContain('Texto longo.');
});

it('a proposta sem linha de decisão usa a decisão cujo título começa com o número dela', () => {
  const dec = lerDecisoes(MODELO).entradas;
  const { entradas } = lerPropostas('## P-001 — Primeira\n\ncorpo\n', dec);
  expect(entradas[0].decisaoId).toBe('DEC-002');
});

it('proposta vazia ou repetida é problema', () => {
  const { problemas } = lerPropostas('## P-001 — A\n\n## P-001 — B\n\nx\n');
  expect(problemas.map((p) => p.motivo)).toEqual([expect.stringMatching(/sem texto/), expect.stringMatching(/repetido/)]);
});

it('arquivo sem entradas devolve listas vazias', () => {
  expect(lerDecisoes('# nada\n')).toEqual({ entradas: [], problemas: [] });
  expect(lerPropostas('# nada\n')).toEqual({ entradas: [], problemas: [] });
});

it.skipIf(!decisoesReal)('arquivos reais: 10 decisões e 8 propostas, sem problema, tudo ligado', () => {
  const d = lerDecisoes(decisoesReal);
  expect(d.problemas).toEqual([]);
  expect(d.entradas.map((e) => e.id).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `DEC-${String(i + 1).padStart(3, '0')}`));
  const p = lerPropostas(propostasReal, d.entradas);
  expect(p.problemas).toEqual([]);
  expect(p.entradas).toHaveLength(8);
  expect(p.entradas.find((x) => x.id === 'P-001').decisaoId).toBe('DEC-004');
  expect(p.entradas.find((x) => x.id === 'P-004').decisaoId).toBe('DEC-008');
});
