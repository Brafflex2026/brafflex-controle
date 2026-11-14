import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const usuario = sqliteTable('usuario', {
  email: text('email').primaryKey(),
  nome: text('nome').notNull(),
  papel: text('papel', { enum: ['rodrigo', 'revisor_humano'] }).notNull(),
  criadoEm: text('criado_em')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

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
