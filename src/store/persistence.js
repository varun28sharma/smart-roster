// Persistence adapters. Same interface: load() -> state | null, save(state).
//   - local:    browser localStorage (zero setup; used when Supabase env is absent)
//   - supabase: normalized Postgres tables (supabase/schema.sql), diff-synced

import { createClient } from '@supabase/supabase-js';

const LS_KEY = 'smart-roster:v1';

export const localAdapter = {
  name: 'local',
  async load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async save(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ data: state.data, rosters: state.rosters }));
    } catch {
      /* storage full or blocked: app keeps working in memory */
    }
  },
  async clear() {
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  },
};

// table name -> key in state.data; order matters for foreign keys (parents first)
const TABLES = [
  ['processes', 'processes'],
  ['shifts', 'shifts'],
  ['pods', 'pods'],
  ['employees', 'employees'],
  ['brands', 'brands'],
  ['services', 'services'],
  ['assignments', 'assignments'],
  ['holidays', 'holidays'],
  ['leaves', 'leaves'],
];

const toSnake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const mapKeys = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));

export function createSupabaseAdapter(url, key) {
  const db = createClient(url, key);
  const synced = new Map(); // `${table}` -> Map(id -> json)

  const remember = (table, rows, idKey = 'id') => {
    synced.set(table, new Map(rows.map((r) => [r[idKey], JSON.stringify(r)])));
  };

  async function syncTable(table, rows, idKey = 'id') {
    const prev = synced.get(table) || new Map();
    const changed = rows.filter((r) => prev.get(r[idKey]) !== JSON.stringify(r));
    const ids = new Set(rows.map((r) => r[idKey]));
    const removed = [...prev.keys()].filter((id) => !ids.has(id));
    if (changed.length) {
      const { error } = await db.from(table).upsert(changed.map((r) => mapKeys(r, toSnake)));
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    if (removed.length) {
      const { error } = await db.from(table).delete().in(toSnake(idKey), removed);
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    remember(table, rows, idKey);
  }

  return {
    name: 'supabase',
    async load() {
      const data = {};
      for (const [table, key] of TABLES) {
        const { data: rows, error } = await db.from(table).select('*');
        if (error) throw new Error(`${table}: ${error.message}`);
        data[key] = rows.map((r) => mapKeys(r, toCamel));
        remember(table, data[key]);
      }
      const { data: s } = await db.from('app_settings').select('*').eq('id', 'default').maybeSingle();
      data.settings = s?.data || null;
      synced.set('app_settings', s ? JSON.stringify(s.data) : null);
      const { data: rs, error: re } = await db.from('rosters').select('*');
      if (re) throw new Error(`rosters: ${re.message}`);
      const rosters = Object.fromEntries((rs || []).map((r) => [r.month, r.data]));
      remember('rosters', (rs || []).map((r) => ({ month: r.month, data: r.data })), 'month');
      if (!data.employees.length) return null; // empty database -> caller seeds sample data
      return { data, rosters };
    },
    async save(state) {
      // parents first for upserts, children first for deletes is handled by cascade rules
      for (const [table, key] of TABLES) await syncTable(table, state.data[key] || []);
      const settingsJson = JSON.stringify(state.data.settings);
      if (synced.get('app_settings') !== settingsJson) {
        const { error } = await db.from('app_settings').upsert({ id: 'default', data: state.data.settings });
        if (error) throw new Error(`settings: ${error.message}`);
        synced.set('app_settings', settingsJson);
      }
      await syncTable(
        'rosters',
        Object.entries(state.rosters).map(([month, data]) => ({ month, data })),
        'month',
      );
    },
    async clear() {
      for (const [table] of [...TABLES].reverse()) {
        await db.from(table).delete().neq('id', '__none__');
        synced.delete(table);
      }
      await db.from('rosters').delete().neq('month', '__none__');
      synced.delete('rosters');
    },
  };
}

export function pickAdapter() {
  const url = import.meta.env?.VITE_SUPABASE_URL;
  const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  return url && key ? createSupabaseAdapter(url, key) : localAdapter;
}
