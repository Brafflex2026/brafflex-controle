import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/api';

const FONTES = {
  ravclin: 'Ravclin (banco "Leads Ravclin" do Notion, exportado em CSV)',
  etiqueteria: 'Etiqueteria (planilha de leads, baixada em CSV)',
};

export function ImportarLeads({ aberto, aoFechar, aoImportado }) {
  const [fonte, setFonte] = useState('ravclin');
  const [arquivo, setArquivo] = useState('');
  const [nome, setNome] = useState('');
  const [previa, setPrevia] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setFonte('ravclin'); setArquivo(''); setNome(''); setPrevia(null); setResultado(null); setErro('');
  }, [aberto]);

  async function escolher(e) {
    const f = e.target.files?.[0];
    setPrevia(null);
    setErro('');
    setArquivo('');
    setNome('');
    if (!f) return;
    if (f.size > 300_000) return setErro('Arquivo grande demais (até 300 KB, 500 linhas).');
    setNome(f.name);
    setArquivo(await f.text());
  }
  async function ver() {
    setOcupado(true);
    setErro('');
    try { setPrevia(await api.previaLeads({ fonte, arquivo })); } catch (x) { setPrevia(null); setErro(x.message); } finally { setOcupado(false); }
  }
  async function importar() {
    setOcupado(true);
    setErro('');
    try {
      setResultado(await api.importarLeads({ fonte, arquivo }, { importaveis: previa.importaveis, optOuts: previa.optOuts }));
      setPrevia(null);
      aoImportado(fonte);
    } catch (x) { setErro(x.message); } finally { setOcupado(false); }
  }

  const nada = previa && previa.importaveis === 0 && previa.optOuts === 0;
  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar leads</DialogTitle>
          <DialogDescription>Escolha a origem e o arquivo CSV. Primeiro você vê a prévia; só grava quando clicar em importar. Pode enviar o mesmo arquivo de novo: o que já existe é pulado.</DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">Importação concluída.</p>
            <ul className="list-disc pl-5">
              <li>{resultado.importados} leads criados</li>
              <li>{resultado.duplicados} já existiam (pulados)</li>
              <li>{resultado.optOuts} pedidos de saída guardados só como código de verificação</li>
              <li>{resultado.recusadas} linhas recusadas</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-1.5">
              <label htmlFor="imp-fonte" className="text-sm font-medium">Origem do arquivo</label>
              <NativeSelect id="imp-fonte" value={fonte} onChange={(e) => { setFonte(e.target.value); setPrevia(null); setErro(''); }}>
                {Object.entries(FONTES).map(([k, v]) => <NativeSelectOption key={k} value={k}>{v}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="imp-arquivo" className="text-sm font-medium">Arquivo CSV</label>
              <Input id="imp-arquivo" type="file" accept=".csv,text/csv" onChange={escolher} />
              {nome && <p className="text-xs text-muted-foreground">{nome}</p>}
            </div>
            <Button type="button" variant="outline" onClick={ver} disabled={!arquivo || ocupado}>{ocupado && !previa ? 'Conferindo…' : 'Ver a prévia'}</Button>

            {previa && (
              <div className="space-y-3 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge>{previa.importaveis} para importar</Badge>
                  <Badge variant="secondary">{previa.duplicados} já existem</Badge>
                  <Badge variant="secondary">{previa.optOuts} pedidos de saída</Badge>
                  <Badge variant={previa.recusadas.length ? 'destructive' : 'secondary'}>{previa.recusadas.length} recusadas</Badge>
                </div>
                <p className="text-muted-foreground">{previa.totalLinhas} linhas lidas. {Object.entries(previa.porEstagio).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                {previa.amostra.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Primeiros leads</p>
                    <ul className="list-disc pl-5">{previa.amostra.map((a) => <li key={a.linha}>{a.empresa} · {a.estagio} · {a.origem}</li>)}</ul>
                  </div>
                )}
                {previa.recusadas.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Linhas recusadas (as outras entram normalmente)</p>
                    <ul className="list-disc pl-5">{previa.recusadas.map((a) => <li key={`${a.linha}-${a.motivo}`}>Linha {a.linha} · {a.empresa}: {a.motivo}</li>)}</ul>
                  </div>
                )}
                {previa.avisos.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Avisos (a linha entra, mas algo foi ignorado)</p>
                    <ul className="list-disc pl-5">{previa.avisos.map((a, i) => <li key={`${a.linha}-${i}`}>Linha {a.linha} · {a.empresa}: {a.aviso}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">{resultado ? 'Fechar' : 'Cancelar'}</Button></DialogClose>
          {!resultado && <Button type="button" onClick={importar} disabled={!previa || nada || ocupado}>{ocupado && previa ? 'Importando…' : previa ? `Importar ${previa.importaveis} leads` : 'Importar'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
