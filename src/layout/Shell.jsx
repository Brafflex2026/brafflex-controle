import { useState } from 'react';
import { Menu, X, House, Users, ClipboardList, Funnel, Megaphone, ChartColumn, Scale, History } from 'lucide-react';
import { Button } from '@/components/ui/button';

const itens = [
  { id: 'inicio', rotulo: 'Início', icone: House, pronto: true },
  { id: 'clientes', rotulo: 'Clientes', icone: Users, pronto: true },
  { id: 'demandas', rotulo: 'Demandas', icone: ClipboardList, pronto: true },
  { id: 'funil', rotulo: 'Funil e CRM', icone: Funnel, pronto: true },
  { id: 'anuncios', rotulo: 'Anúncios', icone: Megaphone },
  { id: 'desempenho', rotulo: 'Desempenho', icone: ChartColumn },
  { id: 'decisoes', rotulo: 'Decisões', icone: Scale, pronto: true },
  { id: 'auditoria', rotulo: 'Auditoria', icone: History, pronto: true },
];

function MenuLateral({ aoEscolher, atual }) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-1 p-3">
      <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Agência</p>
      {itens.map(({ id, rotulo, icone: Icone, pronto }) =>
        pronto ? (
          <a
            key={id}
            href={id === 'inicio' ? '#/' : `#/${id}`}
            aria-current={atual === id ? 'page' : undefined}
            onClick={aoEscolher}
            className={
              atual === id
                ? 'flex h-9 items-center gap-2 rounded-md bg-brand-50 px-2 font-medium text-brand-700'
                : 'flex h-9 items-center gap-2 rounded-md px-2 text-foreground hover:bg-muted'
            }
          >
            <Icone aria-hidden="true" className="size-4" />
            {rotulo}
          </a>
        ) : (
          <span
            key={id}
            aria-disabled="true"
            className="flex h-9 items-center gap-2 rounded-md px-2 text-muted-foreground"
          >
            <Icone aria-hidden="true" className="size-4" />
            <span className="flex-1">{rotulo}</span>
            <span className="text-[11px]">em breve</span>
          </span>
        ),
      )}
    </nav>
  );
}

export function Shell({ usuario, atual, children }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-brand-900 px-4 text-white">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white lg:hidden"
            aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={aberto}
            onClick={() => setAberto((v) => !v)}
          >
            {aberto ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
          <span className="font-semibold tracking-tight">
            BRAFFLEX <span className="font-medium text-cyan-detail">Tech</span>
          </span>
          <span className="hidden text-white/70 sm:inline">· Controle da agência</span>
        </div>
        {usuario && <span className="hidden truncate text-xs text-white/80 sm:inline">{usuario.email}</span>}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r bg-card lg:block">
          <MenuLateral atual={atual} />
        </aside>
        {aberto && (
          <div className="fixed inset-x-0 bottom-0 top-12 z-20 lg:hidden">
            <button className="absolute inset-0 bg-black/40" aria-label="Fechar menu" onClick={() => setAberto(false)} />
            <aside className="relative h-full w-64 max-w-[85%] overflow-y-auto border-r bg-card">
              <MenuLateral atual={atual} aoEscolher={() => setAberto(false)} />
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
