// Barreira de dado sensível: um módulo só, usado em todo texto que entra no app.
// Parte dos padrões do ferramentas/seguranca/varredura.py do repositório da agência, endurecidos para
// as formas de digitar que a varredura não pega (sem pontuação, com espaço, caracteres largos ou invisíveis).
// Nunca devolve o valor encontrado, só o motivo, para a recusa não virar um novo vazamento.
const NOME = '[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,}';
const PADROES = [
  ['CPF', /(?<!\d)\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s-]?\d{2}(?!\d)/],
  ['CNPJ', /(?<!\d)\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s/]?\d{4}[\s-]?\d{2}(?!\d)/],
  ['telefone', /(?<!\d)(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/],
  // Limites de tamanho (64 e 255) evitam que texto enorme faça a análise demorar.
  ['e-mail', /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/],
  ['chave de API', /\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/],
  ['token de acesso (JWT)', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/],
  ['sequência longa de letras e números (parece segredo)', /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/],
  ['senha ou token com valor', /\b(?:senha|password|passwd|token|api[_ -]?key|secret)\b[\s:=]{0,10}["']?(?=[^\s"'<>[\]{}]{0,200}\d)[^\s"'<>[\]{}]{6,}/i],
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
    // Tira todo caractere de formatação invisível (hífen suave, marcas de direção, separadores invisíveis).
    .replace(/[\p{Cf}­͏]/gu, '')
    .replace(/[‐-―−]/g, '-');
}

// Devolve null se o texto está limpo, ou { motivo } se algum padrão bateu.
export function verificarTexto(texto) {
  if (typeof texto !== 'string' || texto === '') return null;
  const t = normalizar(texto);
  for (const [tipo, regra] of PADROES) {
    if (!regra.test(t)) continue;
    const resultado = { motivo: `parece conter ${tipo}; o app não guarda esse tipo de dado` };
    // Em texto de várias linhas, diz em qual linha está (sem repetir o valor), para a pessoa achar e corrigir.
    const linhas = t.split(/\r?\n/);
    if (linhas.length > 1) {
      const n = linhas.findIndex((l) => regra.test(l)) + 1;
      if (n > 0) resultado.linha = n;
    }
    return resultado;
  }
  return null;
}

// Confere vários campos de uma vez; devolve { campo, motivo } do primeiro que bater.
export function verificarCampos(objeto) {
  for (const [campo, valor] of Object.entries(objeto)) {
    const r = verificarTexto(valor);
    if (r) return { campo, motivo: r.motivo, ...(r.linha ? { linha: r.linha } : {}) };
  }
  return null;
}
