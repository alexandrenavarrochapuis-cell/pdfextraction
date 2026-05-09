# AI Strategy News Digest

A scheduled job that emails you a curated brief of the most strategically
relevant AI news, every weekday morning at 07:00 UTC.

## What it does

1. Pulls the latest items (last ~26h) from the feeds in `digest/sources.py`:
   - **Frontier labs**: Anthropic, OpenAI, Google DeepMind, Meta AI
   - **Industry**: TechCrunch AI, The Verge AI, Bloomberg AI
   - **Practitioner signal**: Hacker News (AI-keyword filtered, ≥150 points)
2. Deduplicates by URL.
3. Asks Claude (`claude-haiku-4-5`) to rank by strategic relevance for a
   Head of AI Strategy and write a 2-3 sentence "so what" framing for each.
4. Renders an HTML email and POSTs the payload to a Zapier webhook,
   which fires a "Gmail → Send Email" action on the connected account.

## One-time setup

### 1. Create the Zapier zap

In Zapier:

1. **Trigger**: *Webhooks by Zapier → Catch Hook*. Copy the webhook URL.
2. **Action**: *Gmail → Send Email* on your connected Google account.
   Map the fields like this:

   | Gmail field | Zapier value |
   |---|---|
   | To       | (your address) |
   | Subject  | `subject` from the trigger |
   | Body type| HTML |
   | Body     | `html` from the trigger |

   Optional: also set the plain-text body to `text` for clients that
   don't render HTML.

3. Turn the zap on.

### 2. Add GitHub repository secrets

Settings → Secrets and variables → Actions → New repository secret:

| Name                | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key (used by `claude-haiku-4-5`) |
| `ZAPIER_WEBHOOK_URL`| The Catch Hook URL from step 1 |

### 3. (Optional) Test it now

Actions tab → *AI Strategy News Digest* → *Run workflow*.
- Set `dry_run` to `true` to print the digest to the workflow log without
  sending an email.
- Set `dry_run` to `false` for an end-to-end test send.

## Running locally

```bash
pip install -r requirements-digest.txt

# Dry run — prints the digest, no email
ANTHROPIC_API_KEY=sk-ant-... python news_digest.py --dry-run

# Real send
ANTHROPIC_API_KEY=sk-ant-... \
ZAPIER_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/.../... \
python news_digest.py
```

## Tuning

| Knob | Where | Default |
|---|---|---|
| Send time | `.github/workflows/ai-news-digest.yml` cron | `0 7 * * 1-5` (07:00 UTC, Mon-Fri) |
| Item count | `--top-n` flag | 12 |
| Lookback window | `--lookback-hours` flag | 26 |
| Sources | `digest/sources.py` | Labs + industry + HN |
| Model | `DIGEST_MODEL` env var | `claude-haiku-4-5` |
| Selection lens | `SYSTEM` prompt in `digest/summarize.py` | Head-of-AI-Strategy framing |

## Costs

- GitHub Actions: free (well within free-tier minutes for a daily 1-2 minute job).
- Anthropic API: ~$0.01-0.03 per send with Haiku, depending on item count.
- Zapier: 1 task per send (≤22/month) — free plan covers it.

Total: under $1/month.
