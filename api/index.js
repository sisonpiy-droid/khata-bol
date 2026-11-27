// Vercel entry: the same Express app, run as a function. The frontend is the static Vite build.
import { createApp } from '../server/app.js'
import { openDb, dbPath } from '../server/db.js'
import { pruneStale } from '../server/ledger.js'

const db = openDb(dbPath())
pruneStale(db)
export default createApp(db)
