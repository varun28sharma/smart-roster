import { useMemo } from 'react';
import { DOW, dow, dayLabel, monthLabel } from '../engine/dates.js';
import { STATUS_META, serviceLabel, shiftOf } from '../engine/model.js';
import { Legend, Swatch } from './ui.jsx';


export function empSubtitle(e, idx) {
  const brands = [...new Set((idx.primaryByEmp.get(e.id) || []).map((sid) => idx.brandById.get(idx.serviceById.get(sid)?.brandId)?.name))];
  const parts = [];
  if (e.isLead) parts.push('Pod lead');
  if (brands.length) parts.push(brands.join(', '));
  if (shiftOf(e) !== 'GEN') parts.push(`${shiftOf(e)} shift`);
  return parts.join(' · ');
}

const CAL_SHORT = { ALL_DAYS: 'All 365 days', DAILY_NO_PH: 'Daily, holidays off', MON_SAT_NO_PH: 'Mon–Sat', MON_FRI_NO_PH: 'Mon–Fri' };

/** Column classes shared by header and body: weekend bands and Monday week dividers. */
function dayCls(d, days) {
  const wd = dow(d);
  return `${wd === 0 || wd === 6 ? 'we' : ''} ${wd === 1 && d !== days[0] ? 'wk' : ''}`;
}

function DayHeaders({ days, idx, selection, onDay, extraRow }) {
  return (
    <thead>
      <tr>
        <th className="sticky-col" style={{ height: 38 }}>{extraRow?.title ?? ''}</th>
        {days.map((d) => {
          const wd = dow(d);
          const hol = idx.holidays.get(d);
          return (
            <th
              key={d}
              className={`day-h ${dayCls(d, days)} ${wd === 0 || wd === 6 ? 'weekend' : ''} ${hol ? 'holiday' : ''} ${selection?.date === d && selection?.kind === 'day' ? 'selected' : ''}`}
              title={hol ? `${dayLabel(d)}, ${hol.name}` : dayLabel(d)}
              onClick={() => onDay(d)}
            >
              <div className="dn">{DOW[wd][0]}</div>
              <div>{Number(d.slice(8))}</div>
              {hol && <div className="ph" />}
            </th>
          );
        })}
      </tr>
      {extraRow && (
        <tr>
          <th className="sticky-col small muted" style={{ fontWeight: 500 }}>{extraRow.label}</th>
          {days.map((d) => extraRow.cell(d))}
        </tr>
      )}
    </thead>
  );
}

/** Employee x day grid, optionally grouped by pod. Used for company, pod and brand views. */
export function EmployeeGrid({ employees, st, issuesIndex, selection, onCell, onDay, onEmployee, groupByPod = true, scopeServices }) {
  const { idx, days } = st;
  const gapsOn = (d) => {
    const list = issuesIndex.gapsByDay.get(d) || [];
    return scopeServices ? list.filter((g) => scopeServices.has(g.serviceId)) : list;
  };
  const groups = useMemo(() => {
    if (!groupByPod) return [{ pod: null, emps: employees }];
    const g = new Map();
    for (const e of employees) {
      if (!g.has(e.podId)) g.set(e.podId, []);
      g.get(e.podId).push(e);
    }
    return [...g.entries()].map(([podId, emps]) => ({
      pod: idx.podById.get(podId),
      emps: emps.sort((a, b) => (b.isLead ? 1 : 0) - (a.isLead ? 1 : 0) || a.name.localeCompare(b.name)),
    }));
  }, [employees, groupByPod, idx]);

  return (
    <>
      <div className="grid-wrap">
        <table className="grid">
          <DayHeaders
            days={days}
            idx={idx}
            selection={selection}
            onDay={onDay}
            extraRow={{
              title: `${employees.length} people`,
              label: 'Coverage gaps',
              cell: (d) => {
                const n = gapsOn(d).length;
                return (
                  <th key={d} className={`cov-h ${dayCls(d, days)} ${n ? 'bad' : 'good'}`} onClick={() => onDay(d)} title={n ? `${n} process(es) short` : 'All required processes covered'}>
                    {n || ''}
                  </th>
                );
              },
            }}
          />
          <tbody>
            {groups.map(({ pod, emps }) => (
              <PodRows key={pod?.id ?? 'all'} pod={pod} emps={emps} st={st} issuesIndex={issuesIndex} selection={selection} onCell={onCell} onEmployee={onEmployee} />
            ))}
          </tbody>
        </table>
      </div>
      <Legend />
    </>
  );
}

