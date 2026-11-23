# Wave → Money sync: setup

One-way and read-only: Money reads your Wave invoices and payments every night and never changes anything in Wave.
Expenses don't come from Wave (its API doesn't offer them): import your bank and credit-card CSVs weekly in Money → Import.

## 1. Register the Wave app (about 5 minutes)

1. Go to **developer.waveapps.com** and sign in with your usual Wave login (the one for RPM DIESEL).
2. Open **Manage Applications** (top menu or "My Apps"), then **Create an application**.
3. Fill in:
   - **Name:** `RPM Money`
   - **Description:** `Read-only sync of RPM DIESEL invoices and payments into our dashboard`
   - **Redirect URIs:** add both lines:
     - `http://localhost:3000/api/money/wave/callback` (for the first test on the Mac)
     - `https://panel.rpm-diesel.ca/api/money/wave/callback` (for the live site, later)
   - **Scopes / permissions:** tick only the ones that end in **`:read`** (business, account, customer, invoice, product, sales tax, vendor, user). Never tick anything ending in `:write` or `:*`.
4. Save. Wave shows a **Client ID** and a **Client Secret**. Keep that page open.

If Wave refuses the `http://localhost…` address, tell me: we'll do the first test on a private preview address instead.

## 2. Put the keys where the app reads them

**On the Mac** (`.env.local`, never committed): add
```
WAVE_CLIENT_ID=…
WAVE_CLIENT_SECRET=…
```
(`MONEY_TOKEN_KEY` and `CRON_SECRET` are already there; they were generated for you.)

**In Vercel** → the project → Settings → Environment Variables → **Production only** (untick Preview and Development):

| Name | Value |
|---|---|
| `WAVE_CLIENT_ID` | from Wave |
| `WAVE_CLIENT_SECRET` | from Wave |
| `MONEY_TOKEN_KEY` | copy the exact value from `.env.local` (must be the same, or the stored connection can't be read) |
| `CRON_SECRET` | copy from `.env.local` |
| `RESEND_API_KEY` | in Resend → API Keys → Create → permission **Sending access**, domain **send.rpm-diesel.ca** |
| `MONEY_ALERT_EMAIL` | the address that should get "sync stopped" emails |
| `MONEY_ALERT_FROM` | optional, e.g. `RPM Money <money@send.rpm-diesel.ca>` |

Vercel only uses them after the next deployment.

## 3. Connect, test, dry run (nothing is written)

1. On the Mac: Money → Settings → **Connect Wave** → Wave's page → **Allow**.
2. The read-only test runs (`npm run wave:probe`): what Wave returns, token lifetime, rate limits.
3. **Preview (dry run)**: shows what the first sync would link (your 477 CSV entries), add, change, and the month-by-month check.
4. Choose a category for each Wave item, set the card-fee starting point, check the preview, then **Looks right: start syncing**.

## Safety

- Tokens are encrypted (AES-256-GCM) and stored where even Admins' browsers can't read them.
- Each Wave payment becomes Money entries exactly once (unique Wave ID); CSV-imported payments are linked, not added again.
- Closed months are never changed: differences show in "Needs attention".
- Every change is in the audit history as "Wave sync".
- If the connection expires or the sync fails for more than 24 h: a banner in Money and an email.
- Database rules check: `npm run check:wave`. Rollback scripts: `supabase/rollback/20261123000100_…` and `…000200_…`.
