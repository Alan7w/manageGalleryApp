// The library index: one SQLite file in the app's data folder that remembers
// every photo we've seen and what we learned about it, so re-opening the app
// (or re-scanning a 100k-photo drive) only has to look at what changed.

import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { join } from 'node:path'
import { dataDir } from './paths'

const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE sources (
    id           INTEGER PRIMARY KEY,
    path         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    added_at     INTEGER NOT NULL,
    last_scan_at INTEGER,
    is_primary   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE media (
    id               INTEGER PRIMARY KEY,
    source_id        INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    path             TEXT NOT NULL UNIQUE,
    dir              TEXT NOT NULL,
    name             TEXT NOT NULL,
    ext              TEXT NOT NULL,
    kind             TEXT NOT NULL,             -- image | video
    size             INTEGER NOT NULL,
    mtime            INTEGER NOT NULL,
    btime            INTEGER,
    scan_gen         INTEGER NOT NULL DEFAULT 0,
    state            TEXT NOT NULL DEFAULT 'pending', -- pending | ready | error | trashed
    level            INTEGER NOT NULL DEFAULT 0,      -- 0 none · 1 basic · 2 with Vision
    error            TEXT,
    width            INTEGER,
    height           INTEGER,
    taken_at         INTEGER,                   -- EXIF capture time (ms)
    camera           TEXT,
    lat              REAL,
    lon              REAL,
    duration         REAL,
    user_comment     TEXT,
    has_camera       INTEGER,
    dhash            TEXT,
    sharpness        REAL,
    global_sharpness REAL,
    brightness       REAL,
    contrast         REAL,
    clipped          REAL,
    aesthetic        REAL,
    is_utility       INTEGER,
    face_count       INTEGER,
    face_quality     REAL,
    feature          BLOB,                      -- int8 Vision feature print
    labels           TEXT,                      -- JSON [[label, confidence], …]
    label_text       TEXT,                      -- space-separated labels, for search
    sha              TEXT,
    flagged          INTEGER NOT NULL DEFAULT 0,
    kept             INTEGER NOT NULL DEFAULT 0,
    flagged_at       INTEGER
  );
  CREATE INDEX media_source ON media(source_id);
  CREATE INDEX media_state ON media(state);
  CREATE INDEX media_size ON media(size);
  CREATE INDEX media_sha ON media(sha) WHERE sha IS NOT NULL;
  CREATE INDEX media_flagged ON media(flagged) WHERE flagged = 1;

  CREATE TABLE trash_log (
    id            INTEGER PRIMARY KEY,
    batch_id      TEXT NOT NULL,
    media_id      INTEGER NOT NULL,
    original_path TEXT NOT NULL,
    trashed_path  TEXT,
    method        TEXT NOT NULL,                -- trash | folder
    size          INTEGER NOT NULL,
    trashed_at    INTEGER NOT NULL,
    restored_at   INTEGER
  );
  CREATE INDEX trash_batch ON trash_log(batch_id);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]

let db: DatabaseSync
const statements = new Map<string, StatementSync>()

export function openDatabase(file = join(dataDir(), 'library.db')): void {
  db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -65536;
  `)
  const { user_version: version } = get<{ user_version: number }>('PRAGMA user_version')!
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(() => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

export function closeDatabase(): void {
  statements.clear()
  db?.close()
}

function prepared(sql: string): StatementSync {
  let stmt = statements.get(sql)
  if (!stmt) {
    stmt = db.prepare(sql)
    statements.set(sql, stmt)
  }
  return stmt
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return prepared(sql).all(...params) as T[]
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return prepared(sql).get(...params) as T | undefined
}

export function run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
  const r = prepared(sql).run(...params)
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
}

export function exec(sql: string): void {
  db.exec(sql)
}

let depth = 0
/** Runs `fn` inside a transaction (nested calls join the outer one). */
export function transaction<T>(fn: () => T): T {
  if (depth > 0) return fn()
  depth++
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  } finally {
    depth--
  }
}

/** Binds a list of ids as `(?, ?, …)` for IN clauses. */
export function placeholders(n: number): string {
  return `(${new Array(n).fill('?').join(',')})`
}

/** Runs `fn` over `ids` in chunks small enough for SQLite's parameter limit. */
export function chunked<T>(ids: number[], fn: (chunk: number[]) => T[] | void, size = 500): T[] {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += size) {
    const r = fn(ids.slice(i, i + size))
    if (r) out.push(...r)
  }
  return out
}
