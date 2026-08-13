import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  KeyRound,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { ApiError, isAuthenticationError } from "../api/client";
import { sentenceCase } from "../lib/format";

export function Button({
  className = "",
  variant = "primary",
  size = "medium",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "small" | "medium";
  loading?: boolean;
}) {
  return (
    <button
      className={`button button--${variant} button--${size} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <LoaderCircle className="spin" size={16} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "danger" | "info" | "neutral" | "accent";
  className?: string;
}) {
  return (
    <span className={`badge badge--${tone} ${className}`}>{children}</span>
  );
}

export function statusTone(
  status?: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status?.toLowerCase()) {
    case "healthy":
    case "configured":
    case "closed":
    case "completed":
    case "sent":
    case "active":
    case "offer":
      return "success";
    case "degraded":
    case "partial":
    case "half-open":
    case "pending":
    case "running":
    case "reviewed":
    case "interview":
      return "warning";
    case "unhealthy":
    case "unavailable":
    case "failed":
    case "open":
    case "rejected":
      return "danger";
    case "new":
    case "applied":
      return "info";
    default:
      return "neutral";
  }
}

export function StatusBadge({
  status,
  label,
}: {
  status?: string;
  label?: string;
}) {
  const resolved = status || "unknown";
  return (
    <Badge tone={statusTone(resolved)}>
      <span className="badge__dot" aria-hidden="true" />
      {label ?? sentenceCase(resolved)}
    </Badge>
  );
}

export function Panel({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section className={`panel ${className}`} {...props}>
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? (
          <p className="page-header__description">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel__header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__top">
        <span>{label}</span>
        {icon ? <span className="metric-card__icon">{icon}</span> : null}
      </div>
      <strong>{value}</strong>
      {detail ? <div className="metric-card__detail">{detail}</div> : null}
    </article>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Inbox size={22} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  title = "Couldn’t load this data",
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  const auth = isAuthenticationError(error);
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <h3>{auth ? "API key required" : title}</h3>
        <p>{message}</p>
        <div className="inline-actions">
          {auth ? (
            <Link
              className="button button--secondary button--small"
              to="/settings"
            >
              Open settings
            </Link>
          ) : null}
          {onRetry ? (
            <Button variant="secondary" size="small" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function InlineNotice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "success" | "danger";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`notice notice--${tone}`}
      role={tone === "danger" ? "alert" : undefined}
    >
      {tone === "success" ? (
        <Check size={18} aria-hidden="true" />
      ) : (
        <AlertTriangle size={18} aria-hidden="true" />
      )}
      <div>
        {title ? <strong>{title}</strong> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row ${disabled ? "toggle-row--disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="toggle" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

export function TagInput({
  label,
  values,
  onChange,
  placeholder = "Type and press Enter",
  hint,
}: {
  label: string;
  values: string[];
  onChange(values: string[]): void;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const add = () => {
    const next = value.trim();
    if (!next) return;
    if (!values.some((item) => item.toLowerCase() === next.toLowerCase()))
      onChange([...values, next]);
    setValue("");
  };
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div
        className="tag-input"
        onClick={(event) =>
          (
            event.currentTarget.querySelector("input") as HTMLInputElement
          )?.focus()
        }
      >
        {values.map((item) => (
          <span className="tag" key={item}>
            {item}
            <button
              type="button"
              onClick={() =>
                onChange(values.filter((candidate) => candidate !== item))
              }
              aria-label={`Remove ${item}`}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={value}
          placeholder={values.length ? "Add another…" : placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (["Enter", ","].includes(event.key)) {
              event.preventDefault();
              add();
            } else if (event.key === "Backspace" && !value && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={add}
        />
      </div>
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function Tabs({
  value,
  onChange,
  tabs,
  label = "Sections",
}: {
  value: string;
  onChange(value: string): void;
  tabs: Array<{ value: string; label: string; count?: number }>;
  label?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={tab.value === value ? "is-active" : ""}
          onClick={() => onChange(tab.value)}
          key={tab.value}
        >
          {tab.label}
          {tab.count !== undefined ? <span>{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  width = "medium",
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
  width?: "medium" | "wide";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={`modal modal--${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header>
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange(offset: number): void;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(total, offset + limit);
  return (
    <div className="pagination">
      <span>
        {start}–{end} of {total}
      </span>
      <div>
        <IconButton
          label="Previous page"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={17} />
        </IconButton>
        <IconButton
          label="Next page"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          <ChevronRight size={17} />
        </IconButton>
      </div>
    </div>
  );
}

export function MissingKeyBanner() {
  return (
    <div className="key-banner">
      <KeyRound size={17} aria-hidden="true" />
      <span>
        Add your admin API key to manage watches and notification settings.
      </span>
      <Link to="/settings">Add key</Link>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert">
      {error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)}
    </p>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
