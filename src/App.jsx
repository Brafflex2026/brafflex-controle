import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { ResourceState } from '@/components/resource-state';

export default function App() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('ready');
  const [message, setMessage] = useState('');
  function addItem(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title')).trim();
    if (!title) {
      event.currentTarget.elements.title.setCustomValidity('Informe um nome com texto.');
      event.currentTarget.elements.title.reportValidity();
      return;
    }
    setItems(current => [...current, { id: crypto.randomUUID(), title, description: String(data.get('description')).trim() }]);
    setState('ready'); setOpen(false); setMessage('Exemplo adicionado somente nesta sessão.');
  }
  return <div className="min-h-screen">
    <header className="border-b bg-card"><div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5"><span className="font-semibold tracking-tight">Base SaaS</span><Badge variant="secondary">Demonstração local</Badge></div></header>
    <main className="mx-auto max-w-5xl space-y-7 px-5 py-8 sm:py-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="space-y-2"><h1 className="text-3xl font-semibold tracking-tight">Seu próximo produto</h1><p className="max-w-xl text-sm leading-6 text-muted-foreground">Uma base neutra de componentes. Adapte a identidade e conecte as funcionalidades ao backend do projeto.</p></div>
        <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus aria-hidden="true" />Adicionar exemplo</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>Adicionar exemplo</DialogTitle><DialogDescription>Este formulário demonstra os componentes. O conteúdo desaparece ao recarregar a página.</DialogDescription></DialogHeader>
            <form onSubmit={addItem} className="space-y-5"><div className="space-y-2"><label htmlFor="title" className="text-sm font-medium">Nome</label><Input id="title" name="title" onChange={event => event.target.setCustomValidity('')} required maxLength={100} placeholder="Exemplo de item" /></div>
              <div className="space-y-2"><label htmlFor="description" className="text-sm font-medium">Descrição</label><Textarea id="description" name="description" maxLength={500} placeholder="Descrição opcional" /></div>
              <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose><Button type="submit">Adicionar à sessão</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card><CardHeader><CardTitle>Exemplos da sessão</CardTitle><CardDescription>Sem banco conectado. Nenhum dado desta demonstração é persistido.</CardDescription></CardHeader><CardContent className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><label htmlFor="preview-state" className="text-sm font-medium">Prévia dos estados de interface</label><NativeSelect id="preview-state" value={state} onChange={e => setState(e.target.value)}><NativeSelectOption value="ready">Conteúdo da sessão</NativeSelectOption><NativeSelectOption value="loading">Simular carregamento</NativeSelectOption><NativeSelectOption value="empty">Simular lista vazia</NativeSelectOption><NativeSelectOption value="error">Simular erro</NativeSelectOption></NativeSelect></div>
        {state === 'loading' ? <ResourceState status="loading" title="Carregando — simulação" description="Escolha outro estado acima para encerrar esta prévia." /> : state === 'error' ? <ResourceState status="error" title="Falha de exemplo" description="Nenhuma requisição falhou: este é um estado demonstrativo." onRetry={() => setState('ready')} /> : state === 'empty' || !items.length ? <ResourceState status="empty" title="Nenhum exemplo" description="Adicione um item para visualizar a tabela e experimentar o formulário." /> : <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id}><TableCell className="max-w-56 whitespace-normal break-words font-medium">{item.title}</TableCell><TableCell className="max-w-80 whitespace-normal break-words text-muted-foreground">{item.description || '—'}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" aria-label={`Remover ${item.title}`} onClick={() => {setItems(current => current.filter(other => other.id !== item.id)); setMessage('Exemplo removido da sessão.');}}>Remover</Button></TableCell></TableRow>)}</TableBody></Table>}
        <p role="status" className="min-h-5 text-sm text-muted-foreground">{message}</p>
      </CardContent></Card>
    </main>
  </div>;
}
