# SHP Reporting Dashboard — Setup Guide

Read this top to bottom. Do the phases **in order**. Each phase ends with something
working, so you can stop anytime and still have a usable dashboard.

You already installed **Node.js** and **VS Code**. Good. Let's go.

---

## PHASE 1 — See it running on your own computer (10 minutes)

This phase needs NO accounts and NO keys. You'll see your dashboard with your real data.

1. **Unzip** this folder. You'll get a folder called `shp-dashboard`. Put it on your Desktop.

2. **Open it in VS Code:** open VS Code → top menu **File > Open Folder** → pick the
   `shp-dashboard` folder → click Open.

3. **Open the built-in terminal:** top menu **Terminal > New Terminal**.
   A panel opens at the bottom. This is where you type commands.

4. **Type this and press Enter** (it downloads the building blocks — takes a minute):
   ```
   npm install
   ```

5. **Type this and press Enter:**
   ```
   npm run dev
   ```

6. You'll see a line like `Local: http://localhost:5173/`.
   Hold **Cmd** and click that link (or type it into your browser).

7. **The dashboard opens.** Click **Upload data** and drop in one of your `.xlsx` files.
   The charts and KPIs fill in. 🎉

   > The AI buttons (Today's Focus, Ask the Board, Events) won't work yet — they need
   > Phase 2. Everything else works right now.

To stop the dashboard later: click the terminal and press **Ctrl + C**.
To start it again: `npm run dev`.

---

## PHASE 2 — Put it on the internet + turn on the AI (30 minutes)

Now we give it a real web address and switch on the smart features.

### 2a. Get an Anthropic API key
1. Go to **https://console.anthropic.com** and sign up. (This is a separate,
   pay-as-you-go account from your Claude.ai subscription.)
2. Add a payment method, then go to **API Keys** and create one.
3. Copy the key (starts with `sk-ant-`). Keep it somewhere safe for a moment.

   > Cost for one person clicking a few buttons a day is roughly a few dollars a month.

### 2b. Put your code on GitHub
1. Make a free account at **https://github.com**.
2. In VS Code, click the **Source Control** icon on the left (looks like a branch).
3. Click **Publish to GitHub** → choose **private** repository → done.
   (If VS Code asks to sign in to GitHub, say yes.)

### 2c. Deploy on Vercel
1. Go to **https://vercel.com** and **Sign up with GitHub**.
2. Click **Add New > Project**, find your `shp-dashboard` repo, click **Import**.
3. Before clicking Deploy, open **Environment Variables** and add this one:
   - Name: `ANTHROPIC_API_KEY`   Value: *(paste your sk-ant- key)*
4. Click **Deploy**. Wait ~1 minute.
5. Vercel gives you a live URL like `https://shp-dashboard-xxxx.vercel.app`.
   Open it. The AI features now work. 🎉

---

## PHASE 3 — Save data across all your devices (20 minutes)

Until now, data lives only in the browser you uploaded it in. This makes it live in
the cloud so your laptop and phone show the same numbers.

1. Make a free account at **https://supabase.com** and create a **New project**
   (pick any name and a database password — save that password).
2. When it finishes setting up, go to the left sidebar **SQL Editor > New query**.
   Open the file `supabase_setup.sql` from this folder, copy everything in it,
   paste it into Supabase, and click **Run**.
3. In Supabase go to **Settings (gear) > API**. You'll see:
   - **Project URL** (looks like `https://abcd.supabase.co`)
   - **anon public** key (a long string)
4. Back in **Vercel > your project > Settings > Environment Variables**, add two more:
   - Name: `VITE_SUPABASE_URL`        Value: *(your Project URL)*
   - Name: `VITE_SUPABASE_ANON_KEY`   Value: *(your anon public key)*
5. Go to the **Deployments** tab in Vercel → click the **…** on the latest one →
   **Redeploy**. (Env-var changes only take effect after a redeploy.)

Now your data is stored in the cloud.

---

## PHASE 4 — Add the password (5 minutes)

1. In **Vercel > Settings > Environment Variables**, add two more, both with the
   **same** value (whatever password you want):
   - Name: `APP_PASSWORD`        Value: `your-password`
   - Name: `VITE_APP_PASSWORD`   Value: `your-password`
2. **Redeploy** (Deployments tab → … → Redeploy).

Now the site asks for a password before it opens, and your API endpoint is protected.

---

## Everyday use
- Visit your Vercel URL from any device, enter the password, upload new files.
- New data updates the charts and is saved to the cloud automatically.

## If something breaks
- Copy the red error text from the VS Code terminal (or the Vercel build log) and
  send it to Claude — that's the fastest fix.
- After changing any environment variable in Vercel, you must **Redeploy** for it
  to take effect.

## What each file is (you don't need to touch these)
- `src/App.jsx` — the dashboard itself
- `src/storage.js` / `src/supabaseClient.js` — saves your data
- `api/claude.js` — the secure middleman that holds your API key
- `.env.example` — a template showing which keys exist
- `supabase_setup.sql` — the one-time database setup
