import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const usuario = sqliteTable('usuario', {
  email: text('email').primaryKey(),
  nome: text('nome').notNull(),
  papel: text('papel', { enum: ['rodrigo', 'revisor_humano'] }).notNull(),
  criadoEm: text('criado_em')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Campo desconhecido = NULL ("a confirmar"). Texto vazio = "não se aplica".
export const cliente = sqliteTable('cliente', {
  id: text('id').primaryKey(),
  chave: text('chave').notNull().unique(),
  nome: text('nome').notNull(),
  tipo: text('tipo', { enum: ['pessoa', 'empresa'] }).notNull(),
  profissao: text('profissao'),
  conselho: text('conselho'),
  registroUf: text('registro_uf'),
  registroNumero: text('registro_numero'),
  rqe: text('rqe'),
  saude: text('saude', { enum: ['sim', 'nao'] }),
  desde: text('desde'),
  arquivadoEm: text('arquivado_em'),
  criadoEm: text('criado_em')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  atualizadoEm: text('atualizado_em')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Cada marca de um cliente é um contrato. Vazio (NULL) = "a confirmar". Dinheiro em centavos.
export const contrato = sqliteTable('contrato', {
  id: text('id').primaryKey(),
  chave: text('chave').notNull().unique(),
  clienteId: text('cliente_id')
    .notNull()
    .references(() => cliente.id),
  marca: text('marca').notNull(),
  tipo: text('tipo', { enum: ['só marketing', 'só produto', 'produto + marketing'] }).notNull(),
  escopo: text('escopo'),
  verbaCentavos: integer('verba_centavos'),
  periodoInicio: text('periodo_inicio'),
  periodoFim: text('periodo_fim'),
  status: text('status', { enum: ['ativo', 'encerrado'] }).notNull(),
  encerradoEm: text('encerrado_em'),
  contatoAprovador: text('contato_aprovador'),
  leituraAutorizadaEm: text('leitura_autorizada_em'),
  leituraAutorizadaPor: text('leitura_autorizada_por'),
  leituraRevogadaEm: text('leitura_revogada_em'),
  criadoEm: text('criado_em')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  atualizadoEm: text('atualizado_em')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Versões do briefing de entrada. Nunca se edita uma versão: cada mudança é a versão seguinte.
export const briefing = sqliteTable(
  'briefing',
  {
    id: text('id').primaryKey(),
    chave: text('chave').notNull().unique(),
    contratoId: text('contrato_id')
      .notNull()
      .references(() => contrato.id),
    versao: integer('versao').notNull(),
    conteudo: text('conteudo').notNull(),
    criadoPor: text('criado_por').notNull(),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    confirmadoEm: text('confirmado_em'),
    confirmadoPor: text('confirmado_por'),
  },
  (t) => [uniqueIndex('briefing_contrato_versao').on(t.contratoId, t.versao)],
);

// Ligação de um contrato com um sistema externo. Guarda só o identificador público, nunca senha nem token.
export const TIPOS_INTEGRACAO = ['conta Meta', 'conta Google', 'pixel', 'página/IG', 'site', 'CRM do cliente'];
export const integracao = sqliteTable(
  'integracao',
  {
    id: text('id').primaryKey(),
    chave: text('chave').notNull().unique(),
    contratoId: text('contrato_id')
      .notNull()
      .references(() => contrato.id),
    tipo: text('tipo', { enum: TIPOS_INTEGRACAO }).notNull(),
    idExterno: text('id_externo'),
    dono: text('dono'),
    estado: text('estado', { enum: ['pendente', 'verificada', 'revogada'] }).notNull(),
    oQueFalta: text('o_que_falta'),
    verificadaEm: text('verificada_em'),
    revogadaEm: text('revogada_em'),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    atualizadoEm: text('atualizado_em')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex('integracao_contrato_tipo_id').on(t.contratoId, t.tipo, t.idExterno)],
);

// Demanda: o estado vem calculado pelo trilha.py no PC e é guardado como chegou. O app não recalcula.
export const demanda = sqliteTable('demanda', {
  id: text('id').primaryKey(), // D-NNN
  contratoId: text('contrato_id').references(() => contrato.id), // nulo = "sem contrato"
  clienteTexto: text('cliente_texto'),
  titulo: text('titulo'),
  modo: text('modo'),
  custoAlto: integer('custo_alto'),
  caminho: text('caminho'),
  status: text('status').notNull(),
  versao: integer('versao').notNull(),
  devolucoes: integer('devolucoes').notNull(),
  estado: text('estado').notNull(), // JSON do trilha.py
  nEventos: integer('n_eventos').notNull(),
  trilhaHead: text('trilha_head').notNull(), // sha256 do texto da última linha
  ultimoEventoEm: text('ultimo_evento_em'),
  verificacao: text('verificacao'),
  // Anotações do app (a trilha não as conhece). Vazio = "a confirmar".
  prazo: text('prazo'),
  responsavel: text('responsavel'),
  pendenciaNota: text('pendencia_nota'),
  proximoPasso: text('proximo_passo'),
  recebidoEm: text('recebido_em').notNull(),
  atualizadoEm: text('atualizado_em').notNull(),
});

// Eventos da trilha. Só acréscimo. `linha` é o texto exato (é ele que entra no hash da linha seguinte).
export const trilhaEvento = sqliteTable(
  'trilha_evento',
  {
    demandaId: text('demanda_id')
      .notNull()
      .references(() => demanda.id),
    n: integer('n').notNull(),
    ts: text('ts').notNull(),
    cmd: text('cmd').notNull(),
    ator: text('ator').notNull(),
    dados: text('dados').notNull(), // JSON
    prev: text('prev').notNull(),
    hash: text('hash').notNull(),
    assinatura: text('assinatura'),
    linha: text('linha').notNull(),
    recebidoEm: text('recebido_em').notNull(),
  },
  (t) => [primaryKey({ columns: [t.demandaId, t.n] })],
);

export const auditoriaApp = sqliteTable('auditoria_app', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: text('ts')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  usuario: text('usuario').notNull(),
  acao: text('acao').notNull(),
  entidade: text('entidade').notNull(),
  entidadeId: text('entidade_id').notNull(),
  antes: text('antes'),
  depois: text('depois'),
});
