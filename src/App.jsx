import { useState } from 'react';
import { useStore } from './store/store.jsx';
import RosterPage from './components/RosterPage.jsx';
import IssuesPage from './components/IssuesPage.jsx';
import ChangesPage from './components/ChangesPage.jsx';
import SetupPage from './components/SetupPage.jsx';

const PAGES = [
  ['roster', 'Roster'],
  ['issues', 'Conflicts'],
  ['changes', 'Leaves & changes'],
  ['setup', 'Setup'],
];

export default function App() {
  const store = useStore();
  const [page, setPage] = useState('roster');
  // Shared selection so "Show in roster" from other pages lands on the right cell/day.
  const [selection, setSelection] = useState(null);
  const [view, setView] = useState('company');

  const goto = (p, sel, v) => {
    if (sel !== undefined) setSelection(sel);
    if (v) setView(v);
    setPage(p);
    window.scrollTo({ top: 0 });
  };

  if (!store.loaded) return <div className="empty-state">Loading roster data…</div>;

  const { errors } = store.validation.summary;
  const pending = store.data.leaves.filter((l) => l.status === 'pending').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round"><path d="M2 4h12M2 8h12M2 12h7" /></svg>
          </span>
          Smart Roster
        </div>
        <nav className="nav">
          {PAGES.map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => goto(id)}>
              {label}
              {id === 'issues' && errors > 0 && <span className="badge error count">{errors}</span>}
              {id === 'changes' && pending > 0 && <span className="badge warning count">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className={`save-dot ${store.saveState}`} title={store.saveError || ''}>
          {store.backend === 'supabase' ? 'Supabase' : 'Saved in this browser'}
          {store.saveState === 'saving' && ' · saving…'}
          {store.saveState === 'error' && ' · save failed'}
        </span>
      </header>
      {store.saveError && <div className="banner err" style={{ margin: '12px 20px 0' }}>{store.saveError}</div>}
      <main className="main">
        {page === 'roster' && <RosterPage selection={selection} setSelection={setSelection} view={view} setView={setView} goto={goto} />}
        {page === 'issues' && <IssuesPage goto={goto} />}
        {page === 'changes' && <ChangesPage goto={goto} />}
        {page === 'setup' && <SetupPage />}
      </main>
    </div>
  );
}
