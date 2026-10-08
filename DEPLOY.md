# PetAdmin — Deploying to Vercel (frontend) + Railway (backend) + MongoDB Atlas (database)

This guide takes you from the Emergent preview to a real production web app on your own domain. Allow ~45 minutes end-to-end the first time.

The stack is split into three pieces, each hosted separately:

| Piece | Where | Monthly cost | Why |
| --- | --- | --- | --- |
| **Website** (Expo Router → static HTML/JS) | **Vercel** | Free | Fastest static hosting, free SSL, free custom domain |
| **API** (FastAPI) | **Railway** (or Render / Fly.io) | ~$5 | Needs always-on Python server |
| **Database** (MongoDB) | **MongoDB Atlas** | Free (512 MB) | Managed, backups included |

All three accept a GitHub repo and auto-deploy on every push.

---

## 0. Prerequisites (one-time)

Create accounts (all free to start):
1. **GitHub** — https://github.com
2. **Vercel** — https://vercel.com (sign in with GitHub)
3. **Railway** — https://railway.app (sign in with GitHub)
4. **MongoDB Atlas** — https://www.mongodb.com/cloud/atlas
5. **Stripe** — https://dashboard.stripe.com (if you don't have one already)
6. A domain name you own, e.g. `petadmin.co.uk` (Namecheap, Cloudflare Registrar, etc.)

Push the Emergent code to GitHub:
- In Emergent, open the right-hand sidebar → **Save to GitHub** → authorise GitHub → pick a repo name like `petadmin`. From now on, every change you make in Emergent can be committed to GitHub with a click.

> **Security note:** `.env` files (both backend and frontend) are git-ignored, so your real secrets never leave the hosting dashboards. Only `.env.example` templates ship in the repo.

---

## 1. Database — MongoDB Atlas (5 min)

1. Create a project called `PetAdmin`.
2. **Build a Database** → M0 (Free, 512 MB) → pick the region closest to your users (e.g. `eu-west-1` for the UK).
3. **Database Access** → Add a database user. Username `petadmin`, auto-generate a password (save it).
4. **Network Access** → Add IP → `0.0.0.0/0` (allow from anywhere — fine for the free tier; tighten later).
5. **Connect** → Drivers → Python → copy the connection string. It looks like:
   ```
   mongodb+srv://petadmin:<password>@cluster0.ab12c.mongodb.net/?retryWrites=true&w=majority
   ```
   Paste the password in place of `<password>` and keep this string safe.

---

## 2. Backend — Railway (10 min)

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → pick your `petadmin` repo.
2. Railway will detect the Python project. In **Settings**:
   - **Root Directory**: `backend`
   - **Start Command**: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Build Command**: (leave blank — Railway auto-installs from `requirements.txt`)
3. Open **Variables** and add (copy from `/app/backend/.env.example`):

   | Key | Value |
   | --- | --- |
   | `MONGO_URL` | the Atlas connection string from step 1.5 |
   | `DB_NAME` | `petadmin` |
   | `JWT_SECRET` | long random string, min 32 chars (run `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` locally). **The API will refuse to boot without this.** |
   | `CORS_ALLOWED_ORIGINS` | your Vercel URL(s), comma-separated, no trailing slash. E.g. `https://petadmin.co.uk,https://www.petadmin.co.uk`. Use `*` only during initial Railway smoke-testing, then tighten. |
   | `STRIPE_API_KEY` | your `sk_test_...` or `sk_live_...` from Stripe dashboard |
   | `STRIPE_WEBHOOK_SECRET` | fill in at step 5 (until then the webhook endpoint will return `503` — this is the safe default and protects your subscriptions from forged events) |
   | `STRIPE_PRICE_AMOUNT_GBP` | `1299` |
   | `STRIPE_TRIAL_DAYS` | `14` |
   | `EMERGENT_LLM_KEY` | *(optional — only if you keep using Emergent object storage for pet photos; see "Pet photos" note below)* |

4. Deploy. Railway gives you a public URL like `https://petadmin-api-production.up.railway.app`.
5. Test it: open that URL in a browser — you should see `{"service":"petadmin","status":"ok"}`.

Keep the API URL — you need it in the next step.

---

## 3. Frontend — Vercel (5 min)

1. Vercel dashboard → **Add New → Project** → import your `petadmin` repo.
2. In the import screen:
   - **Framework Preset**: `Other`
   - **Root Directory**: `frontend`
   - **Build/Install/Output**: leave as-is — the `vercel.json` in the repo already configures these.
3. **Environment Variables** → add:

   | Key | Value |
   | --- | --- |
   | `EXPO_PUBLIC_BACKEND_URL` | the Railway URL from step 2.4 (no trailing slash, e.g. `https://petadmin-api-production.up.railway.app`) |

4. **Deploy**. First build takes ~2 min. You get a URL like `https://petadmin-xyz.vercel.app`.
5. Open it in a browser — you should see the PetAdmin welcome screen. Register, onboard, you're live. 🎉

> **Why does the backend URL need to be set at build time?** Expo bakes `EXPO_PUBLIC_*` variables into the JS bundle. If you ever change the backend URL, click **Redeploy** in Vercel — no code change needed.

---

## 4. Custom domain (5 min)

### On Vercel (website)
1. Project → **Settings → Domains** → add `petadmin.co.uk` and `www.petadmin.co.uk`.
2. Vercel shows you the DNS records to add at your registrar. Typically:
   - `A` record on `@` → `76.76.21.21`
   - `CNAME` on `www` → `cname.vercel-dns.com`
3. Add them at your registrar. Vercel auto-issues SSL once DNS propagates (usually < 10 min).

