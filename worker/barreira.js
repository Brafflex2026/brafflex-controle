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
  ['senha ou token com valor', /(?<![A-Za-z])(?:senha|password|passwd|token|api[_ -]?key|secret)\b[\s:=]{0,10}["']?(?=[^\s"'<>[\]{}]{0,200}\d)[^\s"'<>[\]{}]{6,}/i],
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
    .replace(/%40/gi, '@')
    // Tira todo caractere de formatação invisível (hífen suave, marcas de direção, separadores invisíveis).
    .replace(/[\p{Cf}­͏]/gu, '')
    .replace(/[‐-―−]/g, '-');
}

// Devolve null se o texto está limpo, ou { motivo } se algum padrão bateu.
export function verificarTexto(texto, padroes = PADROES) {
  if (typeof texto !== 'string' || texto === '') return null;
  const t = normalizar(texto);
  for (const [tipo, regra] of padroes) {
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

// Variante para a trilha: os campos `hash`, `prev` e `assinatura` são sequências de 64 caracteres por natureza,
// então a regra de "sequência longa" fica de fora. O resto (CPF, telefone, e-mail, chaves, nome de paciente) vale.
const PADROES_TRILHA = PADROES.filter(([tipo]) => !tipo.startsWith('sequência longa'));
export const verificarTrilha = (texto) => verificarTexto(texto, PADROES_TRILHA);

// Variante para identificadores de contas e sistemas (id de conta, pixel, endereço de site).
// Número de conta com 10 a 16 dígitos é normal e não pode ser confundido com telefone, CPF ou CNPJ, então esses três
// padrões ficam de fora. Em troca, recusa o que tem cara de chave de acesso: cadeia longa e opaca e prefixos conhecidos.
const IGNORADOS_EM_IDENTIFICADOR = new Set(['CPF', 'CNPJ', 'telefone']);

// Trechos de 32+ caracteres que alternam letras e dígitos muitas vezes (a1b2c3…) são típicos de chave aleatória.
// Endereço e nome de página (letras com um ano no fim, por exemplo) alternam pouco e não são barrados.
const cadeiaAleatoria = {
  test(t) {
    for (const [trecho] of t.matchAll(/[A-Za-z0-9_-]{32,}/g)) {
      const base = trecho.replace(/[_-]/g, '');
      if (!/\d/.test(base) || !/[A-Za-z]/.test(base)) continue;
      const trocas = (base.match(/(?<=\d)(?=[A-Za-z])|(?<=[A-Za-z])(?=\d)/g) ?? []).length;
      if (trocas >= 4) return true;
    }
    return false;
  },
};

// Chave dividida em pedaços (por espaço, ponto, dois-pontos ou barra): quatro pedaços seguidos de 4+ caracteres,
// cada um misturando letras e dígitos.
const chaveFragmentada = {
  test(t) {
    let seguidos = 0;
    for (const parte of t.split(/[\s.:/]+/)) {
      if (/^[A-Za-z0-9]{4,}$/.test(parte) && /\d/.test(parte) && /[A-Za-z]/.test(parte)) {
        if (++seguidos >= 4) return true;
      } else seguidos = 0;
    }
    return false;
  },
};

const PADROES_IDENTIFICADOR = [
  ...PADROES.filter(([tipo]) => !IGNORADOS_EM_IDENTIFICADOR.has(tipo)),
  ['token de acesso conhecido (Meta ou Google)', /(?<![A-Za-z0-9_-])(?:EAA[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{6,}|GOCSPX-[A-Za-z0-9_-]{10,})/],
  ['token do tipo Bearer', /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i],
  ['token curto conhecido (GitHub, sk-)', /(?<![A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{5,}|sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{5,})/],
  ['token em formato JWT', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/],
  ['chave ou senha dentro do endereço (parâmetro da URL)', /[?&;](?:access_token|refresh_token|id_token|token|key|apikey|api_key|sig|signature|secret|client_secret|auth|password|senha)=[^&\s]{4,}/i],
  ['usuário e senha dentro do endereço', /:\/\/[^/\s@]+:[^/\s@]+@/],
  ['cadeia longa e aleatória (parece chave de acesso)', cadeiaAleatoria],
  ['chave dividida em pedaços', chaveFragmentada],
];
export const verificarIdentificador = (texto) => verificarTexto(texto, PADROES_IDENTIFICADOR);

// Confere vários campos de uma vez; devolve { campo, motivo } do primeiro que bater.
export function verificarCampos(objeto) {
  for (const [campo, valor] of Object.entries(objeto)) {
    const r = verificarTexto(valor);
    if (r) return { campo, motivo: r.motivo, ...(r.linha ? { linha: r.linha } : {}) };
  }
  return null;
}
