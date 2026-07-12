// better-sqlite3-compatible adapter over node-sqlite3-wasm.
import pkg from "node-sqlite3-wasm";
const { Database: WasmDatabase } = pkg;

function coerce(v) {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

function detectPrefix(sql) {
  if (/@\w/.test(sql)) return "@";
  if (/:\w/.test(sql)) return ":";
  if (/\$\w/.test(sql)) return "$";
  return "@";
}

function toBind(sql, args) {
  if (args.length === 0) return undefined;
  if (args.length === 1) {
    const a = args[0];
    const isPlainObject =
      a !== null && typeof a === "object" && !Array.isArray(a) && !(a instanceof Uint8Array);
    if (isPlainObject) {
      const prefix = detectPrefix(sql);
      const out = {};
      for (const [k, v] of Object.entries(a)) {
        out[k.startsWith(prefix) ? k : prefix + k] = coerce(v);
      }
      return out;
    }
    if (Array.isArray(a)) return a.map(coerce);
    return coerce(a);
  }
  return args.map(coerce);
}

function normalizeInfo(info) {
  let rowid = info.lastInsertRowid;
  if (typeof rowid === "bigint" && rowid <= BigInt(Number.MAX_SAFE_INTEGER)) rowid = Number(rowid);
  return { changes: info.changes, lastInsertRowid: rowid };
}

class Statement {
  constructor(db, sql) {
    this._sql = sql;
    this._stmt = db._wasm.prepare(sql);
    db._statements.push(this._stmt);
  }
  run(...args) { return normalizeInfo(this._stmt.run(toBind(this._sql, args))); }
  get(...args) { return this._stmt.get(toBind(this._sql, args)) ?? undefined; }
  all(...args) { return this._stmt.all(toBind(this._sql, args)); }
  *iterate(...args) { yield* this._stmt.iterate(toBind(this._sql, args)); }
}

export default class Database {
  constructor(filename, options) {
    this._wasm = new WasmDatabase(filename, options);
    this._statements = [];
    this._cache = new Map();
  }

  prepare(sql) {
    let stmt = this._cache.get(sql);
    if (!stmt) { stmt = new Statement(this, sql); this._cache.set(sql, stmt); }
    return stmt;
  }

  exec(sql) { this._wasm.exec(sql); return this; }

  pragma(statement) {
    if (/journal_mode/i.test(statement)) return;
    try { this._wasm.exec(`PRAGMA ${statement}`); } catch { /* unsupported on wasm VFS */ }
  }

  close() {
    for (const stmt of this._statements) { try { stmt.finalize(); } catch { /* already gone */ } }
    this._statements = [];
    this._cache.clear();
    this._wasm.close();
  }
}
