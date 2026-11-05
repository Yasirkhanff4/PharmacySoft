import { Search } from "lucide-react";

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

export function StatTile({ icon: Icon, label, value, hint, tone = "blue", onClick }) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      className={`stat-tile tone-${tone} ${onClick ? "stat-tile-clickable" : ""}`.trim()}
      onClick={onClick}
      type={onClick ? "button" : undefined}
    >
      <div className="stat-tile-top">
        <div className="stat-tile-icon">{Icon ? <Icon size={20} /> : null}</div>
      </div>
      <span className="stat-tile-label">{label}</span>
      <strong className="stat-tile-value">{value}</strong>
      {hint && <small className="stat-tile-hint">{hint}</small>}
    </Tag>
  );
}

export function Badge({ tone = "neutral", children, dot = false }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-state-icon">
          <Icon size={28} />
        </div>
      )}
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }) {
  return (
    <div className="loading-block">
      <span className="spinner" />
      <p>{label}</p>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", ...rest }) {
  return (
    <div className="search-control">
      <Search size={16} />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  return (
    <div className="pagination">
      <div className="pagination-summary">
        {total === 0 ? "No records" : `${start}–${end} of ${total}`}
      </div>

      <div className="pagination-controls">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Previous
        </button>

        <span className="pagination-page">
          Page {safePage} of {totalPages}
        </span>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Field({ label, hint, error, required, children, className = "" }) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">
        {label}
        {required && <em>*</em>}
      </span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}
