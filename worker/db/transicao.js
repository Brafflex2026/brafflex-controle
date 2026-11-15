// Muda uma linha e grava a auditoria no mesmo lote, os dois só se a condição ainda for verdadeira naquele
// instante. Serve para trocas de estado em que duas ações simultâneas (ou um contrato encerrado no meio) não
// podem passar as duas. Os nomes de tabela e de coluna vêm do código, nunca de quem usa o app.
// Devolve true se mudou; false se a condição já não valia.
export async function mudarComAuditoria(DB, { tabela, id, mudanca, condicao, condicaoBinds = [], usuario, acao, entidade, antes, depois }) {
  const colunas = Object.keys(mudanca);
  const agora = new Date().toISOString();
  const resultados = await DB.batch([
    DB.prepare(
      `INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois)
       SELECT ?, ?, ?, ?, id, ?, ? FROM ${tabela} WHERE id = ? AND ${condicao}`,
    ).bind(agora, usuario, acao, entidade, antes == null ? null : JSON.stringify(antes), depois == null ? null : JSON.stringify(depois), id, ...condicaoBinds),
    DB.prepare(`UPDATE ${tabela} SET ${colunas.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND ${condicao}`).bind(
      ...colunas.map((c) => mudanca[c]),
      id,
      ...condicaoBinds,
    ),
  ]);
  return resultados[1].meta.changes === 1;
}
