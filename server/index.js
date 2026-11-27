import { createApp } from './app.js'
import { openDb, dbPath, isPersistent } from './db.js'
import { pruneStale } from './ledger.js'

const PORT = process.env.PORT || 8787
const db = openDb()
pruneStale(db)
console.log(`Khata Bol database: ${dbPath()}`)
if (!isPersistent()) console.warn('WARNING: running on Railway without a volume. Data will be lost on redeploy. Attach a volume (see RAILWAY.md).')
// 0.0.0.0 so the platform's proxy can reach the container. ponytail: one instance, one SQLite writer; do not scale replicas.
createApp(db).listen(PORT, '0.0.0.0', () => console.log(`Khata Bol listening on 0.0.0.0:${PORT}`))