function PodRows({ pod, emps, st, issuesIndex, selection, onCell, onEmployee }) {
  const { idx, days } = st;
  return (
    <>
      {pod && (
        <tr className="pod-row">
          <td colSpan={days.length + 1}>
            {pod.name} <span className="muted small" style={{ marginLeft: 8 }}>{idx.empById.get(pod.leadId)?.name ?? 'No lead'} leads {emps.length} people</span>
          </td>
        </tr>
      )}
      {emps.map((e) => (
        <tr key={e.id}>
          <td className="sticky-col">
            <div className="emp-name">
              <button onClick={() => onEmployee(e.id)} title="Open employee view">
                <b>{e.name}</b>
              </button>
              <span>{empSubtitle(e, idx)}</span>
            </div>
          </td>
          {(() => {
            // Each row is a shift track: consecutive days with the same status join
            // into one segment (thin bar for work, solid block for absences);
            // weekly offs are simply gaps.
            const statuses = days.map((d) => st.status(e.id, d));
            return days.map((d, i) => {
              const s = statuses[i];
              const joinL = i > 0 && statuses[i - 1] === s;
              const joinR = i < days.length - 1 && statuses[i + 1] === s;
              const covers = s === 'WORK' ? st.coversBy(e.id, d) : [];
              const pinned = st.isPinned(e.id, d);
              const flagged = issuesIndex.flagged.has(`${e.id}|${d}`);
              const sel = selection?.kind === 'cell' && selection.employeeId === e.id && selection.date === d;
              const tip = [
                `${e.name}, ${dayLabel(d)}`,
                STATUS_META[s].label,
                ...covers.map((c) => `Covering ${serviceLabel(idx.serviceById.get(c.serviceId), idx)}`),
                pinned ? 'Manual edit' : '',
              ].filter(Boolean).join('\n');
              const seg = s === 'OFF' ? null : (
                <span className={`seg ${s === 'WORK' ? 'bar' : 'blk'} ${joinL ? 'jl' : ''} ${joinR ? 'jr' : ''}`}>
                  {s !== 'WORK' && !joinL ? STATUS_META[s].code : ''}
                </span>
              );
              return (
                <td key={d} className={`cell ${s} ${dayCls(d, days)} ${sel ? 'sel' : ''} ${flagged ? 'flag' : ''}`} title={tip} onClick={() => onCell(e.id, d)}>
                  {seg}
                  {covers.length > 0 && <span className={`cv ${covers.length > 1 ? 'two' : ''}`} />}
                  {pinned && <span className="pin" />}
                </td>
              );
            });
          })()}
        </tr>
      ))}
    </>
  );
}

