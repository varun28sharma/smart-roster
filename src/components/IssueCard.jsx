import { useEffect, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { suggestFixes } from '../engine/suggestions.js';
import { emptyRoster } from '../engine/rosterState.js';
import { explainIssue } from '../ai.js';
import { Sev, impactText } from './ui.jsx';

const FIXABLE = new Set(['GAP', 'MULTI_BRAND', 'NO_WEEKLY_OFF', 'COVER_INVALID', 'COVER_SKILL', 'OVERLOAD']);

export default function IssueCard({ issue, compact, startOpen, onShow }) {
  const store = useStore();
  const [fixes, setFixes] = useState(null);
  const [open, setOpen] = useState(Boolean(startOpen));
  const [explain, setExplain] = useState(null);
  const [busy, setBusy] = useState(false);

  const roster = store.roster || emptyRoster(store.month);
  const loadFixes = () => {
    const f = suggestFixes(store.data, roster, issue, store.validation.summary);
    setFixes(f);
    return f;
  };
  // Suggestions are simulated against the current roster; recompute when it or the data changes.
  useEffect(() => { setFixes(null); }, [store.roster, store.data]);
  useEffect(() => {
    if (open && !fixes && FIXABLE.has(issue.type)) loadFixes();
  }, [open, fixes]); // eslint-disable-line react-hooks/exhaustive-deps

  const onExplain = async () => {
    setBusy(true);
    const f = fixes || (FIXABLE.has(issue.type) ? loadFixes() : []);
    const r = await explainIssue(issue, f, { month: store.month, coveragePct: store.validation.summary.coveragePct });
    setExplain(r);
    setBusy(false);
  };

  return (
    <div className={`issue ${issue.severity}`}>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div className="grow">
          <div className="t">{issue.title}</div>
          {!compact && <div className="d">{issue.detail}</div>}
          {compact && open && <div className="d">{issue.detail}</div>}
          {issue.hint && !compact && <div className="h">{issue.hint}</div>}
        </div>
        {!compact && <Sev s={issue.severity} />}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {FIXABLE.has(issue.type) && (
          <button className="btn sm" onClick={() => setOpen(!open)}>
            {open ? 'Hide fixes' : 'Suggest fixes'}
          </button>
        )}
        {compact && !FIXABLE.has(issue.type) && (
          <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? 'Less' : 'Details'}</button>
        )}
        {issue.severity !== 'info' && (
          <button className="btn sm ghost" onClick={onExplain} disabled={busy}>{busy ? 'Explaining…' : 'Explain'}</button>
        )}
        {onShow && <button className="btn sm ghost" onClick={onShow}>Show in roster</button>}
      </div>
      {explain && (
        <div className="explain">
          {explain.text}
          <div className="small muted" style={{ marginTop: 4 }}>Source: {explain.source}</div>
        </div>
      )}
      {open && fixes && (
        <div style={{ marginTop: 4 }}>
          {fixes.length === 0 && (
            <div className="fix"><div className="grow small">No internal resource can fix this. Options: approve overtime, raise a cover limit, add a backup assignment in Setup, or agree reduced coverage with the client.</div></div>
          )}
          {fixes.map((f) => (
            <div key={f.id} className="fix">
              <div className="grow">
                <div className="l">{f.label}</div>
                <div className="r">{f.detail}</div>
                <div className="r" style={{ color: f.impact.errors < 0 ? 'var(--ok)' : f.impact.errors > 0 ? 'var(--err)' : undefined }}>
                  Effect: {impactText(f.impact)} · coverage {f.impact.coveragePct}%
                </div>
              </div>
              <button className="btn sm primary" onClick={() => { store.applyActions(f.actions); setFixes(null); setOpen(false); }}>
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
