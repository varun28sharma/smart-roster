import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { monthLabel, shiftMonth } from '../engine/dates.js';
import { rosterToCSV, diffSincePublish } from '../engine/changes.js';
import { EmployeeGrid, CoverageTable, CoverageLegend, EmployeeCalendar, DayBoard } from './Views.jsx';
import { CellInspector, SvcDayInspector, DefaultInspector } from './Inspector.jsx';
import { downloadText } from './ui.jsx';

const VIEWS = [
  ['company', 'Company'],
  ['pod', 'Pod'],
  ['brand', 'Brand'],
  ['process', 'Process'],
  ['employee', 'Employee'],
  ['day', 'Day'],
];

function useIssuesIndex(validation) {
  return useMemo(() => {
    const flagged = new Set();
    const gapsByDay = new Map();
    for (const i of validation.issues) {
      if (i.severity !== 'error') continue;
      if (i.type === 'GAP') {
        if (!gapsByDay.has(i.date)) gapsByDay.set(i.date, []);
        gapsByDay.get(i.date).push(i);
        for (const a of validation.coverage[i.serviceId]?.[i.date]?.absent || []) flagged.add(`${a.employeeId}|${i.date}`);
      }
      if (i.type === 'NO_WEEKLY_OFF') for (const d of i.weekDays || []) flagged.add(`${i.employeeId}|${d}`);
      if (i.type === 'COVER_INVALID' || i.type === 'MULTI_BRAND') flagged.add(`${i.employeeId}|${i.date}`);
    }
    return { flagged, gapsByDay };
  }, [validation]);
}

