import { useState } from 'react';
import { getAuthHeaders } from '../hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { marked } from 'marked';
import {
  MessageSquare,
  Clock,
  Terminal,
  FileEdit,
  FilePlus,
  FileSearch,
  Trash2,
  File,
  FolderOpen,
  Wrench,
  AlertTriangle,
  Loader2,
  ListChecks,
  Play,
  ExternalLink,
  FileText,
  BookOpen,
  FileCode,
} from 'lucide-react';

marked.setOptions({
  breaks: true,
  gfm: true,
});

function renderMarkdown(text) {
  if (!text) return '';
  if (text.includes('<') && (text.includes('</') || text.includes('/>'))) return text;
  return marked.parse(text);
}

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
        {(item.html || item.content) ? (
          <div className='prose prose-sm dark:prose-invert max-w-none opacity-70' dangerouslySetInnerHTML={{ __html: renderMarkdown(item.content || item.html) }} />
        ) : (
          <span className='opacity-50'>No content</span>
        )}
      </div>
    </details>
  );
}

function MarkdownBlock({ item }) {
  return (
    <div
      className='prose prose-sm dark:prose-invert my-2 max-w-none text-sm leading-relaxed'
      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.html || item.text) }}
    />
  );
}

function CommandBlock({ item }) {
  const raw = item.code || '';
  const newlineIdx = raw.indexOf('\n');
  const promptLine = newlineIdx > 0 ? raw.substring(0, newlineIdx) : raw;
  const output = newlineIdx > 0 ? raw.substring(newlineIdx + 1).trim() : '';

  const dollarIdx = promptLine.indexOf('$ ');
  const path = dollarIdx > 0 ? promptLine.substring(0, dollarIdx + 1) : '';
  const cmd = dollarIdx > 0 ? promptLine.substring(dollarIdx + 2) : promptLine;

  return (
    <div className='my-1 overflow-hidden rounded-md border bg-card'>
      <div className='flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground'>
        <Terminal className='h-3.5 w-3.5' />
        <span>{item.label || 'Ran command'}</span>
      </div>
      <pre className='overflow-x-auto p-3 font-mono text-xs'>
        {path && <span className='text-muted-foreground'>{path} </span>}
        <code>{cmd}</code>
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

function FileActionBlock({ item, onFileOpen }) {
  const action = item.action || 'Modified';
  const actionLower = action.toLowerCase();

  const Icon = {
    created: FilePlus,
    edited: FileEdit,
    analyzed: FileSearch,
    searched: FileSearch,
    listed: FolderOpen,
    wrote: FileEdit,
    deleted: Trash2,
  }[actionLower] || File;

  const diffMatch = (item.diff || '').match(/\+(\d+)-(\d+)/);
  const ext = item.ext || '';
  const extColors = {
    JS: 'bg-yellow-500/20 text-yellow-400',
    JSX: 'bg-yellow-500/20 text-yellow-400',
    TS: 'bg-blue-500/20 text-blue-400',
    TSX: 'bg-blue-500/20 text-blue-400',
    MD: 'bg-zinc-500/20 text-zinc-400',
    JSON: 'bg-green-500/20 text-green-400',
    CSS: 'bg-purple-500/20 text-purple-400',
    PY: 'bg-sky-500/20 text-sky-400',
    MJS: 'bg-yellow-500/20 text-yellow-400',
  };

  const hasContent = !!item.content;

  const handleFileClick = (e) => {
    e.stopPropagation();
    if (item.fullPath && onFileOpen) onFileOpen(item.fullPath);
  };

  const row = (
    <div className='flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground min-w-0'>
      <Icon className='h-3.5 w-3.5 shrink-0' />
      <span className='font-medium shrink-0'>{action}</span>
      {ext && (
        <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold leading-none ${extColors[ext] || 'bg-zinc-500/20 text-zinc-400'}`}>
          {ext}
        </span>
      )}
      <span
        className={`font-mono truncate ${item.fullPath && onFileOpen ? 'text-foreground/80 hover:text-blue-400 hover:underline cursor-pointer' : 'text-foreground/80'}`}
        title={item.fullPath || item.file}
        onClick={item.fullPath && onFileOpen ? handleFileClick : undefined}
      >
        {item.file}
      </span>
      {item.lineRange && (
        <span className='shrink-0 text-muted-foreground/60'>{item.lineRange}</span>
      )}
      {diffMatch && (
        <div className='flex gap-1 shrink-0'>
          {parseInt(diffMatch[1]) > 0 && (
            <span className='text-green-500 font-medium'>+{diffMatch[1]}</span>
          )}
          {parseInt(diffMatch[2]) > 0 && (
            <span className='text-red-500 font-medium'>-{diffMatch[2]}</span>
          )}
        </div>
      )}
    </div>
  );

  if (hasContent) {
    return (
      <details className='my-0.5 rounded-md border bg-muted/20'>
        <summary className='cursor-pointer list-none'>
          {row}
        </summary>
        <div className='border-t px-3 py-2'>
          <div
            className='prose prose-sm dark:prose-invert max-w-none text-xs opacity-80'
            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.content) }}
          />
        </div>
      </details>
    );
  }

  return <div className='my-0.5'>{row}</div>;
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

function TaskBlock({ item, onFileOpen }) {
  const [open, setOpen] = useState(true);
  const steps = item.steps || [item.status].filter(Boolean);

  const extColors = {
    JS: 'text-yellow-400 bg-yellow-400/10',
    JSX: 'text-blue-400 bg-blue-400/10',
    TS: 'text-blue-500 bg-blue-500/10',
    TSX: 'text-blue-500 bg-blue-500/10',
    JSON: 'text-green-500 bg-green-500/10',
    HTML: 'text-orange-500 bg-orange-500/10',
    CSS: 'text-blue-300 bg-blue-300/10',
    MD: 'text-zinc-300 bg-zinc-300/10',
  };

  return (
    <div className='my-2 rounded-lg border border-border bg-card overflow-hidden'>
      <div className='p-4 flex flex-col gap-2'>
        <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground/80 mb-0.5'>
          <div className='flex items-center gap-1.5'><BookOpen className='h-3.5 w-3.5' /> <span>Created</span></div>
          <span className='text-border/60 text-[10px]'>▶</span>
          <div className='flex items-center gap-1.5'><ListChecks className='h-3.5 w-3.5' /> <span>Task</span></div>
        </div>
        <div className='font-bold text-[15px] text-foreground tracking-tight'>{item.title}</div>
        <div
          className='text-[13px] text-muted-foreground/90 leading-relaxed prose prose-sm dark:prose-invert max-w-none'
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.summary) }}
        />
      </div>

      {item.files && item.files.length > 0 && (
        <div className='px-4 py-3.5 border-t border-border/40'>
          <div className='text-[11px] font-semibold text-muted-foreground/70 mb-2 uppercase tracking-wide'>Files Edited</div>
          <div className='flex flex-wrap gap-4'>
            {item.files.map((f, i) => {
              const extClass = extColors[f.ext] || 'text-zinc-400 bg-zinc-400/10';
              return (
                <div
                  key={i}
                  className='flex items-center gap-1.5 cursor-pointer group hover:opacity-80 transition-opacity'
                  onClick={() => f.fullPath && onFileOpen?.(f.fullPath)}
                >
                  {f.ext ?
                    <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-sm leading-none ${extClass}`}>{f.ext}</span> :
                    <FileCode className='w-3 h-3 text-muted-foreground' />
                  }
                  <span className='text-[13px] font-mono font-medium text-foreground/80 group-hover:underline underline-offset-2'>{f.file}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {steps && steps.length > 0 && (
        <div className='px-4 py-3.5 border-t border-border/40'>
          <div
            className='flex items-center justify-between cursor-pointer group mb-2.5'
            onClick={() => setOpen(!open)}
          >
            <div className='text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide'>
              Progress Updates
            </div>
            <div className='text-[11px] font-medium text-muted-foreground group-hover:text-foreground transition-colors'>
              {open ? 'Collapse all ∨' : 'Expand all 〉'}
            </div>
          </div>

          {open && (
            <div className='flex flex-col gap-2.5'>
              {steps.map((step, idx) => (
                <div key={idx} className='flex gap-3 text-[13px] relative group items-start'>
                  <span className='shrink-0 text-[11px] font-mono text-muted-foreground/50 w-4 pt-[2px] pl-[2px] tabular-nums'>
                    {idx + 1}
                  </span>
                  <div className='text-[#e5e5e5] font-medium leading-[1.4]'>
                    {typeof step === 'string' ? step : step.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanReviewBlock({ item, workspaceId, onFileOpen }) {
  const [proceeding, setProceeding] = useState(false);

  const handleProceed = async () => {
    if (!workspaceId) return;
    setProceeding(true);
    try {
      await fetch(`/api/workspaces/${workspaceId}/cdp/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: 'Proceed' }),
      });
    } catch (err) {
      console.error(err);
    }
    setProceeding(false);
  };

  const handleOpen = () => {
    if (item.fullPath && onFileOpen) onFileOpen(item.fullPath);
  };

  return (
    <div className='my-2 rounded-lg border bg-card overflow-hidden'>
      <div className='px-4 py-3'>
        <div
          className='prose prose-sm dark:prose-invert max-w-none text-sm'
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
        />
      </div>
      {item.file && (
        <div className='flex items-center justify-between border-t px-4 py-2'>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <FileText className='h-3.5 w-3.5' />
            <span className='font-mono'>{item.file}</span>
          </div>
          <div className='flex gap-2'>
            {item.fullPath && (
              <button
                onClick={handleOpen}
                className='inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted transition-colors'
              >
                <ExternalLink className='h-3 w-3' />
                Open
              </button>
            )}
            {item.isBlocking && (
              <button
                onClick={handleProceed}
                disabled={proceeding}
                className='inline-flex items-center gap-1 rounded-md bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50'
              >
                {proceeding ? <Loader2 className='h-3 w-3 animate-spin' /> : <Play className='h-3 w-3' />}
                Proceed
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ConversationItem({ item, workspaceId, onFileOpen }) {
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
      return <FileActionBlock item={item} onFileOpen={onFileOpen} />;
    case 'task_block':
    case 'progress':
      return <TaskBlock item={item} onFileOpen={onFileOpen} />;
    case 'plan_review':
      return <PlanReviewBlock item={item} workspaceId={workspaceId} onFileOpen={onFileOpen} />;
    case 'error':
      return <ErrorBlock item={item} />;
    case 'tool':
      return <ToolBlock item={item} />;
    default:
      return null;
  }
}
