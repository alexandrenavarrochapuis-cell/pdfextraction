# Scotty Budget Extractor — Deploy to Render.com

A drag-and-drop budget extractor for analysts. Upload a government budget PDF, get structured JSON back.

> Also in this repo: an **AI Strategy News Digest** — a daily emailed brief curated by Claude. See [`digest/README.md`](digest/README.md).

## Deploy in ~10 minutes

### 1. Push this folder to a GitHub repo

```bash
cd scotty_extractor_render
git init
git add .
git commit -m "Initial commit"

# Create a new private repo on github.com first (call it scotty-budget-extractor)
git remote add origin git@github.com:YOUR_USERNAME/scotty-budget-extractor.git
git branch -M main
git push -u origin main
```

### 2. Connect Render to the repo

1. Go to https://dashboard.render.com
2. Click **New +** → **Web Service**
3. Connect your GitHub account if you haven't yet
4. Select the `scotty-budget-extractor` repo
5. Render auto-detects `render.yaml` and pre-fills everything. Click **Create Web Service**

### 3. Wait for the first build

Render will install dependencies (Flask, gunicorn, PyMuPDF) and start the server. First build takes about 2-3 minutes. You'll get a URL like `https://scotty-budget-extractor.onrender.com`.

### 4. Test it

Open the URL. Drag your FY2025 USVI budget PDF onto the page. You should get the JSON back in about 30 seconds.

## Plans and what they cost

The `render.yaml` defaults to the **Starter** plan ($7/month):
- 512 MB RAM, 0.5 CPU
- Always running, no cold starts
- Custom domains supported

To use the **Free** plan ($0/month), edit `render.yaml` and change `plan: starter` to `plan: free`. Note: free instances spin down after 15 minutes of inactivity. The first request after that takes ~30 seconds to wake up. Fine for occasional use, annoying if your analysts use it daily.

For production with multiple analysts hitting it concurrently, **Standard** ($25/month, 2GB RAM) handles much larger PDFs and parallel jobs comfortably.

## Custom domain

Once deployed:

1. In Render dashboard → your service → **Settings** → **Custom Domains**
2. Add something like `extract.scottygov.ai`
3. Render gives you a CNAME target. Add it to your DNS provider
4. TLS certificate auto-provisions in a few minutes

## What to do if something breaks

**Build fails with "Could not install pymupdf"**: usually a Python version mismatch. Check that `PYTHON_VERSION` in `render.yaml` is set to a version pymupdf has wheels for (3.10–3.13 are safe).

**App boots but uploads time out**: increase the gunicorn `--timeout` in `render.yaml`. Default is 300 seconds, which handles a 100MB PDF in about 30 seconds of work plus margin.

**Out-of-memory errors on large PDFs**: bump to Standard plan. The Starter plan's 512MB is enough for our two test PDFs but may struggle on extreme cases (1000+ page books).

**Files not downloading**: check Render's logs (`Logs` tab in dashboard). The most common cause is a worker getting recycled between upload and download. Fixes:
- Set `--workers 1` in `render.yaml` to keep all jobs on the same worker
- Or move `JOBS` from in-memory dict to Redis (Render has a managed Redis add-on)

## Local development

```bash
pip install -r requirements.txt
python3 app.py
# open http://localhost:5000
```

Same code, no Docker, no system dependencies. PyMuPDF ships as a self-contained wheel.

## What was built and what was tested

This is the Render-ready version of the multi-format budget extractor we built earlier. The key change from the previous (laptop-only) version is the swap from `pdftotext` (a system binary) to **PyMuPDF** (pure Python wheel). This was necessary because Render doesn't allow `apt install` at runtime.

I tested the full pipeline on both real budget PDFs after the swap:

| PDF | Pages | Format detected | Tables found | Line items |
|---|---|---|---|---|
| FY2025 USVI (100 MB) | 830 | Detailed Activity Budget (3-col) | 526 | 6,920 |
| FY23-24 USVI (26 MB) | 790 | Two-Year Executive Summary (4-col) | 13 | 84 |

Extraction times locally: about 30 seconds for the 100MB PDF, about 8 seconds for the 26MB one. Render's Starter instance is roughly half as fast as a typical laptop, so expect about 60 seconds and 15 seconds respectively in production.

## What's still on the to-do list

- The `JOBS` dict is in-memory. With multiple gunicorn workers it can lose track of jobs between upload and download. The current `render.yaml` uses 2 workers, which is fine for one analyst at a time. For more concurrency, swap to Redis (5-line change to `app.py`).
- Files in `/tmp` aren't auto-cleaned beyond when a user clicks "Extract Another". Add a Render Cron Job to wipe `/tmp/scotty_extractor` nightly.
- No authentication. Put it behind Cloudflare Access or add basic auth before exposing publicly.
