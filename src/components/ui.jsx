import { useEffect } from 'react';
import { DOW } from '../engine/dates.js';
import { STATUS_META } from '../engine/model.js';

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(860px, 100%)' } : undefined} role="dialog" aria-label={title}>
        <header>
          <h3 className="grow">{title}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function DowPicker({ value = [], onChange }) {
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className="dow-pick">
      {DOW.map((n, d) => (
        <button type="button" key={n} className={value.includes(d) ? 'on' : ''} onClick={() => toggle(d)}>
          {n.slice(0, 2)}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, style }) {
  return (
    <label className="field" style={style}>
      {label}
      {children}
    </label>
  );
}

export function Sev({ s }) {
  return <span className={`badge ${s}`}>{s}</span>;
}

export function Swatch({ status }) {
  return (
    <span className={`cell ${status} sw`} style={{ display: 'inline-grid', width: 18, height: 18, borderRadius: 4, fontSize: 10, cursor: 'default', marginRight: 4, verticalAlign: 'middle', placeItems: 'center' }}>
      {STATUS_META[status]?.code}
    </span>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><span className="lg-box" />Working (blank)</span>
      <span><span className="lg-box covering">TS</span>Covering another brand (initials)</span>
      {Object.keys(STATUS_META).filter((s) => s !== 'WORK').map((s) => (
        <span key={s}>
          <Swatch status={s} />
          {STATUS_META[s].label}
        </span>
      ))}
      <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ink)', marginRight: 4 }} />manual edit (kept on regenerate)</span>
      <span><span style={{ display: 'inline-block', width: 12, height: 12, boxShadow: 'inset 0 0 0 2px var(--err)', marginRight: 4, verticalAlign: 'middle' }} />involved in an error</span>
    </div>
  );
}

export function impactText(impact) {
  if (!impact) return '';
  const parts = [];
  if (impact.errors < 0) parts.push(`fixes ${-impact.errors} error${impact.errors < -1 ? 's' : ''}`);
  if (impact.errors > 0) parts.push(`adds ${impact.errors} error${impact.errors > 1 ? 's' : ''}`);
  if (impact.warnings > 0) parts.push(`+${impact.warnings} warning${impact.warnings > 1 ? 's' : ''}`);
  if (impact.warnings < 0) parts.push(`${impact.warnings} warning${impact.warnings < -1 ? 's' : ''}`);
  if (!parts.length) parts.push('no change in errors');
  return parts.join(', ');
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