export default function RosterPage({ selection, setSelection, view, setView, goto }) {
  const store = useStore();
  const { validation, roster, month, data } = store;
  const { st, summary, coverage } = validation;
  const { idx, days } = st;
  const issuesIndex = useIssuesIndex(validation);

  const [podId, setPodId] = useState(data.pods[0]?.id);
  const [brandId, setBrandId] = useState(data.brands[0]?.id);
  const [processId, setProcessId] = useState(data.processes[0]?.id);
  const [empId, setEmpId] = useState(data.employees[0]?.id);
  const selDay = selection?.date && selection.date.startsWith(month) ? selection.date : days[0];

  const changes = useMemo(() => (roster?.published ? diffSincePublish(data, roster) : []), [data, roster]);

  const onCell = (employeeId, date) => setSelection({ kind: 'cell', employeeId, date });
  const onDay = (date) => { setSelection({ kind: 'day', date }); setView('day'); };
  const onSvcDay = (serviceId, date) => setSelection({ kind: 'svcday', serviceId, date });
  const onEmployee = (id) => { setEmpId(id); setView('employee'); };

  const exportCsv = () => downloadText(`roster-${month}.csv`, rosterToCSV(data, roster));

  const content = (() => {
    if (!roster) {
      return (
        <div className="card empty-state">
          <h3 style={{ color: 'var(--ink)', marginBottom: 6 }}>No roster for {monthLabel(month)} yet</h3>
          <p>The generator will read every brand calendar, assignment, leave and holiday for this month.</p>
          <button className="btn primary" onClick={store.generate}>Generate {monthLabel(month)} roster</button>
        </div>
      );
    }
    switch (view) {
      case 'company':
        return <EmployeeGrid employees={idx.activeEmployees} st={st} issuesIndex={issuesIndex} selection={selection} onCell={onCell} onDay={onDay} onEmployee={onEmployee} />;
      case 'pod': {
        const pod = idx.podById.get(podId);
        const emps = idx.activeEmployees.filter((e) => e.podId === podId);
        const svcs = new Set(idx.activeServices.filter((s) => idx.brandById.get(s.brandId)?.podId === podId).map((s) => s.id));
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row">
              <select className="input" value={podId} onChange={(e) => setPodId(e.target.value)}>
                {data.pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="muted small">Lead: <b>{idx.empById.get(pod?.leadId)?.name ?? 'none'}</b> · {emps.length} people · {[...new Set(idx.activeServices.filter((s) => svcs.has(s.id)).map((s) => s.brandId))].length} brands</span>
            </div>
            <EmployeeGrid employees={emps} st={st} issuesIndex={issuesIndex} selection={selection} onCell={onCell} onDay={onDay} onEmployee={onEmployee} groupByPod={false} scopeServices={svcs} />
            <CoverageTable services={idx.activeServices.filter((s) => svcs.has(s.id))} st={st} coverage={coverage} selection={selection} onSvcDay={onSvcDay} onDay={onDay} title="Pod coverage" />
            <CoverageLegend />
          </div>
        );
      }
      case 'brand': {
        const svcs = idx.activeServices.filter((s) => s.brandId === brandId);
        const ids = new Set(svcs.flatMap((s) => idx.primaryByService.get(s.id) || []));
        const coverIds = new Set((roster.covers || []).filter((c) => svcs.some((s) => s.id === c.serviceId)).map((c) => c.employeeId));
        const emps = idx.activeEmployees.filter((e) => ids.has(e.id));
        const coverers = idx.activeEmployees.filter((e) => coverIds.has(e.id) && !ids.has(e.id));
        const brand = idx.brandById.get(brandId);
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row">
              <select className="input" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                {data.brands.map((b) => <option key={b.id} value={b.id}>{b.name} ({(new Set(idx.activeServices.filter((s) => s.brandId === b.id).flatMap((s) => idx.primaryByService.get(s.id) || []))).size})</option>)}
              </select>
              <span className="muted small">
                {idx.podById.get(brand?.podId)?.name} · {emps.length === 1 ? 'single-resource brand' : `${emps.length} employees`} · {svcs.length} processes
              </span>
            </div>
            <CoverageTable services={svcs} st={st} coverage={coverage} selection={selection} onSvcDay={onSvcDay} onDay={onDay} />
            <CoverageLegend />
            <h4 style={{ marginTop: 6 }}>Assigned employees</h4>
            <EmployeeGrid employees={emps} st={st} issuesIndex={issuesIndex} selection={selection} onCell={onCell} onDay={onDay} onEmployee={onEmployee} groupByPod={false} scopeServices={new Set(svcs.map((s) => s.id))} />
            {coverers.length > 0 && (
              <>
                <h4 style={{ marginTop: 6 }}>Covering this month</h4>
                <EmployeeGrid employees={coverers} st={st} issuesIndex={issuesIndex} selection={selection} onCell={onCell} onDay={onDay} onEmployee={onEmployee} groupByPod={false} scopeServices={new Set(svcs.map((s) => s.id))} />
              </>
            )}
          </div>
        );
      }
      case 'process': {
        const svcs = idx.activeServices.filter((s) => s.processId === processId);
        const ids = new Set(svcs.flatMap((s) => idx.primaryByService.get(s.id) || []));
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row">
              <select className="input" value={processId} onChange={(e) => setProcessId(e.target.value)}>
                {data.processes.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
              <span className="muted small">{svcs.length} brands run this process · {ids.size} people assigned</span>
            </div>
            <CoverageTable services={svcs} st={st} coverage={coverage} selection={selection} onSvcDay={onSvcDay} onDay={onDay} />
            <CoverageLegend />
            <h4 style={{ marginTop: 6 }}>People on this process</h4>
            <EmployeeGrid employees={idx.activeEmployees.filter((e) => ids.has(e.id))} st={st} issuesIndex={issuesIndex} selection={selection} onCell={onCell} onDay={onDay} onEmployee={onEmployee} scopeServices={new Set(svcs.map((s) => s.id))} />
          </div>
        );
      }
      case 'employee': {
        const e = idx.empById.get(empId);
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row">
              <select className="input" value={empId} onChange={(ev) => setEmpId(ev.target.value)}>
                {idx.activeEmployees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {e && <span className="muted small">{idx.podById.get(e.podId)?.name} · {e.shiftId || 'GEN'} shift · preferred off: {(e.weeklyOffPref || []).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') || 'none'}</span>}
            </div>
            {e && <EmployeeCalendar employee={e} st={st} onCell={onCell} selection={selection} />}
          </div>
        );
      }
      case 'day':
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row">
              <select className="input" value={selDay} onChange={(e) => setSelection({ kind: 'day', date: e.target.value })}>
                {days.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <span className="muted small">Who is working, brand by brand</span>
            </div>
            <DayBoard date={selDay} st={st} coverage={coverage} onSvcDay={onSvcDay} onCell={onCell} />
          </div>
        );
      default:
        return null;
    }
  })();

  const inspector =
    selection?.kind === 'cell' && selection.date.startsWith(month) ? (
      <CellInspector employeeId={selection.employeeId} date={selection.date} onClose={() => setSelection(null)} goto={goto} />
    ) : selection?.kind === 'svcday' && selection.date.startsWith(month) ? (
      <SvcDayInspector serviceId={selection.serviceId} date={selection.date} onClose={() => setSelection(null)} onCell={onCell} />
    ) : (
      <DefaultInspector key={month} goto={goto} onCell={onCell} onSvcDay={onSvcDay} />
    );

  return (
    <div>
      <div className="toolbar">
        <div className="month-nav">
          <button className="btn sm" onClick={() => store.setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <strong>{monthLabel(month)}</strong>
          <button className="btn sm" onClick={() => store.setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        </div>
        <button className="btn primary" onClick={store.generate} title="Manual edits and manual covers are kept">
          {roster ? 'Regenerate (keep manual edits)' : 'Generate roster'}
        </button>
        <button className="btn" onClick={store.undo} disabled={!store.canUndo}>Undo</button>
        <div className="spacer" />
        {roster && (
          <>
            <button className="btn" onClick={exportCsv}>Export CSV</button>
            <button
              className="btn"
              onClick={store.publish}
              disabled={summary.errors > 0}
              title={summary.errors > 0 ? 'Resolve all errors before publishing' : 'Freeze this version; later changes are tracked'}
            >
              {roster.published ? 'Re-publish' : 'Publish'}
            </button>
          </>
        )}
      </div>

      {roster?.published && changes.length > 0 && (
        <div className="banner warn">
          <b>{changes.length} change{changes.length > 1 ? 's' : ''} since this roster was published</b>
          <span>on {new Date(roster.published.at).toLocaleString()}.</span>
          <button className="btn sm" onClick={() => goto('changes')}>Review changes</button>
        </div>
      )}
      {roster && (
        <div className="statusline">
          <span className={`sl-main ${summary.errors ? 'bad' : 'good'}`}>
            <span className="dot" />
            {summary.errors
              ? `${summary.errors} conflict${summary.errors > 1 ? 's' : ''} to resolve before publishing`
              : 'Ready to publish'}
          </span>
          <span className="sl-item" title={`${summary.okDays} of ${summary.reqDays} required process-days staffed`}>
            <b>{summary.coveragePct}%</b> covered
          </span>
          {summary.errors > 0 && (
            <button className="sl-item link bad" onClick={() => goto('issues')}><b>{summary.errors}</b> errors</button>
          )}
          {summary.warnings > 0 && (
            <button className="sl-item link warn" onClick={() => goto('issues')}><b>{summary.warnings}</b> warnings</button>
          )}
          <span className="sl-item"><b>{summary.covers}</b> cross-covers</span>
          <span className="sl-item muted">
            {roster.published ? 'Published' : 'Draft'} v{roster.version}
            {roster.generatedAt ? ` · generated ${new Date(roster.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
          </span>
        </div>
      )}

      {roster && (
        <div className="tabs">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
      )}

      <div className="layout-split">
        <div style={{ minWidth: 0 }}>{content}</div>
        {roster && inspector}
      </div>
    </div>
  );
}
