import { LoaderCircle, CircleAlert, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ResourceState({ status, title, description, onRetry }) {
  if (status === 'ready') return null;
  const Icon = status === 'loading' ? LoaderCircle : status === 'error' ? CircleAlert : Inbox;
  return <div role={status === 'error' ? 'alert' : 'status'} aria-live="polite" className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
    <Icon aria-hidden="true" className={`size-6 text-muted-foreground ${status === 'loading' ? 'motion-safe:animate-spin' : ''}`} />
    <p className="font-medium">{title}</p>
    {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
    {status === 'error' && onRetry && <Button variant="outline" onClick={onRetry}>Tentar novamente</Button>}
  </div>;
}
