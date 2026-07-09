// better-sqlite3-compatible adapter over node-sqlite3-wasm.
//
// Why: better-sqlite3 is a native C++ addon. It fails to install on hosts
// without build tools / a modern glibc (e.g. shared hosting). node-sqlite3-wasm
// is a pure-WebAssembly SQLite that needs no compilation and persists to disk
// via a Node fs-backed VFS, so it runs anywhere Node runs.
//
// This shim exposes the small slice of the better-sqlite3 API that db.js uses
// (`prepare().run/get/all/iterate`, `exec`, `pragma`, `close`) and bridges the
// two API differences: node-sqlite3-wasm wants prefixed named-param keys
// (`@id`) and requires explicit statement finalization.
import pkg from "node-sqlite3-wasm";
const { Database: WasmDatabase } = pkg;

// node-sqlite3-wasm only accepts numbers/bigint/string/Uint8Array/null. Map the
// JS values better-sqlite3 tolerates (booleans, undefined) onto those.
function coerce(v) {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// Which named-parameter sigil this statement uses. db.js uses "@name"; we still
// detect ":"/"$" defensively. Only consulted when a single object is bound.
function detectPrefix(sql) {
  if (/@\w/.test(sql)) return "@";
  if (/:\w/.test(sql)) return ":";
  if (/\$\w/.test(sql)) return "$";
  return "@";
}

// Translate better-sqlite3 call args → a node-sqlite3-wasm BindValues argument.
//   .run(a, b, c)      → [a, b, c]           (positional "?")
//   .run([a, b])       → [a, b]              (positional "?")
//   .run({ id, title })→ { "@id", "@title" } (named, prefixed)
//   .run(value)        → value               (single positional)
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

// better-sqlite3 returns lastInsertRowid as a Number where it fits.
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
  // better-sqlite3 yields `undefined` (not null) when no row matches.
  get(...args) { return this._stmt.get(toBind(this._sql, args)) ?? undefined; }
  all(...args) { return this._stmt.all(toBind(this._sql, args)); }
  *iterate(...args) { yield* this._stmt.iterate(toBind(this._sql, args)); }
}

export default class Database {
  constructor(filename, options) {
    this._wasm = new WasmDatabase(filename, options);
    this._statements = [];
    // Statements are cached and reused for the life of the process, then
    // finalized in close() — node-sqlite3-wasm needs manual finalization.
    this._cache = new Map();
  }

  prepare(sql) {
    let stmt = this._cache.get(sql);
    if (!stmt) { stmt = new Statement(this, sql); this._cache.set(sql, stmt); }
    return stmt;
  }

  exec(sql) { this._wasm.exec(sql); return this; }

  // The wasm VFS has no shared memory, so WAL is unsupported — opening or
  // switching a WAL database fails. Ignore journal_mode changes (the default
  // rollback journal persists fine on disk) and swallow other unsupported
  // pragmas instead of crashing.
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
