// Vercel runs this Express app as one serverless function; vercel.json rewrites /api/* here.
import { createApp } from '../server/app.js'

export default createApp()