/** Brand-process x day coverage table: "working/required". */
export function CoverageTable({ services, st, coverage, selection, onSvcDay, onDay, title }) {
  const { idx, days } = st;
  return (
    <div className="grid-wrap" style={{ maxHeight: 'none' }}>
      <table className="grid">
        <DayHeaders days={days} idx={idx} selection={selection} onDay={onDay} extraRow={null} />
        <tbody>
          {title && (
            <tr className="pod-row"><td colSpan={days.length + 1}>{title}</td></tr>
          )}
          {services.map((s) => {
            const assigned = idx.primaryByService.get(s.id) || [];
            const cal = s.calendar;
            return (
              <tr key={s.id}>
                <td className="sticky-col">
                  <div className="emp-name">
                    <b>{serviceLabel(s, idx)}</b>
                    <span>
                      {CAL_SHORT[cal?.preset] ?? 'Custom days'}, needs {s.minStaff}, {assigned.length} assigned
                      {shiftOf(s) !== 'GEN' ? `, ${shiftOf(s).toLowerCase()} shift` : ''}
                    </span>
                  </div>
                </td>
                {days.map((d) => {
                  const c = coverage[s.id]?.[d];
                  if (!c || !c.required) return <td key={d} className={`ccell na ${dayCls(d, days)}`} title={`${dayLabel(d)}: not operating`} />;
                  const cls = c.count === 0 ? 'zero' : c.count < c.required ? 'short' : 'ok';
                  const names = [...c.primary, ...c.covers.map((x) => x + '*')].map((id) => idx.empById.get(id.replace('*', ''))?.name + (id.endsWith('*') ? ' (cover)' : ''));
                  // Met days are a quiet dot (or the headcount when more than one is needed);
                  // only shortfalls show numbers.
                  const label = cls === 'ok' ? (c.required > 1 ? c.count : '') : `${c.count}/${c.required}`;
                  return (
                    <td
                      key={d}
                      className={`ccell ${cls} ${dayCls(d, days)} ${c.covers.length ? 'covered' : ''} ${selection?.kind === 'svcday' && selection.serviceId === s.id && selection.date === d ? 'sel' : ''}`}
                      title={`${serviceLabel(s, idx)}, ${dayLabel(d)}\n${c.count}/${c.required} working\n${names.join('\n') || 'Nobody'}`}
                      onClick={() => onSvcDay(s.id, d)}
                    >
                      <span className="cmark">{label}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CoverageLegend() {
  return (
    <div className="legend">
      <span><span className="lg-cov ok" />Covered (number = people when more than 1 needed)</span>
      <span><span className="lg-cov ok cov" />Covered with help from another brand</span>
      <span><span className="lg-cov short">1/2</span>Under-staffed</span>
      <span><span className="lg-cov zero">0/1</span>Nobody available</span>
      <span><span className="lg-cov" />Closed</span>
    </div>
  );
}

export function EmployeeCalendar({ employee, st, onCell, selection }) {
  const { idx, days } = st;
  const lead = (dow(days[0]) + 6) % 7; // Monday-first
  const stats = { WORK: 0, OFF: 0, HOL: 0, LEAVE: 0, COMP: 0, UNAV: 0 };
  let covers = 0;
  for (const d of days) {
    stats[st.status(employee.id, d)]++;
    covers += st.coversBy(employee.id, d).length;
  }
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row small">
        {Object.entries(stats).filter(([, n]) => n).map(([s, n]) => (
          <span key={s} className="badge"><Swatch status={s} />{STATUS_META[s].label}: {n}</span>
        ))}
        <span className="badge brand">Covers: {covers}</span>
      </div>
      <div className="cal">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => <div key={n} className="dh">{n}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} className="dc empty" />)}
        {days.map((d) => {
          const s = st.status(employee.id, d);
          const cv = st.coversBy(employee.id, d);
          const own = (idx.primaryByEmp.get(employee.id) || []).filter((sid) => st.required(sid, d) > 0);
          const leave = idx.absence.get(`${employee.id}|${d}`);
          const sel = selection?.kind === 'cell' && selection.employeeId === employee.id && selection.date === d;
          return (
            <div key={d} className={`dc ${s}`} style={sel ? { outline: '2px solid var(--brand)' } : undefined} onClick={() => onCell(employee.id, d)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="n">{Number(d.slice(8))}</span>
                <span className="small" style={{ fontWeight: 600 }}>{STATUS_META[s].label}</span>
              </div>
              {idx.holidays.get(d) && <div className="small" style={{ color: 'var(--s-hol-ink)' }}>{idx.holidays.get(d).name}</div>}
              {s === 'WORK' && own.length > 0 && <div className="small muted">{own.map((sid) => idx.processById.get(idx.serviceById.get(sid).processId)?.code).join(', ')}</div>}
              {cv.map((c) => <div key={c.id} className="small" style={{ color: 'var(--brand)', fontWeight: 600 }}>+ {serviceLabel(idx.serviceById.get(c.serviceId), idx)}</div>)}
              {leave?.note && <div className="small muted">{leave.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Who is working on one day, brand by brand. */
export function DayBoard({ date, st, coverage, onSvcDay, onCell }) {
  const { idx } = st;
  const byPod = new Map();
  for (const s of idx.activeServices) {
    const podId = idx.brandById.get(s.brandId)?.podId;
    if (!byPod.has(podId)) byPod.set(podId, []);
    byPod.get(podId).push(s);
  }
  const absent = idx.activeEmployees
    .map((e) => ({ e, s: st.status(e.id, date) }))
    .filter((x) => x.s !== 'WORK');
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <h3>{dayLabel(date)}{idx.holidays.get(date) ? ` · ${idx.holidays.get(date).name}` : ''}</h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {[...byPod.entries()].map(([podId, svcs]) => (
          <div key={podId} className="card card-pad">
            <h4 style={{ marginBottom: 8 }}>{idx.podById.get(podId)?.name}</h4>
            <ul className="list">
              {svcs.map((s) => {
                const c = coverage[s.id]?.[date];
                if (!c?.required) {
                  return (
                    <li key={s.id} className="small muted">{serviceLabel(s, idx)} · closed</li>
                  );
                }
                const ok = c.count >= c.required;
                return (
                  <li key={s.id} style={{ cursor: 'pointer' }} onClick={() => onSvcDay(s.id, date)}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <b className="small">{serviceLabel(s, idx)}</b>
                      <span className={`badge ${ok ? 'ok' : 'error'}`}>{c.count}/{c.required}</span>
                    </div>
                    <div className="small muted">
                      {[...c.primary.map((id) => idx.empById.get(id)?.name), ...c.covers.map((id) => `${idx.empById.get(id)?.name} (cover)`)].join(', ') || 'Nobody available'}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="card card-pad">
        <h4 style={{ marginBottom: 8 }}>Not working ({absent.length})</h4>
        <div className="chips">
          {absent.map(({ e, s }) => (
            <button key={e.id} className="badge" style={{ border: 0, cursor: 'pointer' }} onClick={() => onCell(e.id, date)}>
              <Swatch status={s} />{e.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { monthLabel };
