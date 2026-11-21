import { useState } from 'react';
import { useStore } from '../store/store.jsx';
import { DOW } from '../engine/dates.js';
import { CALENDAR_PRESETS } from '../engine/model.js';
import { DowPicker, Field, Modal } from './ui.jsx';

const TABS = [
  ['employees', 'Employees'],
  ['pods', 'Pods'],
  ['brands', 'Brands & processes'],
  ['assignments', 'Assignments'],
  ['holidays', 'Public holidays'],
  ['catalog', 'Processes & shifts'],
  ['settings', 'Rules & settings'],
];

export default function SetupPage() {
  const [tab, setTab] = useState('employees');
  return (
    <div style={{ maxWidth: 1200 }}>
      <h2>Setup</h2>
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Everything the scheduler uses lives here. Changes apply immediately: the current roster is re-validated, and
        Regenerate builds a new plan from the updated rules.
      </p>
      <div className="tabs">
        {TABS.map(([id, l]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{l}</button>)}
      </div>
      {tab === 'employees' && <Employees />}
      {tab === 'pods' && <Pods />}
      {tab === 'brands' && <Brands />}
      {tab === 'assignments' && <Assignments />}
      {tab === 'holidays' && <Holidays />}
      {tab === 'catalog' && <Catalog />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}

const dows = (arr) => (arr || []).map((d) => DOW[d]).join(', ') || '—';

function confirmDelete(what) {
  return window.confirm(`Delete ${what}? Related assignments are removed too.`);
}

/* ---------------- Employees ---------------- */
function Employees() {
  const store = useStore();
  const { data } = store;
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const pod = (id) => data.pods.find((p) => p.id === id)?.name ?? '—';
  const assigned = (id) => {
    const svcs = data.assignments.filter((a) => a.employeeId === id && a.kind !== 'backup').map((a) => data.services.find((s) => s.id === a.serviceId)).filter(Boolean);
    return [...new Set(svcs.map((s) => data.brands.find((b) => b.id === s.brandId)?.name))].join(', ');
  };
  const list = data.employees.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.podId.localeCompare(b.podId) || a.name.localeCompare(b.name));
  const blank = { name: '', podId: data.pods[0]?.id, isLead: false, shiftId: 'GEN', skills: ['CS'], weeklyOffPref: [0], offsPerWeek: 1, maxCoversPerDay: 1, compOffBalance: 0, active: true };
  return (
    <div className="card">
      <div className="row card-pad">
        <input className="input" placeholder="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small grow">{data.employees.length} employees</span>
        <button className="btn primary" onClick={() => setEdit(blank)}>Add employee</button>
      </div>
      <table className="data">
        <thead><tr><th>Name</th><th>Pod</th><th>Shift</th><th>Skills</th><th>Preferred off</th><th>Offs/wk</th><th>Max covers/day</th><th>Brands</th><th /></tr></thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id} style={{ opacity: e.active === false ? 0.5 : 1 }}>
              <td><b>{e.name}</b>{e.isLead && <span className="badge brand" style={{ marginLeft: 6 }}>Lead</span>}{e.active === false && <span className="badge" style={{ marginLeft: 6 }}>inactive</span>}</td>
              <td>{pod(e.podId)}</td>
              <td>{e.shiftId || 'GEN'}</td>
              <td><div className="chips">{(e.skills || []).map((s) => <span key={s} className="badge">{s}</span>)}</div></td>
              <td>{dows(e.weeklyOffPref)}</td>
              <td>{e.offsPerWeek ?? 1}</td>
              <td>{e.maxCoversPerDay ?? 1}</td>
              <td className="small muted">{assigned(e.id) || (e.isLead ? 'Supervises pod' : '—')}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn sm ghost" onClick={() => setEdit(e)}>Edit</button>
                <button className="btn sm ghost danger" onClick={() => confirmDelete(e.name) && store.remove('employees', e.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && <EmployeeForm value={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EmployeeForm({ value, onClose }) {
  const store = useStore();
  const { data } = store;
  const [v, setV] = useState(value);
  const set = (k, x) => setV({ ...v, [k]: x });
  const toggleSkill = (p) => set('skills', v.skills.includes(p) ? v.skills.filter((x) => x !== p) : [...v.skills, p]);
  const save = () => {
    if (!v.name.trim()) return;
    store.upsert('employees', { ...v, offsPerWeek: Number(v.offsPerWeek), maxCoversPerDay: Number(v.maxCoversPerDay), compOffBalance: Number(v.compOffBalance) }, 'E');
    onClose();
  };
  return (
    <Modal title={value.id ? `Edit ${value.name}` : 'Add employee'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name"><input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Pod">
          <select className="input" value={v.podId} onChange={(e) => set('podId', e.target.value)}>
            {data.pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Shift">
          <select className="input" value={v.shiftId || 'GEN'} onChange={(e) => set('shiftId', e.target.value)}>
            {data.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}
          </select>
        </Field>
        <Field label="Weekly offs per week"><input type="number" min="0" max="3" className="input" value={v.offsPerWeek} onChange={(e) => set('offsPerWeek', e.target.value)} /></Field>
        <Field label="Max covers per day"><input type="number" min="0" max="5" className="input" value={v.maxCoversPerDay} onChange={(e) => set('maxCoversPerDay', e.target.value)} /></Field>
        <Field label="Comp-off balance"><input type="number" min="0" className="input" value={v.compOffBalance} onChange={(e) => set('compOffBalance', e.target.value)} /></Field>
      </div>
      <div className="col" style={{ marginTop: 12 }}>
        <Field label="Skills (processes they can do or cover)">
          <div className="chips">
            {data.processes.map((p) => (
              <button type="button" key={p.id} className={`btn sm ${v.skills.includes(p.id) ? 'primary' : ''}`} onClick={() => toggleSkill(p.id)}>{p.code}</button>
            ))}
          </div>
        </Field>
        <Field label="Preferred weekly-off day(s) — a preference, not a guarantee">
          <DowPicker value={v.weeklyOffPref} onChange={(x) => set('weeklyOffPref', x)} />
        </Field>
        <label className="row small"><input type="checkbox" checked={v.isLead} onChange={(e) => set('isLead', e.target.checked)} /> Pod lead</label>
        <label className="row small"><input type="checkbox" checked={v.active !== false} onChange={(e) => set('active', e.target.checked)} /> Active (inactive employees are left out of rosters)</label>
      </div>
    </Modal>
  );
}

/* ---------------- Pods ---------------- */
function Pods() {
  const store = useStore();
  const { data } = store;
  const [edit, setEdit] = useState(null);
  return (
    <div className="card">
      <div className="row card-pad"><span className="grow muted small">{data.pods.length} pods</span><button className="btn primary" onClick={() => setEdit({ name: '', leadId: '' })}>Add pod</button></div>
      <table className="data">
        <thead><tr><th>Pod</th><th>Lead</th><th>People</th><th>Brands</th><th /></tr></thead>
        <tbody>
          {data.pods.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b></td>
              <td>{data.employees.find((e) => e.id === p.leadId)?.name ?? <span className="badge warning">no lead</span>}</td>
              <td>{data.employees.filter((e) => e.podId === p.id).length}</td>
              <td className="small">{data.brands.filter((b) => b.podId === p.id).map((b) => b.name).join(', ')}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn sm ghost" onClick={() => setEdit(p)}>Edit</button>
                <button
                  className="btn sm ghost danger"
                  onClick={() => {
                    if (data.employees.some((e) => e.podId === p.id) || data.brands.some((b) => b.podId === p.id)) return window.alert('Move its employees and brands to another pod first.');
                    store.remove('pods', p.id);
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <SimpleForm
          title={edit.id ? `Edit ${edit.name}` : 'Add pod'}
          value={edit}
          onClose={() => setEdit(null)}
          onSave={(v) => store.upsert('pods', v, 'P')}
          fields={[
            ['name', 'Name', 'text'],
            ['leadId', 'Pod lead', 'select', [['', '—'], ...data.employees.filter((e) => !edit.id || e.podId === edit.id).map((e) => [e.id, e.name])]],
          ]}
        />
      )}
    </div>
  );
}

/* ---------------- Brands & services ---------------- */
function Brands() {
  const store = useStore();
  const { data } = store;
  const [editBrand, setEditBrand] = useState(null);
  const [editSvc, setEditSvc] = useState(null);
  const proc = (id) => data.processes.find((p) => p.id === id);
  const people = (sid) => data.assignments.filter((a) => a.serviceId === sid).map((a) => `${data.employees.find((e) => e.id === a.employeeId)?.name}${a.kind === 'backup' ? ' (backup)' : ''}`);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <span className="muted small grow">{data.brands.length} brands · {data.services.length} brand processes. Each brand process has its own operating calendar and minimum staffing.</span>
        <button className="btn primary" onClick={() => setEditBrand({ name: '', podId: data.pods[0]?.id })}>Add brand</button>
      </div>
      {data.pods.map((pod) => (
        <div key={pod.id} className="card">
          <div className="card-pad"><h3>{pod.name}</h3></div>
          <table className="data">
            <thead><tr><th style={{ width: 160 }}>Brand</th><th>Process</th><th>Operates</th><th>Min staff</th><th>Overrides</th><th>Shift</th><th>People</th><th /></tr></thead>
            <tbody>
              {data.brands.filter((b) => b.podId === pod.id).map((b) => {
                const svcs = data.services.filter((s) => s.brandId === b.id);
                return svcs.length === 0 ? (
                  <tr key={b.id}>
                    <td><b>{b.name}</b></td>
                    <td colSpan={6} className="muted">No processes yet</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><BrandButtons b={b} onEdit={setEditBrand} onAdd={setEditSvc} /></td>
                  </tr>
                ) : (
                  svcs.map((s, i) => (
                    <tr key={s.id} style={{ opacity: s.active === false ? 0.5 : 1 }}>
                      {i === 0 && <td rowSpan={svcs.length}><b>{b.name}</b><div style={{ marginTop: 6 }}><BrandButtons b={b} onEdit={setEditBrand} onAdd={setEditSvc} /></div></td>}
                      <td><span className="badge">{proc(s.processId)?.code}</span> <span className="small muted">{proc(s.processId)?.name}</span></td>
                      <td className="small">{CALENDAR_PRESETS[s.calendar?.preset]?.label ?? `Custom: ${dows(s.calendar?.days)}${s.calendar?.holidaysOff ? ', holidays off' : ''}`}</td>
                      <td>{s.minStaff}</td>
                      <td className="small">
                        {Object.entries(s.dowOverrides || {}).map(([d, n]) => `${DOW[d]}: ${n}`).concat(Object.entries(s.dateOverrides || {}).map(([d, n]) => `${d}: ${n}`)).join(' · ') || '—'}
                      </td>
                      <td>{s.shiftId || 'GEN'}</td>
                      <td className="small">{people(s.id).join(', ') || <span className="badge error">nobody</span>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn sm ghost" onClick={() => setEditSvc(s)}>Edit</button>
                        <button className="btn sm ghost danger" onClick={() => confirmDelete(`${b.name} ${proc(s.processId)?.code}`) && store.remove('services', s.id)}>Delete</button>
                      </td>
                    </tr>
                  ))
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {editBrand && (
        <SimpleForm
          title={editBrand.id ? `Edit ${editBrand.name}` : 'Add brand'}
          value={editBrand}
          onClose={() => setEditBrand(null)}
          onSave={(v) => store.upsert('brands', v, 'B')}
          fields={[['name', 'Brand name', 'text'], ['podId', 'Pod', 'select', data.pods.map((p) => [p.id, p.name])]]}
        />
      )}
      {editSvc && <ServiceForm value={editSvc} onClose={() => setEditSvc(null)} />}
    </div>
  );
}

function BrandButtons({ b, onEdit, onAdd }) {
  const store = useStore();
  return (
    <span className="row" style={{ gap: 2 }}>
      <button className="btn sm ghost" onClick={() => onEdit(b)}>Rename</button>
      <button
        className="btn sm ghost"
        onClick={() => onAdd({ brandId: b.id, processId: store.data.processes[0]?.id, shiftId: 'GEN', minStaff: 1, calendar: { preset: 'MON_SAT_NO_PH', ...structuredClone(CALENDAR_PRESETS.MON_SAT_NO_PH) }, dowOverrides: {}, dateOverrides: {}, active: true })}
      >
        + Process
      </button>
      <button className="btn sm ghost danger" onClick={() => confirmDelete(b.name) && store.remove('brands', b.id)}>Delete</button>
    </span>
  );
}

function ServiceForm({ value, onClose }) {
  const store = useStore();
  const { data } = store;
  const [v, setV] = useState(structuredClone(value));
  const [od, setOd] = useState({ date: '', n: 2 });
  const brand = data.brands.find((b) => b.id === v.brandId);
  const set = (k, x) => setV({ ...v, [k]: x });
  const setCal = (patch) => setV({ ...v, calendar: { ...v.calendar, ...patch } });
  const save = () => {
    const id = v.id || `${v.brandId}-${v.processId}`;
    if (!value.id && data.services.some((s) => s.id === id)) return window.alert(`${brand?.name} already has this process.`);
    store.upsert('services', { ...v, id, minStaff: Number(v.minStaff) });
    onClose();
  };
  return (
    <Modal wide title={`${brand?.name} · ${value.id ? 'edit process' : 'add process'}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Process">
          <select className="input" value={v.processId} disabled={Boolean(value.id)} onChange={(e) => set('processId', e.target.value)}>
            {data.processes.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Minimum staff on operating days"><input type="number" min="0" className="input" value={v.minStaff} onChange={(e) => set('minStaff', e.target.value)} /></Field>
        <Field label="Shift">
          <select className="input" value={v.shiftId || 'GEN'} onChange={(e) => set('shiftId', e.target.value)}>
            {data.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}
          </select>
        </Field>
      </div>
      <h4 style={{ margin: '16px 0 8px' }}>Operating calendar</h4>
      <div className="col">
        <select
          className="input"
          value={v.calendar?.preset || 'CUSTOM'}
          onChange={(e) => {
            const p = e.target.value;
            if (p === 'CUSTOM') setCal({ preset: null });
            else setCal({ preset: p, ...structuredClone(CALENDAR_PRESETS[p]) });
          }}
        >
          {Object.entries(CALENDAR_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          <option value="CUSTOM">Custom…</option>
        </select>
        <div className="row">
          <DowPicker value={v.calendar?.days || []} onChange={(days) => setCal({ days, preset: null })} />
          <label className="row small"><input type="checkbox" checked={Boolean(v.calendar?.holidaysOff)} onChange={(e) => setCal({ holidaysOff: e.target.checked, preset: null })} /> Closed on public holidays</label>
        </div>
      </div>
      <h4 style={{ margin: '16px 0 8px' }}>Minimum staff by weekday (blank = use default)</h4>
      <div className="row">
        {DOW.map((n, d) => (
          <Field key={n} label={n} style={{ width: 62 }}>
            <input
              className="input"
              type="number"
              min="0"
              value={v.dowOverrides?.[d] ?? ''}
              onChange={(e) => {
                const o = { ...(v.dowOverrides || {}) };
                if (e.target.value === '') delete o[d];
                else o[d] = Number(e.target.value);
                set('dowOverrides', o);
              }}
            />
          </Field>
        ))}
      </div>
      <h4 style={{ margin: '16px 0 8px' }}>Specific-date requirements (sales, launches)</h4>
      <div className="chips" style={{ marginBottom: 8 }}>
        {Object.entries(v.dateOverrides || {}).map(([d, n]) => (
          <span key={d} className="badge brand">
            {d}: {n}
            <button style={{ all: 'unset', cursor: 'pointer', marginLeft: 4 }} onClick={() => { const o = { ...v.dateOverrides }; delete o[d]; set('dateOverrides', o); }}>✕</button>
          </span>
        ))}
      </div>
      <div className="row">
        <input type="date" className="input" value={od.date} onChange={(e) => setOd({ ...od, date: e.target.value })} />
        <input type="number" min="0" className="input" style={{ width: 70 }} value={od.n} onChange={(e) => setOd({ ...od, n: e.target.value })} />
        <button className="btn sm" disabled={!od.date} onClick={() => set('dateOverrides', { ...(v.dateOverrides || {}), [od.date]: Number(od.n) })}>Add date</button>
      </div>
      <label className="row small" style={{ marginTop: 12 }}><input type="checkbox" checked={v.active !== false} onChange={(e) => set('active', e.target.checked)} /> Active</label>
    </Modal>
  );
}

/* ---------------- Assignments ---------------- */
function Assignments() {
  const store = useStore();
  const { data } = store;
  const [brandId, setBrandId] = useState('');
  const [add, setAdd] = useState({ employeeId: '', serviceId: '', kind: 'primary' });
  const svcName = (s) => `${data.brands.find((b) => b.id === s.brandId)?.name} · ${data.processes.find((p) => p.id === s.processId)?.code}`;
  const services = data.services.filter((s) => !brandId || s.brandId === brandId).sort((a, b) => svcName(a).localeCompare(svcName(b)));
  const emps = [...data.employees].sort((a, b) => a.name.localeCompare(b.name));
  const list = data.assignments.filter((a) => services.some((s) => s.id === a.serviceId));
  const doAdd = () => {
    if (!add.employeeId || !add.serviceId) return;
    if (data.assignments.some((a) => a.employeeId === add.employeeId && a.serviceId === add.serviceId)) return window.alert('Already assigned.');
    store.upsert('assignments', add, 'A');
  };
  return (
    <div className="card">
      <div className="card-pad col">
        <div className="small muted">
          A <b>primary</b> assignment means the person delivers that brand process and counts toward its coverage. A <b>backup</b> is the first person suggested when cover is needed.
        </div>
        <div className="row">
          <select className="input" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">All brands</option>
            {data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span className="grow" />
          <select className="input" value={add.employeeId} onChange={(e) => setAdd({ ...add, employeeId: e.target.value })}>
            <option value="">Employee…</option>
            {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select className="input" value={add.serviceId} onChange={(e) => setAdd({ ...add, serviceId: e.target.value })}>
            <option value="">Brand process…</option>
            {services.map((s) => <option key={s.id} value={s.id}>{svcName(s)}</option>)}
          </select>
          <select className="input" value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}>
            <option value="primary">Primary</option>
            <option value="backup">Backup</option>
          </select>
          <button className="btn primary" onClick={doAdd}>Assign</button>
        </div>
      </div>
      <table className="data">
        <thead><tr><th>Brand process</th><th>Employee</th><th>Role</th><th>Skill check</th><th /></tr></thead>
        <tbody>
          {list.map((a) => {
            const s = data.services.find((x) => x.id === a.serviceId);
            const e = data.employees.find((x) => x.id === a.employeeId);
            const skilled = e?.skills?.includes(s.processId);
            return (
              <tr key={a.id}>
                <td>{svcName(s)}</td>
                <td>{e?.name}</td>
                <td>
                  <select className="input" value={a.kind} onChange={(ev) => store.upsert('assignments', { ...a, kind: ev.target.value })}>
                    <option value="primary">Primary</option>
                    <option value="backup">Backup</option>
                  </select>
                </td>
                <td>{skilled ? <span className="badge ok">has skill</span> : <span className="badge warning">missing {s.processId} skill</span>}</td>
                <td style={{ textAlign: 'right' }}><button className="btn sm ghost danger" onClick={() => store.remove('assignments', a.id)}>Remove</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Holidays ---------------- */
function Holidays() {
  const store = useStore();
  const [h, setH] = useState({ date: '', name: '' });
  const list = [...store.data.holidays].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="card">
      <div className="row card-pad">
        <input type="date" className="input" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} />
        <input className="input" placeholder="Holiday name" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
        <button className="btn primary" disabled={!h.date || !h.name} onClick={() => { store.upsert('holidays', h, 'H'); setH({ date: '', name: '' }); }}>Add holiday</button>
        <span className="small muted">Processes marked "closed on public holidays" don't operate; 365-day processes still need cover.</span>
      </div>
      <table className="data">
        <thead><tr><th>Date</th><th>Name</th><th /></tr></thead>
        <tbody>
          {list.map((x) => (
            <tr key={x.id}><td className="mono">{x.date}</td><td>{x.name}</td><td style={{ textAlign: 'right' }}><button className="btn sm ghost danger" onClick={() => store.remove('holidays', x.id)}>Remove</button></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Processes & shifts ---------------- */
function Catalog() {
  const store = useStore();
  const { data } = store;
  const [p, setP] = useState({ code: '', name: '' });
  const [s, setS] = useState({ id: '', name: '', start: '09:00', end: '18:00' });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
      <div className="card">
        <div className="card-pad"><h3>Processes</h3></div>
        <table className="data">
          <thead><tr><th>Code</th><th>Name</th><th>Brands</th><th /></tr></thead>
          <tbody>
            {data.processes.map((x) => (
              <tr key={x.id}>
                <td><b>{x.code}</b></td><td>{x.name}</td><td>{data.services.filter((sv) => sv.processId === x.id).length}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm ghost danger" onClick={() => (data.services.some((sv) => sv.processId === x.id) ? window.alert('Used by brands; remove those first.') : store.remove('processes', x.id))}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row card-pad">
          <input className="input" style={{ width: 90 }} placeholder="Code" value={p.code} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase() })} />
          <input className="input grow" placeholder="Name, e.g. COD verification" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          <button className="btn primary" disabled={!p.code || !p.name || data.processes.some((x) => x.id === p.code)} onClick={() => { store.upsert('processes', { id: p.code, ...p }); setP({ code: '', name: '' }); }}>Add</button>
        </div>
      </div>
      <div className="card">
        <div className="card-pad"><h3>Shifts</h3><div className="small muted">An employee only covers processes on their own shift.</div></div>
        <table className="data">
          <thead><tr><th>Id</th><th>Name</th><th>Hours</th><th /></tr></thead>
          <tbody>
            {data.shifts.map((x) => (
              <tr key={x.id}>
                <td><b>{x.id}</b></td><td>{x.name}</td><td>{x.start}–{x.end}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm ghost danger" disabled={x.id === 'GEN'} onClick={() => store.remove('shifts', x.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row card-pad">
          <input className="input" style={{ width: 80 }} placeholder="Id" value={s.id} onChange={(e) => setS({ ...s, id: e.target.value.toUpperCase() })} />
          <input className="input grow" placeholder="Name" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          <input type="time" className="input" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} />
          <input type="time" className="input" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} />
          <button className="btn primary" disabled={!s.id || !s.name || data.shifts.some((x) => x.id === s.id)} onClick={() => { store.upsert('shifts', s); setS({ id: '', name: '', start: '09:00', end: '18:00' }); }}>Add</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Settings ---------------- */
function Settings() {
  const store = useStore();
  const st = store.data.settings;
  const num = (k) => (e) => store.setSettings({ [k]: Number(e.target.value) });
  return (
    <div className="card card-pad col" style={{ gap: 14, maxWidth: 720 }}>
      <Field label="Company working days (for people without a brand assignment, e.g. pod leads)">
        <div className="row">
          <DowPicker value={st.companyCalendar.days} onChange={(days) => store.setSettings({ companyCalendar: { ...st.companyCalendar, days } })} />
          <label className="row small"><input type="checkbox" checked={st.companyCalendar.holidaysOff} onChange={(e) => store.setSettings({ companyCalendar: { ...st.companyCalendar, holidaysOff: e.target.checked } })} /> Public holidays off</label>
        </div>
      </Field>
      <div className="form-grid">
        <Field label="Default weekly offs per employee"><input type="number" min="0" max="3" className="input" value={st.offsPerWeek} onChange={num('offsPerWeek')} /></Field>
        <Field label="Default max covers per day"><input type="number" min="0" max="5" className="input" value={st.maxCoversPerDay} onChange={num('maxCoversPerDay')} /></Field>
        <Field label="Max consecutive working days"><input type="number" min="3" max="14" className="input" value={st.maxConsecutiveWorkDays} onChange={num('maxConsecutiveWorkDays')} /></Field>
      </div>
      <label className="row small">
        <input type="checkbox" checked={st.autoCover} onChange={(e) => store.setSettings({ autoCover: e.target.checked })} />
        Let the generator assign cross-covers automatically (off = it only flags gaps and you choose covers)
      </label>
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
      <div className="row">
        <div className="grow small muted">Restore the 32-employee sample dataset and regenerate December 2026. This replaces all current data.</div>
        <button className="btn danger" onClick={() => window.confirm('Replace all data with the sample dataset?') && store.reset()}>Reset sample data</button>
      </div>
    </div>
  );
}

/* ---------------- Generic small form ---------------- */
function SimpleForm({ title, value, fields, onSave, onClose }) {
  const [v, setV] = useState(value);
  const save = () => { onSave(v); onClose(); };
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col">
        {fields.map(([k, label, type, opts]) => (
          <Field key={k} label={label}>
            {type === 'select' ? (
              <select className="input" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })}>
                {opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
              </select>
            ) : (
              <input className="input" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}
