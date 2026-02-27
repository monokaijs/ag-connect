import { useState } from 'react';

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, variant }) {
  if (!open) return null;

  const variantStyles = {
    danger: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20',
    warning: 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20',
    default: 'bg-white/10 text-white hover:bg-white/15 border-white/10',
  };

  const btnStyle = variantStyles[variant] || variantStyles.default;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-5 w-80 max-w-[90vw]">
        <h3 className="text-sm font-semibold text-white mb-1.5">{title}</h3>
        <p className="text-xs text-zinc-400 leading-relaxed mb-4">{description}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-7 px-3 text-[11px] font-medium rounded-md text-zinc-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className={`h-7 px-3 text-[11px] font-medium rounded-md border transition-colors ${btnStyle}`}
          >
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState({ open: false, title: '', description: '', confirmLabel: '', variant: 'default', onConfirm: () => { } });

  const confirm = ({ title, description, confirmLabel, variant }) => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title,
        description,
        confirmLabel,
        variant,
        onConfirm: () => resolve(true),
      });
    });
  };

  const dialog = (
    <ConfirmDialog
      open={state.open}
      onClose={() => setState(s => ({ ...s, open: false }))}
      onConfirm={state.onConfirm}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      variant={state.variant}
    />
  );

  return { confirm, dialog };
}
