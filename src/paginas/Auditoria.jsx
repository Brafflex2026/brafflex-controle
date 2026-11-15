import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';

const ENTIDADES = { cliente: 'Cliente', contrato: 'Contrato', briefing: 'Briefing', integracao: 'Integração', usuario: 'Usuário', demanda: 'Demanda' };
const ACOES = {
  criar: 'Criou',
  alterar: 'Alterou',
  arquivar: 'Arquivou',
  restaurar: 'Restaurou',
  encerrar: 'Encerrou',
  autorizar_leitura: 'Autorizou a leitura',
  revogar_leitura: 'Revogou a leitura',
  confirmar: 'Confirmou',
  verificar: 'Verificou',
  revogar: 'Revogou',
  reativar: 'Reativou',
  enviar_trilha: 'Recebeu trilha',
};
const rotuloEntidade = (e) => ENTIDADES[e] ?? e;
const rotuloAcao = (a) => ACOES[a] ?? a;
const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const linkDaEntidade = (i) => (i.entidade === 'cliente' ? `#/clientes/${i.entidadeId}` : i.entidade === 'contrato' ? `#/contratos/${i.entidadeId}` : null);
const mostrar = (v) => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function Detalhe({ item }) {
  const campos = [...new Set([...Object.keys(item.antes && typeof item.antes === 'object' ? item.antes : {}), ...Object.keys(item.depois && typeof item.depois === 'object' ? item.depois : {})])];
  const objetos = (item.antes === null || typeof item.antes === 'object') && (item.depois === null || typeof item.depois === 'object');
  return (
    <div className="space-y-2 bg-muted/50 px-4 py-3 text-sm">
      <p className="text-xs text-muted-foreground">Registro nº {item.id} · {item.entidade} {item.entidadeId}</p>
      {objetos && campos.length > 0 ? (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs text-muted-foreground"><th className="pb-1 pr-4 font-medium">Campo</th><th className="pb-1 pr-4 font-medium">Antes</th><th className="pb-1 font-medium">Depois</th></tr>
          </thead>
          <tbody>
            {campos.map((c) => (
              <tr key={c} className="align-top">
                <td className="pr-4 font-medium">{c}</td>
                <td className="whitespace-pre-wrap break-words pr-4">{mostrar(item.antes?.[c])}</td>
                <td className="whitespace-pre-wrap break-words">{mostrar(item.depois?.[c])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">Antes</p><pre className="whitespace-pre-wrap break-words">{mostrar(item.antes)}</pre></div>
          <div><p className="text-xs text-muted-foreground">Depois</p><pre className="whitespace-pre-wrap break-words">{mostrar(item.depois)}</pre></div>
        </div>
      )}
    </div>
  );
}

export function Auditoria() {
  const [filtrosDisponiveis, setDisp] = useState({ entidades: [], acoes: [], usuarios: [] });
  const [f, setF] = useState({ entidade: '', acao: '', usuario: '', de: '', ate: '' });
  const [estado, setEstado] = useState('carregando');
  const [itens, setItens] = useState([]);
  const [proximo, setProximo] = useState(null);
  const [aberto, setAberto] = useState(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroMais, setErroMais] = useState('');
  const [erroFiltro, setErroFiltro] = useState('');
  const pedidoAtual = useRef(0);

  const [semOpcoes, setSemOpcoes] = useState(false);
  useEffect(() => { api.filtrosAuditoria().then(setDisp).catch(() => setSemOpcoes(true)); }, []);

  const carregar = useCallback(async () => {
    const numero = ++pedidoAtual.current;
    setEstado('carregando');
    setErroFiltro('');
    setErroMais('');
    setCarregandoMais(false);
    setAberto(null);
    try {
      const r = await api.auditoria(f);
      if (numero !== pedidoAtual.current) return; // chegou depois de um filtro mais novo: descarta
      setItens(r.itens);
      setProximo(r.proximo);
      setEstado('pronto');
    } catch (e) {
      if (numero !== pedidoAtual.current) return;
      if (e.status === 422) {
        setErroFiltro(e.message);
        setItens([]);
        setProximo(null);
        setEstado('pronto');
      } else setEstado('erro');
    }
  }, [f]);
  useEffect(() => { carregar(); }, [carregar]);

  async function maisLinhas() {
    const numero = pedidoAtual.current;
    setCarregandoMais(true);
    setErroMais('');
    try {
      const r = await api.auditoria(f, proximo);
      if (numero !== pedidoAtual.current) return;
      setItens((atuais) => [...atuais, ...r.itens]);
      setProximo(r.proximo);
    } catch (e) {
      if (numero === pedidoAtual.current) setErroMais(e.message);
    } finally {
      if (numero === pedidoAtual.current) setCarregandoMais(false);
    }
  }

  const mudar = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));
  const temFiltro = Object.values(f).some(Boolean);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-muted-foreground">Quem mudou o quê e quando. Só leitura: nada aqui pode ser alterado ou apagado.</p>
      </div>

      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Filtros da auditoria">
        <div className="space-y-1">
          <label htmlFor="aud-entidade" className="text-xs text-muted-foreground">O quê</label>
          <NativeSelect id="aud-entidade" className="w-full" value={f.entidade} onChange={mudar('entidade')}>
            <NativeSelectOption value="">Tudo</NativeSelectOption>
            {filtrosDisponiveis.entidades.map((e) => <NativeSelectOption key={e} value={e}>{rotuloEntidade(e)}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor="aud-acao" className="text-xs text-muted-foreground">Ação</label>
          <NativeSelect id="aud-acao" className="w-full" value={f.acao} onChange={mudar('acao')}>
            <NativeSelectOption value="">Todas</NativeSelectOption>
            {filtrosDisponiveis.acoes.map((a) => <NativeSelectOption key={a} value={a}>{rotuloAcao(a)}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor="aud-usuario" className="text-xs text-muted-foreground">Quem</label>
          <NativeSelect id="aud-usuario" className="w-full" value={f.usuario} onChange={mudar('usuario')}>
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {filtrosDisponiveis.usuarios.map((u) => <NativeSelectOption key={u} value={u}>{u}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor="aud-de" className="text-xs text-muted-foreground">De</label>
          <Input id="aud-de" type="date" value={f.de} max={f.ate || undefined} onChange={mudar('de')} />
        </div>
        <div className="space-y-1">
          <label htmlFor="aud-ate" className="text-xs text-muted-foreground">Até</label>
          <Input id="aud-ate" type="date" value={f.ate} min={f.de || undefined} onChange={mudar('ate')} />
        </div>
      </form>
      {semOpcoes && <p role="status" className="text-sm text-muted-foreground">Não foi possível carregar as opções dos filtros. A lista abaixo continua funcionando.</p>}
      {temFiltro && <Button variant="ghost" size="sm" onClick={() => setF({ entidade: '', acao: '', usuario: '', de: '', ate: '' })}>Limpar filtros</Button>}
      {erroFiltro && <p role="alert" className="text-sm text-destructive">{erroFiltro}</p>}

      {estado === 'carregando' && <ResourceState status="loading" title="Carregando registros…" />}
      {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar a auditoria" description="Confira a conexão e tente de novo." onRetry={carregar} />}
      {estado === 'pronto' && itens.length === 0 && !erroFiltro && (
        <ResourceState status="empty" title={temFiltro ? 'Nenhum registro com esses filtros' : 'Nenhum registro ainda'} description={temFiltro ? 'Tente ampliar o período ou limpar os filtros.' : 'As mudanças feitas no app aparecem aqui.'} />
      )}
      {estado === 'pronto' && itens.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <ul className="divide-y">
            {itens.map((i) => {
              const link = linkDaEntidade(i);
              const expandido = aberto === i.id;
              return (
                <li key={i.id}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left font-medium hover:underline"
                      aria-expanded={expandido}
                      aria-label={`${expandido ? 'Ocultar' : 'Ver'} detalhes: ${rotuloAcao(i.acao)} ${rotuloEntidade(i.entidade)}`}
                      onClick={() => setAberto(expandido ? null : i.id)}
                    >
                      {expandido ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                      {rotuloAcao(i.acao)} {rotuloEntidade(i.entidade).toLowerCase()}
                    </button>
                    <Badge variant="secondary">{rotuloEntidade(i.entidade)}</Badge>
                    <span className="text-sm text-muted-foreground">{quando(i.ts)} · {i.usuario}</span>
                    {link && <a href={link} className="text-sm text-brand-700 hover:underline">Abrir</a>}
                  </div>
                  {expandido && <Detalhe item={i} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {estado === 'pronto' && proximo && (
        <div className="space-y-2">
          <Button variant="outline" onClick={maisLinhas} disabled={carregandoMais}>{carregandoMais ? 'Carregando…' : 'Carregar mais'}</Button>
          {erroMais && <p role="alert" className="text-sm text-destructive">{erroMais}</p>}
        </div>
      )}
    </div>
  );
}
