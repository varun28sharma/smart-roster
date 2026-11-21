import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { dayLabel } from '../engine/dates.js';
import { STATUS_META, serviceLabel } from '../engine/model.js';
import { applyActions } from '../engine/rosterState.js';
import { validateRoster } from '../engine/validator.js';
import { Swatch, impactText } from './ui.jsx';
import IssueCard from './IssueCard.jsx';
import { empSubtitle } from './Views.jsx';

/** Preview of how a set of roster actions would change errors/warnings. */
function usePreview(actionsList) {
  const { data, roster, validation, month } = useStore();
  return useMemo(() => {
    const base = roster || { month, cells: {}, pins: {}, covers: [] };
    return actionsList.map((actions) => {
      if (!actions) return null;
      const s = validateRoster(data, applyActions(base, actions)).summary;
      return { errors: s.errors - validation.summary.errors, warnings: s.warnings - validation.summary.warnings };
    });
  }, [data, roster, validation, month, actionsList]);
}

export function CellInspector({ employeeId, date, onClose, goto }) {
  const store = useStore();
  const { validation } = store;
  const { st, issues } = validation;
  const { idx } = st;
  const e = idx.empById.get(employeeId);
  const status = st.status(employeeId, date);
  const pinned = st.isPinned(employeeId, date);
  const leave = idx.absence.get(`${employeeId}|${date}`);
  const covers = st.coversBy(employeeId, date);
  const own = (idx.primaryByEmp.get(employeeId) || []).map((sid) => idx.serviceById.get(sid));
  const [coverSvc, setCoverSvc] = useState('');

  const options = ['WORK', 'OFF', 'HOL'];
  const actionsList = useMemo(
    () => options.map((s) => (leave || s === status ? null : [{ type: 'PIN', employeeId, date, status: s }])),
    [employeeId, date, status, leave], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const previews = usePreview(actionsList);

  if (!e) return null;

  const why = leave
    ? `${STATUS_META[leave.type].label}${leave.note ? ` — ${leave.note}` : ''} (from Leaves)`
    : pinned
      ? 'Manual edit — kept when the roster is regenerated'
      : store.roster?.cells?.[employeeId]?.[date]
        ? status === 'OFF' ? 'Weekly off chosen by the generator' : 'Holiday off chosen by the generator'
        : status === 'OFF' ? 'None of their processes operate today' : status === 'HOL' ? 'Public holiday, processes closed' : 'Processes operating today';

  const related = issues.filter(
    (i) => (i.employeeId === employeeId && (i.date === date || i.weekDays?.includes(date))) ||
      (i.type === 'GAP' && i.date === date && validation.coverage[i.serviceId]?.[date]?.absent.some((a) => a.employeeId === employeeId)),
  );

  const coverable = idx.activeServices.filter(
    (s) => (e.skills || []).includes(s.processId) && !own.some((o) => o.id === s.id) && st.required(s.id, date) > 0,
  );

  const markUnavailable = (type) => {
    store.upsert('leaves', { employeeId, start: date, end: date, type, status: 'approved', note: 'Added from roster' }, 'L');
  };

  return (
    <div className="card side">
      <div className="card-pad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>{e.name}</h3>
            <div className="small muted">{empSubtitle(e, idx)}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Swatch status={status} />
          <b>{STATUS_META[status].label}</b>
          <span className="muted">· {dayLabel(date)}</span>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>{why}</div>
      </div>

      <div className="card-pad">
        <h4 style={{ marginBottom: 8 }}>Their processes today</h4>
        <ul className="list small">
          {own.length === 0 && <li className="muted">No brand assignment (works company calendar)</li>}
          {own.map((s) => {
            const req = st.required(s.id, date);
            const c = validation.coverage[s.id]?.[date];
            return (
              <li key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{serviceLabel(s, idx)}</span>
                {req ? <span className={`badge ${c.count >= req ? 'ok' : 'error'}`}>{c.count}/{req}</span> : <span className="muted">closed</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card-pad">
        <h4 style={{ marginBottom: 8 }}>Change this day</h4>
        {leave ? (
          <div className="small">
            This day comes from an approved {STATUS_META[leave.type].label.toLowerCase()}. Edit it in{' '}
            <a href="#" onClick={(ev) => { ev.preventDefault(); goto('changes'); }}>Leaves & changes</a>.
          </div>
        ) : (
          <>
            <div className="col" style={{ gap: 6 }}>
              {options.map((s, i) => (
                <button
                  key={s}
                  className="btn sm"
                  disabled={s === status}
                  style={{ justifyContent: 'space-between' }}
                  onClick={() => store.applyActions([{ type: 'PIN', employeeId, date, status: s }])}
                >
                  <span><Swatch status={s} />Set {STATUS_META[s].label.toLowerCase()}</span>
                  <span className="small muted">{s === status ? 'current' : impactText(previews[i])}</span>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => markUnavailable('LEAVE')}>Mark on leave</button>
              <button className="btn sm" onClick={() => markUnavailable('UNAV')}>Mark unavailable</button>
              {pinned && (
                <button className="btn sm ghost" onClick={() => store.applyActions([{ type: 'PIN', employeeId, date, status: null }])}>
                  Clear manual edit
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="card-pad">
        <h4 style={{ marginBottom: 8 }}>Covers</h4>
        <ul className="list small">
          {covers.length === 0 && <li className="muted">Not covering anything today</li>}
          {covers.map((c) => (
            <li key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                {serviceLabel(idx.serviceById.get(c.serviceId), idx)}
                <span className="muted"> · {c.source === 'auto' ? `auto: ${c.reason}` : 'manual'}</span>
              </span>
              <button className="btn sm ghost danger" onClick={() => store.applyActions([{ type: 'REMOVE_COVER', id: c.id }])}>Remove</button>
            </li>
          ))}
        </ul>
        {status === 'WORK' && coverable.length > 0 && (
          <div className="row" style={{ marginTop: 8 }}>
            <select className="input grow" value={coverSvc} onChange={(ev) => setCoverSvc(ev.target.value)}>
              <option value="">Add a cover…</option>
              {coverable.map((s) => {
                const c = validation.coverage[s.id]?.[date];
                return (
                  <option key={s.id} value={s.id}>
                    {serviceLabel(s, idx)} ({c.count}/{c.required})
                  </option>
                );
              })}
            </select>
            <button
              className="btn sm primary"
              disabled={!coverSvc}
              onClick={() => { store.applyActions([{ type: 'ADD_COVER', employeeId, serviceId: coverSvc, date }]); setCoverSvc(''); }}
            >
              Add
            </button>
          </div>
        )}
      </div>

      {related.length > 0 && (
        <div className="card-pad">
          <h4 style={{ marginBottom: 8 }}>Related conflicts</h4>
          {related.map((i) => <IssueCard key={i.id} issue={i} compact />)}
        </div>
      )}
    </div>
  );
}

export function SvcDayInspector({ serviceId, date, onClose, onCell }) {
  const { validation } = useStore();
  const { st, coverage, issues } = validation;
  const { idx } = st;
  const s = idx.serviceById.get(serviceId);
  const c = coverage[serviceId]?.[date];
  if (!s || !c) return null;
  const gap = issues.find((i) => i.type === 'GAP' && i.serviceId === serviceId && i.date === date);
  const candidates = st.coverCandidates(serviceId, date).slice(0, 5);
  const backups = idx.backupsByService.get(serviceId) || [];
  return (
    <div className="card side">
      <div className="card-pad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>{serviceLabel(s, idx)}</h3>
            <div className="small muted">{idx.processById.get(s.processId)?.name} · {dayLabel(date)}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {c.required ? <span className={`badge ${c.count >= c.required ? 'ok' : 'error'}`}>{c.count} working / {c.required} required</span> : <span className="badge">Not operating</span>}
          {s.calendar?.preset && <span className="badge">{s.calendar.preset.replace(/_/g, ' ').toLowerCase()}</span>}
        </div>
      </div>
      <div className="card-pad">
        <h4 style={{ marginBottom: 8 }}>Assigned</h4>
        <ul className="list small">
          {(idx.primaryByService.get(serviceId) || []).map((eid) => (
            <li key={eid} className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => onCell(eid, date)}>
              <span>{idx.empById.get(eid)?.name}</span>
              <span><Swatch status={st.status(eid, date)} />{STATUS_META[st.status(eid, date)].label}</span>
            </li>
          ))}
          {c.covers.map((eid) => (
            <li key={eid} className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => onCell(eid, date)}>
              <span>{idx.empById.get(eid)?.name} <span className="badge brand">cover</span></span>
              <span><Swatch status="WORK" />Working</span>
            </li>
          ))}
        </ul>
        {backups.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Designated backups: {backups.map((b) => idx.empById.get(b)?.name).join(', ')}</div>}
      </div>
      {gap && (
        <div className="card-pad">
          <IssueCard issue={gap} startOpen />
        </div>
      )}
      {!gap && c.required > 0 && (
        <div className="card-pad">
          <h4 style={{ marginBottom: 8 }}>Who could step in</h4>
          <ul className="list small">
            {candidates.length === 0 && <li className="muted">Nobody qualified is free.</li>}
            {candidates.map((x) => (
              <li key={x.employee.id}>
                <b>{x.employee.name}</b>
                <div className="muted">{x.reasons.join(' · ')}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Default side panel: open conflicts (if any), then a snapshot of one day. */
export function DefaultInspector({ date, onPickDay, goto, onCell, onSvcDay }) {
  const { validation, roster, month } = useStore();
  const { st, coverage } = validation;
  const { idx, days } = st;
  const d = days.includes(date) ? date : days[0];
  const i = days.indexOf(d);
  const errors = validation.issues.filter((x) => x.severity === 'error');

  const away = idx.activeEmployees
    .map((e) => ({ e, s: st.status(e.id, d) }))
    .filter((x) => x.s !== 'WORK');
  const byStatus = {};
  for (const x of away) (byStatus[x.s] ||= []).push(x.e);
  const covers = (roster?.covers || []).filter((c) => c.date === d && st.status(c.employeeId, d) === 'WORK');
  const required = idx.activeServices.filter((s) => coverage[s.id]?.[d]?.required > 0);
  const short = required.filter((s) => coverage[s.id][d].count < coverage[s.id][d].required);

  return (
    <div className="card side">
      {errors.length > 0 && (
        <div className="card-pad">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ color: 'var(--err)' }}>{errors.length} to resolve</h3>
            <button className="btn sm ghost" onClick={() => goto('issues')}>See all</button>
          </div>
          {errors.slice(0, 4).map((x) => <IssueCard key={x.id} issue={x} compact />)}
        </div>
      )}

      <div className="card-pad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>{dayLabel(d)}</h3>
          <div className="row" style={{ gap: 2 }}>
            <button className="btn sm ghost" disabled={i <= 0} onClick={() => onPickDay(days[i - 1])} aria-label="Previous day">‹</button>
            <button className="btn sm ghost" disabled={i >= days.length - 1} onClick={() => onPickDay(days[i + 1])} aria-label="Next day">›</button>
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 2 }}>
          {idx.holidays.get(d) ? `${idx.holidays.get(d).name} · ` : ''}
          {required.length - short.length}/{required.length} processes staffed · {idx.activeEmployees.length - away.length} people working
        </div>
      </div>

      {short.length > 0 && (
        <div className="card-pad">
          <h4 style={{ marginBottom: 6, color: 'var(--err)' }}>Short today</h4>
          <ul className="list small">
            {short.map((s) => (
              <li key={s.id} className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => onSvcDay(s.id, d)}>
                <span>{serviceLabel(s, idx)}</span>
                <span className="badge error">{coverage[s.id][d].count}/{coverage[s.id][d].required}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card-pad">
        <h4 style={{ marginBottom: 6 }}>Not working ({away.length})</h4>
        {away.length === 0 && <div className="small muted">Everyone is in.</div>}
        {Object.entries(byStatus).map(([s, emps]) => (
          <div key={s} className="small" style={{ marginBottom: 6 }}>
            <Swatch status={s} />
            <span className="muted">{STATUS_META[s].label}: </span>
            {emps.map((e, k) => (
              <span key={e.id}>
                <a href="#" onClick={(ev) => { ev.preventDefault(); onCell(e.id, d); }}>{e.name.split(' ')[0]}</a>
                {k < emps.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="card-pad">
        <h4 style={{ marginBottom: 6 }}>Cross-covers ({covers.length})</h4>
        {covers.length === 0 && <div className="small muted">Nobody is covering another brand today.</div>}
        <ul className="list small">
          {covers.map((c) => (
            <li key={c.id} style={{ cursor: 'pointer' }} onClick={() => onCell(c.employeeId, d)}>
              <b>{idx.empById.get(c.employeeId)?.name}</b> → {serviceLabel(idx.serviceById.get(c.serviceId), idx)}
              <div className="muted">{c.source === 'manual' ? 'added manually' : c.reason}</div>
            </li>
          ))}
        </ul>
      </div>

      {roster?.log?.length > 0 && <DecisionLog log={roster.log} month={month} />}
    </div>
  );
}

// Rosters saved before log entries carried a `kind` are classified from their text.
function logKind(l) {
  if (l.kind) return l.kind;
  if (l.level === 'warn') return 'warn';
  if (l.msg.includes('comp-off')) return 'holiday';
  if (l.msg.includes('(gap')) return 'gapCover';
  return 'offCover';
}

function DecisionLog({ log }) {
  const [open, setOpen] = useState(null);
  const groups = [
    ['warn', 'Could not satisfy', (n) => `${n} unresolved`],
    ['holiday', 'Working a public holiday', (n) => `${n} people, comp-off earned`],
    ['offCover', 'Covers for weekly offs', (n) => `${n} covers`],
    ['gapCover', 'Covers for leave & gaps', (n) => `${n} covers`],
  ]
    .map(([kind, title, sum]) => ({ kind, title, sum, items: log.filter((l) => logKind(l) === kind) }))
    .filter((g) => g.items.length);
  return (
    <div className="card-pad">
      <h4 style={{ marginBottom: 6 }}>How this roster was built</h4>
      <ul className="list small">
        {groups.map((g) => (
          <li key={g.kind}>
            <button className="linklike" onClick={() => setOpen(open === g.kind ? null : g.kind)}>
              <span className={g.kind === 'warn' ? 'err-text' : ''}>{g.title}</span>
              <span className="muted">{g.sum(g.items.length)} {open === g.kind ? '▾' : '▸'}</span>
            </button>
            {open === g.kind && (
              <ul className="log">
                {g.items.map((l, k) => <li key={k} className={l.level}>{l.msg}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
