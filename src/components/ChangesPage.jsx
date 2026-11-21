import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { dayLabel, monthDays } from '../engine/dates.js';
import { STATUS_META } from '../engine/model.js';
import { diffSincePublish, leaveImpact } from '../engine/changes.js';
import { emptyRoster } from '../engine/rosterState.js';
import { Field, Swatch } from './ui.jsx';

export default function ChangesPage({ goto }) {
  const store = useStore();
  const { data, roster, month } = store;
  const emps = [...data.employees].filter((e) => e.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const empName = (id) => data.employees.find((e) => e.id === id)?.name ?? id;
  const [form, setForm] = useState({ employeeId: emps[0]?.id, start: monthDays(month)[14], end: '', type: 'LEAVE', status: 'pending', note: '' });

  const pending = data.leaves.filter((l) => l.status === 'pending');
  const approved = data.leaves.filter((l) => l.status === 'approved').sort((a, b) => b.start.localeCompare(a.start));
  const r = roster || emptyRoster(month);

  const impacts = useMemo(
    () => Object.fromEntries(pending.map((l) => [l.id, leaveImpact(data, r, l)])),
    [data, r], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const changes = useMemo(() => (roster?.published ? diffSincePublish(data, roster) : []), [data, roster]);

  const submit = (e) => {
    e.preventDefault();
    if (!form.employeeId || !form.start) return;
    store.upsert('leaves', { ...form, end: form.end || form.start }, 'L');
    setForm({ ...form, note: '' });
  };

  return (
    <div className="col" style={{ gap: 16, maxWidth: 1100 }}>
      <div>
        <h2>Leaves & changes</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Approved leave updates the roster immediately and re-runs validation. Gaps it creates show up as conflicts
          with suggested covers. Pending requests are previewed first, so you can see the impact before approving.
        </p>
      </div>

      <form className="card card-pad" onSubmit={submit}>
        <h3 style={{ marginBottom: 10 }}>Record leave, comp-off or unavailability</h3>
        <div className="form-grid">
          <Field label="Employee">
            <select className="input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /></Field>
          <Field label="To (optional)"><input type="date" className="input" value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
          <Field label="Type">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="LEAVE">Leave</option>
              <option value="COMP">Comp-off</option>
              <option value="UNAV">Unavailable</option>
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="pending">Pending (preview impact first)</option>
              <option value="approved">Approved (apply now)</option>
            </select>
          </Field>
          <Field label="Note"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Reason" /></Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit">Add</button>
        </div>
      </form>

      <div className="card card-pad">
        <h3 style={{ marginBottom: 10 }}>Pending requests ({pending.length})</h3>
        {pending.length === 0 && <div className="muted small">No pending requests.</div>}
        {pending.map((l) => {
          const imp = impacts[l.id];
          const bad = imp?.newIssues.filter((i) => i.severity === 'error') || [];
          return (
            <div key={l.id} className={`issue ${bad.length ? 'error' : 'info'}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="t"><Swatch status={l.type} />{empName(l.employeeId)} · {dayLabel(l.start)}{l.end && l.end !== l.start ? ` → ${dayLabel(l.end)}` : ''}</div>
                  <div className="d">{l.note}</div>
                </div>
                <div className="row">
                  <button className="btn sm primary" onClick={() => store.upsert('leaves', { ...l, status: 'approved' })}>Approve</button>
                  <button className="btn sm danger" onClick={() => store.remove('leaves', l.id)}>Reject</button>
                </div>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {!roster ? (
                  <span className="muted">Generate the roster for this month to preview impact.</span>
                ) : bad.length === 0 ? (
                  <span style={{ color: 'var(--ok)' }}>Safe to approve: remaining staff keep every required process covered.</span>
                ) : (
                  <>
                    <b style={{ color: 'var(--err)' }}>Approving creates {bad.length} error{bad.length > 1 ? 's' : ''}:</b>
                    <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                      {bad.slice(0, 5).map((i) => <li key={i.id}>{i.title}</li>)}
                    </ul>
                    <span className="muted">You can still approve; the conflicts page will then suggest covers.</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card card-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h3>Changes since publish</h3>
          {roster?.published && <span className="small muted">Published {new Date(roster.published.at).toLocaleString()}</span>}
        </div>
        {!roster?.published && <div className="muted small">This month's roster has not been published yet. Publish it from the Roster page to start tracking changes.</div>}
        {roster?.published && changes.length === 0 && <div className="muted small">No changes. The published roster is still current.</div>}
        {changes.length > 0 && (
          <>
            <ul className="list small">
              {changes.map((c, i) => (
                <li key={i} style={{ cursor: 'pointer' }} onClick={() => goto('roster', { kind: 'cell', employeeId: c.employeeId, date: c.date }, 'company')}>
                  {c.text}
                </li>
              ))}
            </ul>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="small muted grow">These people would be notified when you re-publish.</span>
              <button className="btn primary sm" disabled={store.validation.summary.errors > 0} onClick={store.publish}>Re-publish</button>
            </div>
          </>
        )}
      </div>

      <div className="card card-pad">
        <h3 style={{ marginBottom: 10 }}>Approved leave, comp-offs & unavailability</h3>
        <table className="data">
          <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Note</th><th /></tr></thead>
          <tbody>
            {approved.map((l) => (
              <tr key={l.id}>
                <td>{empName(l.employeeId)}</td>
                <td><Swatch status={l.type} />{STATUS_META[l.type]?.label}</td>
                <td>{dayLabel(l.start)}{l.end && l.end !== l.start ? ` → ${dayLabel(l.end)}` : ''}</td>
                <td className="muted">{l.note}</td>
                <td style={{ textAlign: 'right' }}><button className="btn sm ghost danger" onClick={() => store.remove('leaves', l.id)}>Cancel</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
