# Daybook

Personal work OS: Next.js + Supabase Postgres + Telegram bot.

## Deploy to Vercel

### 1. Push to GitHub
Push this repo to a GitHub repository.

### 2. Import in Vercel
Go to vercel.com → **Add New Project** → import your repo.

### 3. Add environment variables
Paste these in Vercel → Project Settings → Environment Variables (all values are in your `.env`):

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase → Connect → Transaction pooler (port 6543) |
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | pre-generated, in `.env` |
| `TELEGRAM_OWNER_CHAT_ID` | leave empty — first `/start` locks the bot |
| `DEEPGRAM_API_KEY` | Deepgram console |
| `CRON_SECRET` | pre-generated, in `.env` |
| `ADMIN_PASSWORD` | choose a strong password |
| `APP_BASE_URL` | your Vercel URL, e.g. `https://your-app.vercel.app` |

### 4. Deploy
Click **Deploy**. On first boot the app automatically:
- applies all database migrations
- seeds default data (exercise types, projects, LinkedIn cadence task)
- registers the Telegram webhook
- the every-minute cron is handled by Vercel (`vercel.json`)

### 5. First login
Open the app → enter the password you set in `ADMIN_PASSWORD`.
Send `/start` to the Telegram bot.

---

## Run locally

```
npm run up
```

Set `ADMIN_PASSWORD` in `.env` to use it locally too.

## Machine note

`node_modules` lives on C: (junction from D: which is nearly full).
