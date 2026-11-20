// Retenção: lead perdido há mais de 12 meses tem o contato apagado (LGPD: não guardar além do necessário).
// Roda todo mês pelo Cron. A data de "hoje" vem de fora para o teste poder simular o tempo.
const MESES = 12;
const POR_RODADA = 200;

export async function aplicarRetencao(DB, { agora = new Date() } = {}) {
  const corte = new Date(agora);
  corte.setUTCMonth(corte.getUTCMonth() - MESES);
  const ts = agora.toISOString();

  const { results } = await DB.prepare(
    `SELECT l.id FROM lead l JOIN estagio e ON e.id = l.estagio_id
     WHERE e.final = 'Perdido' AND l.estagio_desde < ? AND l.contato_apagado_em IS NULL AND l.opt_out_em IS NULL
     ORDER BY l.estagio_desde LIMIT ${POR_RODADA}`,
  ).bind(corte.toISOString()).all();

  let apagados = 0;
  for (const { id } of results) {
    const r = await DB.batch([
      // Só vale se o lead continua perdido e ainda não foi apagado; o resto do lote só entra se este comando mexeu na linha.
      DB.prepare(
        `UPDATE lead SET telefone = NULL, contato = NULL, place_id = NULL, observacoes = NULL, consentimento_como = NULL,
           contato_apagado_em = ?, atualizado_em = ?
         WHERE id = ? AND contato_apagado_em IS NULL AND opt_out_em IS NULL
           AND estagio_id IN (SELECT id FROM estagio WHERE final = 'Perdido')`,
      ).bind(ts, ts, id),
      DB.prepare(
        `INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois)
         SELECT ?, 'sistema:retencao', 'apagar_contato', 'lead', ?, NULL, ? WHERE changes() = 1`,
      ).bind(ts, id, JSON.stringify({ motivo: `perdido há mais de ${MESES} meses`, camposApagados: ['telefone', 'contato', 'placeId', 'observacoes', 'consentimentoComo', 'notasDoHistorico'] })),
      DB.prepare(
        `UPDATE lead_evento SET nota = NULL WHERE lead_id = ? AND nota IS NOT NULL
           AND EXISTS (SELECT 1 FROM lead WHERE id = ? AND contato_apagado_em = ?)`,
      ).bind(id, id, ts),
    ]);
    if (r[0].meta.changes === 1) apagados += 1;
  }
  return { apagados, candidatos: results.length };
}
