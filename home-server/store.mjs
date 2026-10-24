import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { validateHomeRow } from '../shared/home-protocol.mjs'

export const digest = token => createHash('sha256').update(token).digest('hex')
export class HomeStore {
  constructor(file) {
    this.db = new DatabaseSync(file)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL, changed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
    if (!this.db.prepare('SELECT value FROM metadata WHERE key=?').get('id')) this.db.prepare('INSERT INTO metadata VALUES (?,?)').run('id', randomBytes(16).toString('hex'))
    this.id = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('id').value
    this.renewCode()
    this.attempts = new Map()
  }
  renewCode() { this.code = String(randomInt(10000000, 100000000)); this.codeExpires = Date.now() + 10 * 60 * 1000; return this.code }
  pair(code, name, address) {
    const now = Date.now(), attempt = this.attempts.get(address)
    if (attempt && attempt.until > now && attempt.count >= 5) throw Object.assign(new Error('Too many attempts. Try again in a minute.'), { status: 429 })
    if (typeof code !== 'string' || digest(code.replace(/\s/g, '')) !== digest(this.code) || now > this.codeExpires) {
      if (this.attempts.size > 1000) this.attempts.clear()
      this.attempts.set(address, { count: attempt?.until > now ? attempt.count + 1 : 1, until: now + 60000 })
      throw Object.assign(new Error('Code incorrect or expired. Run start again to show a new code.'), { status: 401 })
    }
    if (this.devices().length >= 50) throw new Error('Remove an old paired device before adding another.')
    const token = randomBytes(32).toString('base64url'), id = randomBytes(12).toString('hex')
    this.db.prepare('INSERT INTO devices VALUES (?,?,?,?)').run(id, digest(token), String(name || 'Household device').slice(0, 80), now)
    this.attempts.delete(address)
    return { token, id, homeId: this.id }
  }
  authorize(token) { return typeof token === 'string' && token.length <= 100 ? this.db.prepare('SELECT id, name FROM devices WHERE hash=?').get(digest(token)) : undefined }
  devices() { return this.db.prepare('SELECT id,name,created FROM devices ORDER BY created').all() }
  revoke(id) { this.db.prepare('DELETE FROM devices WHERE id=?').run(id) }
  snapshot(since = 0) {
    const version = this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM records').get().version
    return { homeId: this.id, version, rows: this.db.prepare('SELECT * FROM records WHERE version > ? ORDER BY version').all(since).map(r => ({ ...r, value: JSON.parse(r.value) })) }
  }
  sync(changes, since = 0) {
    if (!Array.isArray(changes) || changes.length > 250 || !Number.isSafeInteger(since) || since < 0) throw new Error('Invalid sync batch.')
    const items = changes.map(c => {
      if (!c || !Number.isSafeInteger(c.base) || c.base < 0 || typeof c.op !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(c.op)) throw new Error('Invalid sync operation.')
      return { ...c, value: validateHomeRow(c.key, c.value) }
    })
    let version = this.snapshot(Number.MAX_SAFE_INTEGER).version
    const accepted = [], conflicts = []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const c of items) {
        if (this.db.prepare('SELECT id FROM operations WHERE id=?').get(c.op)) { accepted.push(c.op); continue }
        const old = this.db.prepare('SELECT * FROM records WHERE key=?').get(c.key)
        if ((old?.version || 0) !== c.base) { conflicts.push(c.op); continue }
        if (!old && this.db.prepare('SELECT COUNT(*) AS n FROM records').get().n >= 20000) throw new Error('Home library storage limit reached.')
        if (c.key.startsWith('progress/') && c.value !== null) {
          const parent = this.db.prepare('SELECT value FROM records WHERE key=?').get(`source/${c.key.split('/')[1]}`)
          if (!parent || parent.value === 'null') { conflicts.push(c.op); continue }
        }
        this.db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?,?)').run(c.key, JSON.stringify(c.value), ++version, Date.now())
        this.db.prepare('INSERT INTO operations VALUES (?,?)').run(c.op, Date.now())
        accepted.push(c.op)
      }
      this.db.prepare('DELETE FROM operations WHERE created < ?').run(Date.now() - 30 * 86400000)
      this.db.exec('COMMIT')
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
    return { ...this.snapshot(since), accepted, conflicts }
  }
  close() { this.db.close() }
}
