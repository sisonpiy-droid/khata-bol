import { app } from './app.js'

const PORT = process.env.PORT || 8787
app.listen(PORT, () => console.log(`Khata Bol API on :${PORT}`))
