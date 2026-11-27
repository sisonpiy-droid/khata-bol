import { createApp } from './app.js'

const PORT = process.env.PORT || 8787
createApp().listen(PORT, () => console.log(`Khata Bol on :${PORT}`))
