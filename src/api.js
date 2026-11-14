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
};