### On Railway (API)
Optional but recommended for a tidy setup:
1. Project → **Settings → Networking → Generate domain** or **Custom domain**.
2. Add `api.petadmin.co.uk` and the `CNAME` Railway gives you to your registrar.
3. **Important**: once your API moves to `api.petadmin.co.uk`, update `EXPO_PUBLIC_BACKEND_URL` on Vercel to `https://api.petadmin.co.uk` and redeploy.

---

## 5. Stripe webhook (production reliability)

Your preview worked with the `/billing/verify` return URL and no webhook. For production, add a webhook so Stripe can push subscription updates (cancellations, failed payments) even if the customer closes the tab.

1. Stripe dashboard → **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL**: `https://api.petadmin.co.uk/api/stripe/webhook` (or the Railway URL if you skipped step 4).
3. **Events to send**: tick these three:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **Signing secret** (starts with `whsec_...`).
5. Back on Railway → Variables → set `STRIPE_WEBHOOK_SECRET` to that value → Railway redeploys automatically.

Test it: Stripe → the webhook → **Send test event** → `customer.subscription.updated` → confirm Railway returns 200.

---

## 6. Smoke test checklist on the live site

Open `https://petadmin.co.uk` in an incognito window and verify:

- [ ] Register a new account → onboarding flow completes → dashboard loads with seeded demo data
- [ ] Add a real customer and pet (keep them for your real business!)
- [ ] Create a booking, record a payment → outstanding drops to £0, receipt share works
- [ ] More → Export this week (CSV) downloads a file
- [ ] More → Staff & invites → invite yourself at a second email → open the invite link in another browser → the second user joins the business as staff
- [ ] Sign in as staff → confirm they see the same customers; try to open More → Subscription — it should be hidden for staff
- [ ] As owner, start the Stripe checkout → use card `4242 4242 4242 4242` (any expiry, any CVC) → return → More → billing card shows "Pro — in free trial"
- [ ] Stripe dashboard shows the new subscription under Customers
- [ ] Sign out, sign back in — session persists; data still scoped to your business

If any step fails, check the **Railway logs** (API side) or the **Vercel runtime logs** (website side) — the error almost always points to a missing/incorrect env var.

---

## 7. Day-to-day workflow after deploy

| Thing you want to do | How |
| --- | --- |
| Make a code change | Edit in Emergent → **Save to GitHub** → Vercel + Railway auto-deploy in ~2 min |
| Rotate a secret | Edit the env var in Vercel/Railway → redeploy — no code change needed |
| View live errors | Railway "Deployments → Logs" (API) or Vercel "Deployments → Logs" (website) |
| Back up the database | MongoDB Atlas does automatic daily snapshots on the free tier |
| Cancel a customer | Stripe dashboard → Customers → that subscription → Cancel. Your app picks it up via the webhook within seconds |
| Scale up (eventually) | Railway: upgrade the plan. MongoDB Atlas: scale the cluster. Vercel scales automatically |

---

## 8. Switching from Emergent-managed Stripe to your own

In the current preview, `STRIPE_API_KEY=sk_test_emergent` routes through Emergent's shared sandbox. In production you want your own Stripe account so money ends up in your bank:

1. Stripe dashboard → **Developers → API keys** → copy your **Secret key** (`sk_test_...` for staging, `sk_live_...` for production).
2. Paste it as `STRIPE_API_KEY` in Railway. Save.
3. Railway redeploys. The code auto-detects it's NOT the Emergent proxy key (`sk_test_emergent`) and talks to Stripe directly — no code change needed.
4. Repeat step 5 above to register your webhook on your real Stripe account.

That's it. Every new signup creates a real customer in **your** Stripe dashboard, trialing or paying £12.99.

---

## 9. Pet photos (one small note)

Pet photos currently upload via Emergent's managed object storage. In production you have two options:

- **Keep it**: paste your `EMERGENT_LLM_KEY` into Railway. Simplest.
- **Swap for your own S3 / Cloudflare R2**: open `backend/server.py` → the three `_init_storage_sync` / `_put_object_sync` / `_get_object_sync` helpers → point them at your bucket. ~30 lines of code.

If pet photos aren't critical for launch (groomers can start without them), skip this and come back to it later.

---

## 10. Data isolation preserved — nothing changes

Everything you built already works unchanged after deploy:

- **£12.99/month Stripe subscription**: lives on `businesses` in MongoDB. Shared by every staff member. Verified in `/api/billing/*` endpoints.
- **Staff logins**: `memberships` collection links users ↔ businesses. The `current_member` dependency scopes every data query to the signed-in user's business.
- **Business data isolation**: already covered by 56 passing backend tests (cross-business reads, writes, deletes all return 403/404).
- **14-day free trial, Mark fully paid, receipt share, CSV export, SMS rebooking**: all baked into the frontend bundle served by Vercel.

Nothing to change — just deploy and go.

---

## Need help?

- Vercel build failing: `vercel.json` and `yarn.lock` must both be committed; check the Vercel build log — missing env vars show up as console warnings but shouldn't fail the build.
- Railway "502 Bad Gateway": the Python app crashed. Open logs — usually a bad `MONGO_URL` or missing `JWT_SECRET`.
- CORS errors in the browser console: your `EXPO_PUBLIC_BACKEND_URL` is wrong, or your Vercel domain isn't in `CORS_ALLOWED_ORIGINS` on Railway. Add the exact origin (scheme + host, no trailing slash) and redeploy.
- Stripe webhook returns 503: `STRIPE_WEBHOOK_SECRET` is empty on Railway — set it (step 5) and redeploy. This 503 is a deliberate safety: without a signing secret the endpoint cannot verify events, so it refuses them.
- Stripe checkout gives "Invalid API key": you still have `sk_test_emergent` in Railway — swap it for your real key (step 8).
