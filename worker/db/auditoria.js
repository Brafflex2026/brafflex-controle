import { auditoriaApp } from './schema.js';

// Grava a mudança e o registro de auditoria no mesmo lote: ou entram os dois, ou nenhum.
export function gravarComAuditoria(db, { usuario, acao, entidade, entidadeId, antes, depois }, statement) {
  return db.batch([
    statement,
    db.insert(auditoriaApp).values({
      usuario,
      acao,
      entidade,
      entidadeId,
      antes: antes == null ? null : JSON.stringify(antes),
      depois: depois == null ? null : JSON.stringify(depois),
    }),
  ]);
}
