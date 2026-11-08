import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, CircleHelp, CircleX, Loader2, X } from 'lucide-react';
import { cx } from '../util.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,transform] duration-150 ease-(--ease-brand) active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8' : 'h-9',
        children ? (size === 'sm' ? 'px-3' : 'px-4') : size === 'sm' ? 'w-8' : 'w-9',
        variant === 'primary' && 'bg-accent-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-[#b65c34]',
        variant === 'secondary' && 'border border-line-2 bg-panel-3 text-text hover:bg-[#2a3240]',
        variant === 'ghost' && 'text-muted hover:bg-panel-3 hover:text-text',
        variant === 'danger' && 'border border-del/30 text-del hover:bg-del/10',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('rounded-xl border border-line bg-panel', className)}>
      {children}
    </div>
  );
}

/** Leises Label – Farbe nur, wenn sie etwas bedeutet. */
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'add' | 'del' | 'mod' | 'info' | 'accent'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md bg-panel-3 px-1.5 py-0.5 text-xs leading-4',
        tone === 'neutral' && 'text-muted',
        tone === 'add' && 'text-add',
        tone === 'del' && 'text-del',
        tone === 'mod' && 'text-mod',
        tone === 'info' && 'text-info',
        tone === 'accent' && 'text-accent-hi',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Status als Punkt + Text, ohne Pille. */
export function Status({ tone, children }: { tone: 'add' | 'del' | 'neutral'; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-[13px] font-normal', tone === 'del' ? 'text-del' : tone === 'add' ? 'text-text' : 'text-muted')}>
      <span className={cx('size-1.5 rounded-full', tone === 'add' ? 'bg-add' : tone === 'del' ? 'bg-del' : 'bg-dim')} />
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-dim', className ?? 'size-5')} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-del/25 bg-del/8 px-3 py-2 text-sm text-del">
      <CircleX className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 text-dim">{icon}</div>
      <h3 className="text-base font-medium">{title}</h3>
      {children && <p className="mt-2 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-24" onMouseDown={onClose}>
      <div className={cx('w-full animate-enter rounded-2xl border border-line-2 bg-panel shadow-[0_16px_48px_rgb(0_0_0/0.4)]', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-medium">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-dim transition-colors hover:bg-panel-3 hover:text-text" aria-label="Schließen">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, info, children }: { label: string; hint?: ReactNode; info?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1.5 text-[13px] text-muted">
        {label}
        {info && <InfoTip label={label}>{info}</InfoTip>}
      </span>
      {children}
      {hint && <span className="mt-2 block text-xs leading-5 text-dim">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full h-9 rounded-lg border border-line-2 bg-sidebar px-3 text-sm text-text placeholder:text-dim outline-none transition-colors focus:border-accent';

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="flex gap-6 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px flex items-center gap-2 border-b-2 pt-1 pb-3 text-sm transition-colors',
            value === t.value ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line-2 bg-sidebar p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 rounded-md px-3 text-[13px] transition-colors',
            value === o.value ? 'bg-panel-3 text-text shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Sync-Zustand einer Instanz. Pulsiert nur, solange wirklich gesichert wird. */
export function StatusDot({ ok, syncing, className }: { ok: boolean | null; syncing?: boolean; className?: string }) {
  return (
    <span
      title={syncing ? 'Sichert gerade' : ok === null ? 'Noch nicht gesichert' : ok ? 'Verbunden' : 'Fehler beim letzten Sync'}
      className={cx('inline-block size-1.5 shrink-0 rounded-full', syncing ? 'animate-pulse bg-info' : ok === null ? 'bg-dim' : ok ? 'bg-add' : 'bg-del', className)}
    />
  );
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-xs text-dim', className)}>{children}</span>;
}

// ───────────── Toasts ─────────────

type Toast = { id: number; tone: 'ok' | 'error'; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-enter items-start gap-3 rounded-xl border border-line-2 bg-panel-3 px-4 py-3 text-sm shadow-[0_8px_24px_rgb(0_0_0/0.35)]">
            {t.tone === 'ok' ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-add" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-del" />}
            <span className="break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-[13px] text-muted">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-medium [font-stretch:92%]">{title}</h1>
        {subtitle && <div className="mt-2 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, info }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; info?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors', checked ? 'border-accent bg-accent-strong' : 'border-line-2 bg-panel-3')}
      >
        <span className={cx('absolute top-0.5 left-0.5 size-3.5 rounded-full bg-text transition-transform duration-150 ease-(--ease-brand)', checked && 'translate-x-4')} />
      </button>
      <span>
        <span className="flex items-center gap-1.5 text-sm">
          {label}
          {info && <InfoTip label={label}>{info}</InfoTip>}
        </span>
        {hint && <span className="mt-0.5 block text-xs text-dim">{hint}</span>}
      </span>
    </label>
  );
}

// ───────────── Inline-Erklärung ─────────────

/**
 * Kleines Fragezeichen mit Erklärung. Öffnet bei Hover und Tastaturfokus, ein Klick hält es offen
 * (auch auf Touch-Geräten). Escape oder ein Klick daneben schließt. Wird in document.body gerendert,
 * damit es nicht in scrollenden Karten abgeschnitten wird.
 */
export function InfoTip({ children, label = 'Erklärung', className }: { children: ReactNode; label?: string; className?: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  const open = hover || pinned;

  const enter = () => {
    clearTimeout(closeTimer.current);
    setHover(true);
  };
  // Kurze Verzögerung, damit man mit der Maus in die Erklärung wechseln kann (z. B. für Links)
  const leave = () => {
    closeTimer.current = setTimeout(() => setHover(false), 120);
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(300, window.innerWidth - 32);
      const h = tip.current?.offsetHeight ?? 0;
      const left = Math.max(16, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - 16 - width));
      const fitsBelow = r.bottom + 8 + h <= window.innerHeight - 8;
      setPos({ top: fitsBelow || r.top - 8 - h < 8 ? r.bottom + 8 : r.top - 8 - h, left, width });
    };
    place();
    // zweiter Durchgang, sobald die Höhe der Erklärung bekannt ist
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        setHover(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !tip.current?.contains(t)) {
        setPinned(false);
        setHover(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`Erklärung: ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={() => !pinned && setHover(false)}
        onClick={(e) => {
          // steht oft in Labels, Links oder klickbaren Zeilen – die sollen nicht mit auslösen
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        className={cx('inline-flex shrink-0 rounded-full align-middle text-dim transition-colors hover:text-text', open && 'text-text', className)}
      >
        <CircleHelp className="size-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            onMouseEnter={enter}
            onMouseLeave={leave}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: pos?.width ?? 300, visibility: pos ? 'visible' : 'hidden' }}
            className="fixed z-[70] animate-enter space-y-1.5 rounded-lg border border-line-2 bg-panel-3 px-3.5 py-3 text-left text-xs leading-5 font-normal text-muted shadow-[0_8px_24px_rgb(0_0_0/0.4)] [&_b]:font-medium [&_b]:text-text"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
