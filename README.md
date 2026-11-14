# Base SaaS local

React + Vite + Tailwind + componentes shadcn. Use Node 22.12 ou superior: `npm ci`, `npm run dev`, `npm run build`. Dependências diretas exatas e transitivas no package-lock.json. Atualize deliberadamente, validando novamente.

O formulário e a tabela são exemplos explícitos com estado React somente na sessão. Recarregar limpa tudo; não há backend, banco, autenticação nem localStorage. Remova a demonstração ao implementar o produto. Conecte a persistência conforme a decisão arquitetural da skill.

- Identidade e tokens: `src/styles.css`.
- Componentes reutilizáveis: `src/components/ui` e `resource-state.jsx`.
- Proxy opcional `/api`: defina `API_PROXY_TARGET` em `.env.local`; sem configuração não há proxy. Porta livre do Vite; para uma porta definida use `npm run dev -- --port 5199 --strictPort`.
- Para adicionar componentes, use uma versão explícita e verificada do CLI shadcn; não rode `latest` automaticamente. O `components.json` já configura os aliases.

## Proveniência

Os oito componentes UI são um snapshot dos componentes shadcn presentes em `/Users/thaleslaray/Projetos/planejar-v6-shadcn/web/components/ui` no commit `0e28c037910976e7fe821dab8634fb3fee5e1590`, em 2026-09-22. A versão original do CLI não foi registrada e não é alegada. O código dos componentes é versionado junto da base. Fonte upstream: https://github.com/shadcn-ui/ui. Licença MIT preservada em `LICENSE.shadcn.md`, obtida do upstream. Adaptações neste starter: rótulos de fechar em português e remoção das classes de animação que exigiriam plugin adicional. O tema, demonstração e ResourceState pertencem à base local.

Compatibilidade validável neste ambiente: build Vite. Não presume compatibilidade com o runtime nativo Think nem publicação em produção.
