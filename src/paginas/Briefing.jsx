import { useCallback, useEffect, useState } from 'react';
import { Plus, CircleCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';

const dia = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const hojeBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const quando = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function NovaVersao({ aberto, aoFechar, contratoId, textoBase, aoSalvo }) {
  const [texto, setTexto] = useState('');
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setTexto(textoBase ?? '');
    setChave(crypto.randomUUID());
    setErro('');
  }, [aberto, textoBase]);

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      aoSalvo(await api.criarBriefing(contratoId, texto, chave));
      aoFechar();
    } catch (x) {
      setErro(x.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova versão do briefing</DialogTitle>
          <DialogDescription>
            A versão anterior não é alterada: esta vira a próxima da lista. Não escreva CPF, telefone, e-mail, senha ou dado de paciente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="bri-texto" className="text-sm font-medium">Briefing <span aria-hidden="true">*</span></label>
            <Textarea
              id="bri-texto"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={10}
              maxLength={20000}
              required
              aria-required="true"
              aria-invalid={erro ? 'true' : undefined}
              aria-describedby={erro ? 'bri-erro' : undefined}
            />
            {erro && <p id="bri-erro" role="alert" className="text-xs text-destructive">{erro}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar nova versão'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Confirmar({ versao, aoFechar, aoSalvo }) {
  const [data, setData] = useState(hojeBrasilia());
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (versao) { setData(hojeBrasilia()); setErro(''); } }, [versao]);

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      aoSalvo(await api.confirmarBriefing(versao.id, data));
      aoFechar();
    } catch (x) {
      setErro(x.message);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Dialog open={Boolean(versao)} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar o “é isso” da versão {versao?.versao}</DialogTitle>
          <DialogDescription>Informe o dia em que o cliente confirmou que o briefing está certo. Pode ser uma data passada, mas não futura.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="bri-data" className="text-sm font-medium">Data da confirmação</label>
            <Input id="bri-data" type="date" value={data} max={hojeBrasilia()} onChange={(e) => setData(e.target.value)} aria-invalid={erro ? 'true' : undefined} aria-describedby={erro ? 'bri-data-erro' : undefined} />
            {erro && <p id="bri-data-erro" role="alert" className="text-xs text-destructive">{erro}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Registrar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BriefingDoContrato({ contratoId, encerrado }) {
  const [estado, setEstado] = useState('carregando');
  const [itens, setItens] = useState([]);
  const [nova, setNova] = useState(false);
  const [confirmando, setConfirmando] = useState(null);
  const [aberta, setAberta] = useState(null);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setItens(await api.briefings(contratoId));
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [contratoId]);
  useEffect(() => { carregar(); }, [carregar]);

  const atual = itens[0];
  const ultimaConfirmada = itens.find((v) => v.confirmadoEm);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Briefing de entrada</CardTitle>
          <CardDescription>
            {estado !== 'pronto' || itens.length === 0
              ? 'Cada mudança vira uma nova versão.'
              : ultimaConfirmada
                ? `Último “é isso”: versão ${ultimaConfirmada.versao}, em ${dia(ultimaConfirmada.confirmadoEm)}.`
                : 'Nenhuma versão confirmada pelo cliente ainda.'}
          </CardDescription>
        </div>
        {!encerrado && <Button size="sm" onClick={() => setNova(true)}><Plus aria-hidden="true" />Nova versão</Button>}
      </CardHeader>
      <CardContent>
        {estado === 'carregando' && <ResourceState status="loading" title="Carregando briefing…" />}
        {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar o briefing" description="Confira a conexão e tente de novo." onRetry={carregar} />}
        {estado === 'pronto' && itens.length === 0 && <ResourceState status="empty" title="Nenhum briefing ainda" description={encerrado ? 'Contrato encerrado.' : 'Clique em “Nova versão” para escrever o primeiro.'} />}
        {estado === 'pronto' && itens.length > 0 && (
          <ul className="divide-y">
            {itens.map((v) => (
              <li key={v.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Versão {v.versao}</span>
                    <span className="text-sm text-muted-foreground">criada em {quando(v.criadoEm)}</span>
                    {v.confirmadoEm ? (
                      <Badge variant="secondary"><CircleCheck aria-hidden="true" className="mr-1 size-3" />“É isso” em {dia(v.confirmadoEm)}</Badge>
                    ) : (
                      <Badge variant="secondary">Sem confirmação</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" aria-expanded={aberta === v.id} onClick={() => setAberta(aberta === v.id ? null : v.id)}>
                      {aberta === v.id ? 'Ocultar texto' : 'Ver texto'}
                    </Button>
                    {!encerrado && !v.confirmadoEm && <Button variant="outline" size="sm" onClick={() => setConfirmando(v)}>Registrar “é isso”</Button>}
                  </div>
                </div>
                {aberta === v.id && <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{v.conteudo}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <NovaVersao aberto={nova} aoFechar={() => setNova(false)} contratoId={contratoId} textoBase={atual?.conteudo} aoSalvo={() => carregar()} />
      <Confirmar versao={confirmando} aoFechar={() => setConfirmando(null)} aoSalvo={() => carregar()} />
    </Card>
  );
}
