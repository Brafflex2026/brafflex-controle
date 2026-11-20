// Leitura e mapeamento das linhas de leads (Ravclin e Etiqueteria). Não mexe no banco: só transforma texto em dados.
import { normalizarTelefone, validar, PLACE_ID } from './rotas/leads.js';

export const FONTES = ['ravclin', 'etiqueteria'];
const FAIXAS = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Status da planilha -> nome do estágio do funil. Nomes que já são de estágio valem sozinhos.
const ALIAS = {
  ravclin: { novo: 'Novo', abordar: 'Novo', contatado: 'Em contato', 'em negociacao': 'Conversa', cliente: 'Ganho', descartado: 'Perdido' },
  etiqueteria: { 'nao contatado': 'Captado' },
};

// Origem do dado -> origem da lista fechada do CRM. Null = não reconhecida.
export function mapearOrigem(valor, origens) {
  const v = norm(valor);
  if (!v) return null;
  const exata = origens.find((o) => norm(o) === v);
  if (exata) return exata;
  if (v.includes('grupo') && v.includes('whatsapp')) return 'grupo de WhatsApp';
  if (v.includes('maps') || v.includes('apify')) return 'Google Maps (API)';
  if (v.includes('instagram') || v.includes('site')) return 'site ou Instagram público';
  if (v.includes('indica')) return 'indicação';
  if (v.includes('evento')) return 'evento';
  if (v.includes('formulario')) return 'formulário com consentimento';
  return null;
}

function dataDe(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) { const b = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); if (b) m = [null, b[3], b[2].padStart(2, '0'), b[1].padStart(2, '0')]; }
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

const rotulo = (partes) => partes.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');

// Mapeia uma linha. Devolve { empresa, recusa } ou { empresa, optOut, telefone, placeId } ou { empresa, lead:{...}, estagio, avisos }.
export function mapearLinha(fonte, v, { estagios, origens }) {
  const avisos = [];
  const eRav = fonte === 'ravclin';
  const empresa = (eRav ? v.clinica : v.empresa) ?? '';
  const status = norm(v.status);
  if (!empresa.trim()) return { empresa, recusa: 'sem nome da empresa' };
  if (eRav && /^duplicada\b/i.test(empresa.trim())) return { empresa, recusa: 'marcada como DUPLICADA na origem' };

  // Telefone: o primeiro entre Telefone e WhatsApp que for válido.
  const candidatos = [v.telefone, v.whatsapp].filter((x) => x && x.trim());
  let telefone = null;
  for (const c of candidatos) { telefone = normalizarTelefone(c); if (telefone) break; }
  const placeBruto = (v['place id'] ?? '').trim();
  const placeId = placeBruto && PLACE_ID.test(placeBruto) ? placeBruto : null;

  const optColuna = norm(v['opt-out (nao contatar)']);
  const estagioNaoContatar = estagios.find((e) => e.final === 'Não contatar');
  const aliasNome = ALIAS[fonte][status];
  const porNome = estagios.find((e) => norm(e.nome) === status);
  const optOut = optColuna === 'sim' || (!!status && (norm(estagioNaoContatar?.nome) === status));
  if (optOut) return { empresa, optOut: true, telefone, placeId };

  if (candidatos.length > 0 && !telefone) return { empresa, recusa: 'telefone inválido (informe DDD + número)' };
  if (placeBruto && !placeId) return { empresa, recusa: 'Place ID inválido (deve começar com ChIJ)' };

  let estagio;
  if (!status) estagio = estagios[0];
  else estagio = estagios.find((e) => e.nome === aliasNome) ?? porNome;
  if (!estagio) return { empresa, recusa: `status "${v.status}" não existe neste funil` };

  let origem = 'Google Maps (API)';
  if (!eRav) {
    origem = mapearOrigem(v['origem do dado'], origens);
    if (!origem) return { empresa, recusa: `origem "${v['origem do dado'] ?? ''}" não reconhecida` };
  }

  const nota = (() => {
    if (!v.nota) return null;
    const x = Number(String(v.nota).replace(',', '.'));
    if (!Number.isFinite(x) || x < 0 || x > 100) { avisos.push('nota ignorada (use número de 0 a 100)'); return null; }
    return Math.round(x);
  })();
  let faixa = null;
  if (v.faixa) { faixa = FAIXAS[norm(v.faixa)] ?? null; if (!faixa) avisos.push('faixa ignorada (use Quente, Morno ou Frio)'); }

  const obsPartes = eRav
    ? [['Cidade', v.cidade], ['Bairro', v.bairro], ['Endereço', v.endereco], ['Site', v.site], ['Instagram', v.instagram], ['Sinais', v.sinais]]
    : [['Cidade', v.cidade], ['Bairro', v.bairro], ['Endereço', v.endereco], ['Site', v.site], ['Instagram', v.instagram], ['Vende etiqueta escolar', v['vende etiqueta escolar?']], ['Como vende hoje', v['como vende hoje']], ['Sinais', v.sinais], ['Observações', v.observacoes]];
  const observacoes = rotulo(obsPartes).slice(0, 1000) || null;
  const proximoPasso = !eRav && v['proximo passo'] ? v['proximo passo'].slice(0, 300) : null;

  const entrada = { empresa: empresa.trim(), baseLegal: 'legítimo interesse', origem, ...(telefone ? { telefone } : {}), ...(placeId ? { placeId } : {}), ...(nota !== null ? { nota } : {}), ...(faixa ? { faixa } : {}) };
  // Campos de texto livre com dado sensível: descarta o campo e avisa; os demais motivos recusam a linha.
  let tentativa = { ...entrada, ...(observacoes ? { observacoes } : {}), ...(proximoPasso ? { proximoPasso } : {}) };
  let r = validar(tentativa);
  for (let i = 0; i < 2 && r.falha; i += 1) {
    const campo = r.falha[0];
    if (campo !== 'observacoes' && campo !== 'proximoPasso') break;
    avisos.push(`${campo === 'observacoes' ? 'observações' : 'próximo passo'} descartado(s): ${r.falha[2] ?? 'dado sensível'}`);
    const { [campo]: _fora, ...resto } = tentativa;
    tentativa = resto;
    r = validar(tentativa);
  }
  if (r.falha) return { empresa, recusa: r.falha[1] };

  let motivoPerda = null;
  if (estagio.final === 'Perdido') motivoPerda = norm(estagio.nome) === 'fora do perfil' ? 'fora do perfil' : 'outro';

  let ultimoContatoEm = null;
  let ultimoContatoCanal = null;
  if (!eRav) {
    const d = dataDe(v['data 1 contato']);
    if (v['data 1 contato'] && !d) avisos.push('data do 1º contato ignorada (use AAAA-MM-DD ou DD/MM/AAAA)');
    const canal = (v['canal 1 contato'] ?? '').trim();
    if (d && canal && canal.length <= 60) { ultimoContatoEm = `${d}T12:00:00.000Z`; ultimoContatoCanal = canal; }
  }
  return { empresa: empresa.trim(), lead: r.dados, estagio, motivoPerda, ultimoContatoEm, ultimoContatoCanal, avisos };
}
