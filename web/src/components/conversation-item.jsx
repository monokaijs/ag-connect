import { Badge } from '@/components/ui/badge';
import {
  MessageSquare,
  Clock,
  Terminal,
  FileEdit,
  FilePlus,
  FileSearch,
  Trash2,
  File,
  Wrench,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

function UserMessage({ item }) {
  return (
    <div className={`my-2 rounded-lg border border-primary/20 p-3 ${item.isOptimistic ? 'bg-primary/5 opacity-60' : 'bg-primary/5'}`}>
      <div className='mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary/70'>
        You
        {item.isOptimistic && <Loader2 className='h-3 w-3 animate-spin' />}
      </div>
      <div className='whitespace-pre-wrap text-sm'>{item.text}</div>
    </div>
  );
}

function ThinkingBlock({ item }) {
  return (
    <details className='my-1 rounded-md border bg-muted/30'>
      <summary className='cursor-pointer px-3 py-2 text-xs text-muted-foreground list-none'>
        <span className='inline-flex items-center gap-2'>
          <Clock className='h-3.5 w-3.5' />
          <span>{item.text}</span>
        </span>
      </summary>
      <div className='border-t px-3 py-2 text-xs text-muted-foreground'>
        {item.html ? (
          <div className='prose prose-sm dark:prose-invert max-w-none opacity-70' dangerouslySetInnerHTML={{ __html: item.html }} />
        ) : (
          <span className='opacity-50'>{item.content || 'No content'}</span>
        )}
      </div>
    </details>
  );
}

function MarkdownBlock({ item }) {
  return (
    <div
      className='prose prose-sm dark:prose-invert my-2 max-w-none text-sm leading-relaxed'
      dangerouslySetInnerHTML={{ __html: item.html || item.text }}
    />
  );
}

function CommandBlock({ item }) {
  let cmdText = item.code || '';
  const dollarIdx = cmdText.indexOf('$ ');
  if (dollarIdx !== -1) cmdText = cmdText.substring(dollarIdx + 2);
  const newlineIdx = cmdText.indexOf('\n');
  const cmdLine = newlineIdx > 0 ? cmdText.substring(0, newlineIdx) : cmdText;
  const output = newlineIdx > 0 ? cmdText.substring(newlineIdx + 1).trim() : '';

  return (
    <div className='my-1 overflow-hidden rounded-md border bg-card'>
      <div className='flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground'>
        <Terminal className='h-3.5 w-3.5' />
        <span>{item.label || 'Ran command'}</span>
      </div>
      <pre className='overflow-x-auto p-3 font-mono text-xs'>
        <code>{cmdLine}</code>
        {output && (
          <span className='mt-1 block text-muted-foreground'>
            {output.substring(0, 500)}
            {output.length > 500 ? '\n...' : ''}
          </span>
        )}
      </pre>
    </div>
  );
}

function FileActionBlock({ item }) {
  const action = item.action || 'Modified';
  const actionLower = action.toLowerCase();

  const Icon = {
    created: FilePlus,
    edited: FileEdit,
    analyzed: FileSearch,
    searched: FileSearch,
    deleted: Trash2,
  }[actionLower] || File;

  const diffMatch = (item.diff || '').match(/\+(\d+)-(\d+)/);

  return (
    <div className='my-0.5 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground'>
      <Icon className='h-3.5 w-3.5 shrink-0' />
      <span className='font-medium'>{action}</span>
      <span className='font-mono text-foreground/80'>{item.file}</span>
      {diffMatch && (
        <div className='flex gap-1'>
          {parseInt(diffMatch[1]) > 0 && (
            <Badge variant='outline' className='h-4 px-1 text-[10px] text-green-500'>
              +{diffMatch[1]}
            </Badge>
          )}
          {parseInt(diffMatch[2]) > 0 && (
            <Badge variant='outline' className='h-4 px-1 text-[10px] text-red-500'>
              -{diffMatch[2]}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function ToolBlock({ item }) {
  return (
    <div className='my-0.5 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground'>
      <Wrench className='h-3.5 w-3.5 shrink-0' />
      <span className='truncate'>{item.text}</span>
    </div>
  );
}

function ErrorBlock({ item }) {
  return (
    <div className='my-1 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
      <AlertTriangle className='h-3.5 w-3.5 shrink-0' />
      <span>{item.text}</span>
    </div>
  );
}

export function ConversationItem({ item }) {
  switch (item.type) {
    case 'user':
      return <UserMessage item={item} />;
    case 'thinking':
      return <ThinkingBlock item={item} />;
    case 'markdown':
      return <MarkdownBlock item={item} />;
    case 'command':
      return <CommandBlock item={item} />;
    case 'file_action':
      return <FileActionBlock item={item} />;
    case 'error':
      return <ErrorBlock item={item} />;
    case 'tool':
      return <ToolBlock item={item} />;
    default:
      return null;
  }
}
