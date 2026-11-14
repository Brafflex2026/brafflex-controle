import { it, expect } from 'vitest';
import { verificarTexto } from '../worker/barreira.js';

// Valores abaixo são inventados e servem só para testar o padrão.
const recusados = [
  ['CPF', 'cliente 111.444.777-35 aprovou'],
  ['CNPJ', 'empresa 11.222.333/0001-81'],
  ['telefone', 'ligar (11) 91234-5678'],
  ['e-mail', 'falar com fulano@exemplo.com'],
  ['chave de API', 'usar sk-abcdefghijklmnopqrstuvwxyz123456'],
  ['sequência longa', 'a'.repeat(0) + '0123456789abcdef'.repeat(4)],
  ['senha atribuída', 'senha: abc12345'],
  ['token atribuído', 'token = ABCDEF123456'],
  ['paciente nominal', 'paciente Maria Souza voltou'],
  // formas de digitar que antes passavam
  ['CPF sem pontos', 'cpf 11144477735'],
  ['CPF com espaços', 'cpf 111 444 777 35'],
  ['CPF com dígitos largos', 'cpf １１１.４４４.７７７-３５'],
  ['CPF com hífen unicode', 'cpf 111.444.777‑35'],
  ['CPF com caractere invisível', 'cpf 111.444.​777-35'],
  ['CNPJ sem pontuação', 'empresa 11222333000181'],
  ['telefone sem hífen', 'ligar 11912345678'],
  ['telefone com espaço', 'ligar (11) 91234 5678'],
  ['telefone colado ao prefixo', 'tel.(11)91234-5678'],
  ['e-mail com arroba larga', 'fulano＠exemplo.com'],
  ['JWT', 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc-def_123'],
  ['chave sk curta', 'sk-ant-abc12345'],
  ['token sem dois-pontos', 'token abc12345678'],
  ['paciente com partícula', 'Paciente Maria da Silva'],
  ['paciente com dois-pontos', 'Paciente: Maria Souza'],
];

for (const [tipo, texto] of recusados) {
  it(`recusa ${tipo} e não devolve o valor`, () => {
    const r = verificarTexto(texto);
    expect(r).not.toBeNull();
    expect(typeof r.motivo).toBe('string');
    expect(r.motivo).not.toContain(texto);
  });
}

it('aceita texto comum, inclusive com marcador de paciente', () => {
  expect(verificarTexto('Dermatologista, clínica no centro')).toBeNull();
  expect(verificarTexto('paciente [NOME DE PACIENTE] agendou')).toBeNull();
  expect(verificarTexto('CRM 123456')).toBeNull();
  expect(verificarTexto('Dermatologia e estética, 12 anos de clínica')).toBeNull();
  expect(verificarTexto('paciente Fictício agendou')).toBeNull();
  expect(verificarTexto('')).toBeNull();
});
