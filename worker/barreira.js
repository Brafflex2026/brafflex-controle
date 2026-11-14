// Barreira de dado sensível: um módulo só, usado em todo texto que entra no app.
// Parte dos padrões do ferramentas/seguranca/varredura.py do repositório da agência, endurecidos para
// as formas de digitar que a varredura não pega (sem pontuação, com espaço, caracteres largos ou invisíveis).
// Nunca devolve o valor encontrado, só o motivo, para a recusa não virar um novo vazamento.
const NOME = '[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,}';
const PADROES = [
  ['CPF', /(?<!\d)\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s-]?\d{2}(?!\d)/],
  ['CNPJ', /(?<!\d)\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s/]?\d{4}[\s-]?\d{2}(?!\d)/],
  ['telefone', /(?<!\d)(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/],
  ['e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['chave de API', /\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/],
  ['token de acesso (JWT)', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/],
  ['sequência longa de letras e números (parece segredo)', /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/],
  ['senha ou token com valor', /\b(?:senha|password|passwd|token|api[_ -]?key|secret)\b\s*[:=]?\s*["']?(?=[^\s"'<>[\]{}]*\d)[^\s"'<>[\]{}]{6,}/i],
  [
    'nome de paciente',
    new RegExp(`\\b[Pp]aciente:?\\s+(?!\\[)(?!(?:Identificável|Fictícia|Fictício|Real|Reconhecível|Nominal)\\b)${NOME}(?:\\s+(?:d[aeo]s?\\s+)?${NOME})?`),
  ],
];

// Iguala as formas de escrever antes de testar: letras e dígitos largos viram normais, e
// caracteres invisíveis e hífens "diferentes" somem ou viram hífen comum.
function normalizar(texto) {
  return texto
    .normalize('NFKC')
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/[‐-―−]/g, '-');
}

// Devolve null se o texto está limpo, ou { motivo } se algum padrão bateu.
export function verificarTexto(texto) {
  if (typeof texto !== 'string' || texto === '') return null;
  const t = normalizar(texto);
  for (const [tipo, regra] of PADROES) {
    if (regra.test(t)) return { motivo: `parece conter ${tipo}; o app não guarda esse tipo de dado` };
  }
  return null;
}

// Confere vários campos de uma vez; devolve { campo, motivo } do primeiro que bater.
export function verificarCampos(objeto) {
  for (const [campo, valor] of Object.entries(objeto)) {
    const r = verificarTexto(valor);
    if (r) return { campo, motivo: r.motivo };
  }
  return null;
}
