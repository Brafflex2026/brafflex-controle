import { it, expect } from 'vitest';
import { lerCsv } from '../worker/csv.js';

it('lê cabeçalho e linhas simples, com número de linha do arquivo', () => {
  const r = lerCsv('Empresa,Telefone\nTESTE-A,11 91111-1111\nTESTE-B,11 92222-2222\n');
  expect(r.cabecalho).toEqual(['empresa', 'telefone']);
  expect(r.linhas).toHaveLength(2);
  expect(r.linhas[0]).toMatchObject({ n: 2, valores: { empresa: 'TESTE-A', telefone: '11 91111-1111' } });
  expect(r.linhas[1].n).toBe(3);
});

it('entende aspas, vírgula e quebra de linha dentro do campo, e aspas duplas escapadas', () => {
  const r = lerCsv('Empresa,Sinais\n"TESTE, Ltda","linha 1\nlinha 2 ""citada"""\nTESTE-B,ok\n');
  expect(r.linhas[0].valores).toEqual({ empresa: 'TESTE, Ltda', sinais: 'linha 1\nlinha 2 "citada"' });
  expect(r.linhas[1]).toMatchObject({ n: 4, valores: { empresa: 'TESTE-B' } });
});

it('aceita ponto e vírgula, BOM, final de linha do Windows e cabeçalho com acento e maiúscula', () => {
  const r = lerCsv('﻿Clínica;Endereço;Nº avaliações\r\nTESTE-C;Rua X;12\r\n');
  expect(r.cabecalho).toEqual(['clinica', 'endereco', 'n avaliacoes']);
  expect(r.linhas[0].valores.clinica).toBe('TESTE-C');
});

it('ignora linha totalmente vazia e completa coluna que faltou', () => {
  const r = lerCsv('A,B,C\n1,2\n\n,,\n3,4,5\n');
  expect(r.linhas).toHaveLength(2);
  expect(r.linhas[0].valores).toEqual({ a: '1', b: '2', c: '' });
  expect(r.linhas[1].n).toBe(5);
});

it('arquivo vazio ou só com cabeçalho não tem linhas; aspas abertas dão erro', () => {
  expect(lerCsv('').linhas).toEqual([]);
  expect(lerCsv('A,B\n').linhas).toEqual([]);
  expect(lerCsv('A,B\n"aberta,1\n').erro).toMatch(/aspas/);
});
