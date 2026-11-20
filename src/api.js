// Chamadas à API do app. O login é do Cloudflare Access: o navegador já envia o cookie.
async function pedir(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...opcoes,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(corpo.erro || 'Algo deu errado. Tente de novo.');
    erro.status = resposta.status;
    erro.campo = corpo.campo;
    throw erro;
  }
  return corpo;
}

export const api = {
  eu: () => pedir('/api/eu'),
  alterarNome: (nome) => pedir('/api/eu', { method: 'PATCH', body: JSON.stringify({ nome }) }),
  clientes: (arquivados = false) => pedir(`/api/clientes${arquivados ? '?arquivados=1' : ''}`),
  cliente: (id) => pedir(`/api/clientes/${id}`),
  // `chave` identifica este envio: se der timeout e repetir, o servidor não cria outro cliente.
  criarCliente: (dados, chave) => pedir('/api/clientes', { method: 'POST', body: JSON.stringify(dados), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  alterarCliente: (id, dados) => pedir(`/api/clientes/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  arquivarCliente: (id) => pedir(`/api/clientes/${id}/arquivar`, { method: 'POST' }),
  restaurarCliente: (id) => pedir(`/api/clientes/${id}/restaurar`, { method: 'POST' }),
  contratosDoCliente: (clienteId) => pedir(`/api/clientes/${clienteId}/contratos`),
  contrato: (id) => pedir(`/api/contratos/${id}`),
  criarContrato: (clienteId, dados, chave) =>
    pedir(`/api/clientes/${clienteId}/contratos`, { method: 'POST', body: JSON.stringify(dados), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  alterarContrato: (id, dados) => pedir(`/api/contratos/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  autorizarLeitura: (id, autorizadaPor) => pedir(`/api/contratos/${id}/autorizar-leitura`, { method: 'POST', body: JSON.stringify({ autorizadaPor }) }),
  revogarLeitura: (id) => pedir(`/api/contratos/${id}/revogar-leitura`, { method: 'POST' }),
  encerrarContrato: (id) => pedir(`/api/contratos/${id}/encerrar`, { method: 'POST' }),
  integracoes: (contratoId) => pedir(`/api/contratos/${contratoId}/integracoes`),
  criarIntegracao: (contratoId, dados, chave) =>
    pedir(`/api/contratos/${contratoId}/integracoes`, { method: 'POST', body: JSON.stringify(dados), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  alterarIntegracao: (id, dados) => pedir(`/api/integracoes/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  verificarIntegracao: (id, verificadaEm) => pedir(`/api/integracoes/${id}/verificar`, { method: 'POST', body: JSON.stringify({ verificadaEm }) }),
  revogarIntegracao: (id) => pedir(`/api/integracoes/${id}/revogar`, { method: 'POST' }),
  reativarIntegracao: (id) => pedir(`/api/integracoes/${id}/reativar`, { method: 'POST' }),
  auditoria: (filtros = {}, antes = null) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v);
    if (antes) p.set('antes', String(antes));
    p.set('limite', '50');
    return pedir(`/api/auditoria?${p}`);
  },
  filtrosAuditoria: () => pedir('/api/auditoria/filtros'),
  demandas: (filtros = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v === true ? '1' : v);
    return pedir(`/api/demandas?${p}`);
  },
  demanda: (id) => pedir(`/api/demandas/${encodeURIComponent(id)}`),
  alterarDemanda: (id, dados) => pedir(`/api/demandas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  ligarDemanda: (id, contratoId) => pedir(`/api/demandas/${encodeURIComponent(id)}/ligar-contrato`, { method: 'POST', body: JSON.stringify({ contratoId }) }),
  decisoes: (filtros = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v);
    return pedir(`/api/decisoes?${p}`);
  },
  decisao: (id) => pedir(`/api/decisoes/${encodeURIComponent(id)}`),
  criarDecisao: (dados, chave) => pedir('/api/decisoes', { method: 'POST', body: JSON.stringify(dados), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  propostas: () => pedir('/api/propostas'),
  proposta: (id) => pedir(`/api/propostas/${encodeURIComponent(id)}`),
  criarProposta: (dados, chave) => pedir('/api/propostas', { method: 'POST', body: JSON.stringify(dados), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  previaImportacao: (arquivos) => pedir('/api/decisoes/importar/previa', { method: 'POST', body: JSON.stringify(arquivos) }),
  importarDecisoes: (arquivos, confirmar) => pedir('/api/decisoes/importar', { method: 'POST', body: JSON.stringify({ ...arquivos, confirmar }) }),
  funis: () => pedir('/api/funis'),
  leads: (filtros = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v === true ? '1' : v);
    return pedir(`/api/leads?${p}`);
  },
  lead: (id) => pedir(`/api/leads/${encodeURIComponent(id)}`),
  criarLead: (dados, chave) => pedir('/api/leads', { method: 'POST', body: JSON.stringify(dados), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  alterarLead: (id, dados) => pedir(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  previaLeads: (dados) => pedir('/api/leads/importar/previa', { method: 'POST', body: JSON.stringify(dados) }),
  importarLeads: (dados, confirmar) => pedir('/api/leads/importar', { method: 'POST', body: JSON.stringify({ ...dados, confirmar }) }),
  optoutLead: (id) => pedir(`/api/leads/${encodeURIComponent(id)}/optout`, { method: 'POST' }),
  converterLead: (id, dados) => pedir(`/api/leads/${encodeURIComponent(id)}/converter`, { method: 'POST', body: JSON.stringify(dados) }),
  eventoLead: (id, dados) => pedir(`/api/leads/${encodeURIComponent(id)}/eventos`, { method: 'POST', body: JSON.stringify(dados) }),
  briefings: (contratoId) => pedir(`/api/contratos/${contratoId}/briefings`),
  criarBriefing: (contratoId, conteudo, chave) =>
    pedir(`/api/contratos/${contratoId}/briefings`, { method: 'POST', body: JSON.stringify({ conteudo }), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  confirmarBriefing: (id, confirmadoEm) => pedir(`/api/briefings/${id}/confirmar`, { method: 'POST', body: JSON.stringify({ confirmadoEm }) }),
};
