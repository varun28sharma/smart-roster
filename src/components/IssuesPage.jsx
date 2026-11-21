import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { monthLabel } from '../engine/dates.js';
import IssueCard from './IssueCard.jsx';

const TYPE_LABELS = {
  GAP: 'Coverage gap',
  MULTI_BRAND: 'Multi-brand impact',
  NO_WEEKLY_OFF: 'Missing weekly off',
  UNSTAFFED: 'Unstaffed process',
  SHIFT_MISMATCH: 'Shift mismatch',
  COVER_INVALID: 'Invalid cover',
  COVER_SKILL: 'Cover without skill',
  OVERLOAD: 'Overloaded',
  LONG_STREAK: 'Long working streak',
  COMP_BALANCE: 'Comp-off balance',
  PREFERENCE: 'Preference not met',
  HOLIDAY_WORKED: 'Holiday worked',
};

export default function IssuesPage({ goto }) {
  const { validation, month, roster } = useStore();
  const [sev, setSev] = useState('error');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');

  const counts = useMemo(() => {
    const c = {};
    for (const i of validation.issues) c[i.type] = (c[i.type] || 0) + 1;
    return c;
  }, [validation]);

  const list = validation.issues.filter(
    (i) => (!sev || i.severity === sev) && (!type || i.type === type) && (!q || i.title.toLowerCase().includes(q.toLowerCase())),
  );

  const show = (i) => {
    if (i.serviceId && i.date) goto('roster', { kind: 'svcday', serviceId: i.serviceId, date: i.date }, 'brand');
    else if (i.employeeId && i.date) goto('roster', { kind: 'cell', employeeId: i.employeeId, date: i.date }, 'company');
    else goto('roster');
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h2>Conflicts · {monthLabel(month)}</h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Errors are mandatory constraints (client coverage, weekly offs, impossible assignments) and block publishing.
        Warnings are risky but allowed. Info items are preferences that coverage overrode, or facts worth knowing.
      </p>
      {!roster && <div className="banner info">No roster generated for this month yet. Only configuration problems are shown.</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        {[['error', validation.summary.errors], ['warning', validation.summary.warnings], ['info', validation.summary.infos], ['', validation.issues.length]].map(([s, n]) => (
          <button key={s || 'all'} className={`btn sm ${sev === s ? 'primary' : ''}`} onClick={() => setSev(s)}>
            {s ? s[0].toUpperCase() + s.slice(1) + 's' : 'All'} ({n})
          </button>
        ))}
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(counts).map(([t, n]) => <option key={t} value={t}>{TYPE_LABELS[t] || t} ({n})</option>)}
        </select>
        <input className="input grow" placeholder="Search by name, brand, date…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 && (
        <div className="card empty-state">
          {sev === 'error' ? 'No blocking conflicts. Every required process is covered and everyone has their weekly off.' : 'Nothing here.'}
        </div>
      )}
      {list.slice(0, 200).map((i) => (
        <IssueCard key={i.id} issue={i} onShow={() => show(i)} />
      ))}
      {list.length > 200 && <div className="muted small" style={{ marginTop: 8 }}>Showing first 200 of {list.length}.</div>}
    </div>
  );
}
