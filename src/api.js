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
  briefings: (contratoId) => pedir(`/api/contratos/${contratoId}/briefings`),
  criarBriefing: (contratoId, conteudo, chave) =>
    pedir(`/api/contratos/${contratoId}/briefings`, { method: 'POST', body: JSON.stringify({ conteudo }), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }),
  confirmarBriefing: (id, confirmadoEm) => pedir(`/api/briefings/${id}/confirmar`, { method: 'POST', body: JSON.stringify({ confirmadoEm }) }),
};
