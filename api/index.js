// Vercel runs this Express app as one serverless function; vercel.json rewrites /api/* here.
export { app as default } from '../server/app.js'
