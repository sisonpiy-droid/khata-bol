# Deploy Khata Bol on Railway (public HTTPS demo)

One service, built from the repo's `Dockerfile`, with a persistent volume for SQLite. No API keys or variables are required.

## Steps (about 5 minutes)

1. Sign in at https://railway.com with GitHub. Choose the **Hobby/Trial** plan; do not buy anything you did not choose. A small always-on service is cheap, but check Railway's current pricing page for your account.
2. **New Project → Deploy from GitHub repo →** pick `sisonpiy-droid/khata-bol` (authorize the Railway GitHub app for that repo if asked). Railway reads `railway.json`: Dockerfile build, health check on `/health`, one replica.
3. **Add the volume (important).** Open the service → **Settings → Volumes → Add Volume** (or right-click the service on the canvas → *Attach volume*). Set the mount path to `/data`. Without it, data is lost on every redeploy; the app logs a warning and `/health` reports `"persistent": false`.
4. **Public URL.** Service → **Settings → Networking → Generate Domain**. Leave the port at the default (the app reads Railway's `PORT`).
5. Wait for the deploy to turn green, then open the URL. `https://<your-domain>/health` should return `{"ok":true,"persistent":true}`.

Do **not** set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` for the public demo unless you want AI enhancement; a public site with a key lets strangers spend your quota. Keep replicas at 1 (SQLite has a single writer).

## How the public demo stays safe

- Each visitor's browser gets a random session id; the server gives that session its own private demo shop (Ramesh, Rameshwar, Suresh, Priya, Kavita, synthetic data). Ledgers and conversation state are never shared.
- "Reset demo data" only resets the visitor's own shop. Idle demo shops are removed after 14 days; there is a 5,000-shop cap.
- The database is on the volume (`RAILWAY_VOLUME_MOUNT_PATH`), so records survive restarts and redeploys.

## Checking it works

```bash
curl https://<your-domain>/health          # {"ok":true,"persistent":true}
```
Then in Chrome: allow the microphone and say "Ramesh ko paanch sau rupaye udhaar diye", "haan", "Ramesh ne do sau rupaye wapas diye", "haan", "Ramesh ka kitna baaki hai?". The answer should be 300 rupaye.
