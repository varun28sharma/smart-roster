import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { createSampleData, SAMPLE_MONTH } from '../data/sampleData.js';
import { generateRoster } from '../engine/generator.js';
import { validateRoster } from '../engine/validator.js';
import { applyActions, emptyRoster, newId } from '../engine/rosterState.js';
import { snapshot } from '../engine/changes.js';
import { pickAdapter } from './persistence.js';

const Ctx = createContext(null);
const adapter = pickAdapter();

const initial = {
  loaded: false,
  data: createSampleData(),
  rosters: {},
  month: SAMPLE_MONTH,
  saveState: 'idle', // idle | saving | saved | error
  saveError: null,
  history: [], // undo stack of rosters for the current month
};

function reducer(state, a) {
  switch (a.type) {
    case 'LOADED':
      return { ...state, loaded: true, data: a.data, rosters: a.rosters };
    case 'SET_MONTH':
      return { ...state, month: a.month, history: [] };
    case 'UPSERT': {
      const list = state.data[a.table] || [];
      const exists = list.some((x) => x.id === a.row.id);
      const row = exists ? a.row : { ...a.row, id: a.row.id || newId(a.prefix || 'X') };
      const next = exists ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];
      return { ...state, data: { ...state.data, [a.table]: next } };
    }
    case 'REMOVE': {
      const data = { ...state.data, [a.table]: state.data[a.table].filter((x) => x.id !== a.id) };
      // cascade: removing a service/employee drops its assignments; a brand drops its services
      if (a.table === 'brands') {
        const gone = new Set(data.services.filter((s) => s.brandId === a.id).map((s) => s.id));
        data.services = data.services.filter((s) => !gone.has(s.id));
        data.assignments = data.assignments.filter((x) => !gone.has(x.serviceId));
      }
      if (a.table === 'services') data.assignments = data.assignments.filter((x) => x.serviceId !== a.id);
      if (a.table === 'employees') {
        data.assignments = data.assignments.filter((x) => x.employeeId !== a.id);
        data.leaves = data.leaves.filter((x) => x.employeeId !== a.id);
      }
      return { ...state, data };
    }
    case 'SETTINGS':
      return { ...state, data: { ...state.data, settings: { ...state.data.settings, ...a.patch } } };
    case 'SET_ROSTER': {
      const prev = state.rosters[a.roster.month];
      const history = a.undoable && prev ? [...state.history, prev].slice(-30) : state.history;
      return { ...state, rosters: { ...state.rosters, [a.roster.month]: a.roster }, history };
    }
    case 'UNDO': {
      const prev = state.history[state.history.length - 1];
      if (!prev) return state;
      return { ...state, rosters: { ...state.rosters, [prev.month]: prev }, history: state.history.slice(0, -1) };
    }
    case 'SAVE_STATE':
      return { ...state, saveState: a.saveState, saveError: a.error || null };
    case 'RESET':
      return { ...state, data: createSampleData(), rosters: {}, month: SAMPLE_MONTH, history: [] };
    default:
      return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const timer = useRef();

  useEffect(() => {
    let alive = true;
    adapter
      .load()
      .then((saved) => {
        if (!alive) return;
        if (saved?.data) {
          dispatch({ type: 'LOADED', data: { ...createSampleData(), ...saved.data, settings: saved.data.settings || createSampleData().settings }, rosters: saved.rosters || {} });
        } else {
          // First run: seed sample data and generate the sample month so the app opens on a real roster.
          const data = createSampleData();
          dispatch({ type: 'LOADED', data, rosters: { [SAMPLE_MONTH]: generateRoster(data, SAMPLE_MONTH) } });
        }
      })
      .catch((err) => {
        console.error(err);
        const data = createSampleData();
        dispatch({ type: 'LOADED', data, rosters: { [SAMPLE_MONTH]: generateRoster(data, SAMPLE_MONTH) } });
        dispatch({ type: 'SAVE_STATE', saveState: 'error', error: `Could not load from ${adapter.name}: ${err.message}` });
      });
    return () => { alive = false; };
  }, []);

  // Debounced autosave
  useEffect(() => {
    if (!state.loaded) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      dispatch({ type: 'SAVE_STATE', saveState: 'saving' });
      try {
        await adapter.save(state);
        dispatch({ type: 'SAVE_STATE', saveState: 'saved' });
      } catch (err) {
        console.error(err);
        dispatch({ type: 'SAVE_STATE', saveState: 'error', error: err.message });
      }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [state.data, state.rosters, state.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const roster = state.rosters[state.month] || null;
  const validation = useMemo(
    () => validateRoster(state.data, roster || emptyRoster(state.month)),
    [state.data, roster, state.month],
  );

  const api = useMemo(() => {
    const getRoster = () => roster || emptyRoster(state.month);
    return {
      setMonth: (month) => dispatch({ type: 'SET_MONTH', month }),
      upsert: (table, row, prefix) => dispatch({ type: 'UPSERT', table, row, prefix }),
      remove: (table, id) => dispatch({ type: 'REMOVE', table, id }),
      setSettings: (patch) => dispatch({ type: 'SETTINGS', patch }),
      generate: () => dispatch({ type: 'SET_ROSTER', roster: generateRoster(state.data, state.month, roster), undoable: true }),
      applyActions: (actions) => dispatch({ type: 'SET_ROSTER', roster: applyActions(getRoster(), actions), undoable: true }),
      publish: () => {
        const r = getRoster();
        dispatch({ type: 'SET_ROSTER', roster: { ...r, published: snapshot(state.data, r) }, undoable: true });
      },
      undo: () => dispatch({ type: 'UNDO' }),
      reset: async () => {
        await adapter.clear?.();
        dispatch({ type: 'RESET' });
        const data = createSampleData();
        dispatch({ type: 'SET_ROSTER', roster: generateRoster(data, SAMPLE_MONTH) });
      },
    };
  }, [state.data, state.month, roster]);

  const value = useMemo(
    () => ({ ...state, roster, validation, backend: adapter.name, canUndo: state.history.length > 0, ...api }),
    [state, roster, validation, api],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
export const useIdx = () => useStore().validation.st.idx;
