# Job Hunting

A recruiter tool. It reads public career boards, matches open roles to each
candidate's profile, drafts an application kit, and tracks every application
through recruiter approval.

```
career boards ─ingest─▶ jobs ─free filters─▶ LLM screen ─▶ matches ─▶ application kit ─▶ approve ─▶ submitted
(Greenhouse,            (Postgres)  (titles, place,   (score 0–10                (editable)      (recruiter)  (by hand,
 Lever, Ashby)                       posting age)      per candidate)                                          for now)
```

## Run the web app

One command starts both the API and the UI. With no `DATABASE_URL` set, the
API uses an embedded Postgres stored in `server/.data`, so there is nothing
to install or configure first.

```bash
cd server && npm install && npm --prefix ../frontend install   # once
npm run dev:all        # API on http://localhost:8787 + UI on http://localhost:5173
```

The UI forwards every `/api` call to the API on port 8787. If you start only
the UI (`cd frontend && npm run dev`), every page will show
`http proxy error: ECONNREFUSED` until the API is running too
(`cd server && npm run dev`). The API takes 20–40 seconds to come up against
Neon; errors in that window are normal.

Open the UI, go to **Boards** and choose **Refresh all boards** to load jobs.
Then add a candidate, fill in the profile (or upload a resume and extract it),
set job preferences, and choose **Find matches**.

Everything works with no LLM key: resumes are read with rules, every job gets
a deterministic rule score (title fit, skills, seniority, blockers), and kits
start as templates. An LLM key (copy `.env.example` to `.env`) adds the "AI"
options: in the default `SCORING_MODE=hybrid`, the model re-scores only the
best few rule-scored jobs per run (`LLM_RESCORE_MAX`, default 10), and the
"Extract with AI" and "Draft with AI" buttons appear.

| Folder | What it is |
|---|---|
| `server/` | TypeScript API (Hono). Kysely for queries, Prisma for migrations only, Neon Postgres in production. `npm test` runs 93 tests with no network or key. |
| `frontend/` | React + Vite UI: Search, Candidates, Applications, Boards. |
| `jobhunt/`, `tests/` | The original Python CLI, described in the rest of this file. Kept for reference; the web app no longer uses it. |

### Deploying

`vercel.json` deploys `server/` and `frontend/` as two services. The Vercel
project needs `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (Neon), an LLM key,
`BLOB_READ_WRITE_TOKEN` (a Vercel Blob store, for resume files) and
`CRON_SECRET`. Apply the schema once with
`cd server && npx prisma migrate deploy`.

**There is no login yet.** Anyone who can open the deployed URL can read and
change every candidate. Do not put real candidate data on a public deployment
until authentication is added.

### What is not built

Automatic submission. Approving an application records the recruiter's
sign-off; the recruiter then applies on the company's site and marks it
submitted.

---

# The original CLI (Python)

Everything below describes the first version of this project, a single-user
command-line agent.

A personal job-search agent. It reads public ATS APIs every morning, throws away
the ~99% that don't fit you, scores what's left against your resume, drafts an
application kit for the best few, and emails you a digest.

**It never submits an application.** It finds, filters, ranks and drafts. You
read the digest, edit the cover note, and press submit yourself.

```
2000 postings  →  40 candidates  →  5 in your inbox
   fetch          regex/location      LLM screen
                  /freshness gate     + draft
                  (free, no LLM)
```

> **New to Python?** Read **[SETUP.md](SETUP.md)** instead — it's a 13-step guide
> that assumes you have nothing installed. This README assumes you're comfortable
> with a terminal.

---

## Run it in 30 seconds, no API key

```bash
git clone <your-repo> && cd jobhunt
python -m venv .venv && .venv/Scripts/activate      # Windows
# python -m venv .venv && source .venv/bin/activate # macOS/Linux
pip install -r requirements.txt

python -m jobhunt run --mock --scorer keyword
```

`--mock` runs bundled fixtures through the **real parsers** — no network.
`--scorer keyword` swaps the LLM for a dumb token-overlap stub, so the whole
pipeline runs with no secrets configured. You should see:

```
[2/5] filtering
  prefilter: 12 -> 5 (dropped title=5 location=1 stale=1)
[3/5] screening 5 jobs (keyword stub — DEV ONLY)
  3 scored >= 7.0
[5/5] digest
  wrote out/digest.html

funnel: 12 scanned -> 5 passed filters -> 5 new -> 3 in digest
```

Open `out/digest.html` in a browser. That's the email you'd have received.

> The keyword scorer is **dev-only**. It cannot tell a Staff role from a
> new-grad one and has no idea what the words mean. It exists to prove the
> plumbing, never to build a digest you'd act on.

---

## Set it up for real

### 1. Point it at companies you'd actually join

Edit `companies.yaml`. The slug is the last path segment of a company's public
careers board:

| Board URL | `ats` | `slug` |
|---|---|---|
| `boards.greenhouse.io/stripe` | `greenhouse` | `stripe` |
| `jobs.lever.co/netlify` | `lever` | `netlify` |
| `jobs.ashbyhq.com/ramp` | `ashby` | `ramp` |

The shipped list is **examples** — verify each before trusting the output.
Companies migrate between ATS vendors and slugs go dead. A dead slug prints an
HTTP status and returns nothing; it never kills the run. Watch the per-board
counts on stdout: a board reporting 0 every day is a slug that needs fixing.

Start with 10–15 companies. A list of 200 is mostly noise.

**No LinkedIn or Naukri.** Neither has a public API and scraping them violates
their terms of service. The three ATS endpoints above are documented, unauthenticated,
and intended to be read.

### 2. Tune the filters

`config.yaml` holds the deterministic gate that runs **before** any LLM call.
This is the whole cost story — get it right and you spend cents a day.

```yaml
filters:
  include_titles: ['\bsde\b', 'software development engineer', ...]
  exclude_titles: ['\b(staff|principal)\b', '\b(manager)\b', ...]
  locations: [bangalore, bengaluru, india]
  allow_remote: true
  max_age_days: 30
score_threshold: 7.0
max_per_digest: 5
```

> **`sde` does not match "Software Development Engineer".** They share no
> substring. Use `\bsde\b` for the acronym *and* list the spelled-out variants
> separately, or you'll silently miss half of Amazon-style postings. There's a
> test pinning this.

### 3. Build your profile

```bash
cp .env.example .env      # add ANTHROPIC_API_KEY
python -m jobhunt profile --resume resume.pdf
```

PDFs go over as a base64 document block (Anthropic and Gemini both read them
natively — no OCR, no text extraction library). `.txt` and `.md` also work and
are the fallback for providers that can't take documents.

This writes `profile.json`. It's gitignored — read it, fix anything the model
got wrong, and keep it out of version control.

### 4. Run it

```bash
python -m jobhunt run                    # build the digest
python -m jobhunt run --send             # ...and email it
python -m jobhunt run --limit 10         # cost guard while tuning
python -m jobhunt run --no-draft         # screen only, skip the expensive pass
```

---

## Picking providers

Screening reads hundreds of jobs and wants the cheapest decent model. Drafting
runs ~5 times and wants the best one. So they're configured separately:

```bash
LLM_PROVIDER=anthropic          # sets both stages
SCREEN_PROVIDER=groq            # ...override per stage
DRAFT_PROVIDER=anthropic
SCREEN_MODEL=claude-haiku-4-5-20251001
DRAFT_MODEL=claude-sonnet-5
```

| Provider | Value | Key | PDF resumes | Notes |
|---|---|---|---|---|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | yes | default; uses the official SDK |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | yes | generous free tier |
| Groq | `groq` | `GROQ_API_KEY` | no | very fast, free tier |
| OpenAI-compatible | `openai-compatible` | `GROQ_API_KEY` + `LLM_BASE_URL` | no | Together, OpenRouter, vLLM |
| Ollama | `ollama` | none | no | fully local, `OLLAMA_HOST` |

Everything except Anthropic goes over plain `requests`, so you can delete the
`anthropic` line from `requirements.txt` and still run the whole thing.

Adding a provider is one class in [`jobhunt/providers.py`](jobhunt/providers.py)
with a `complete()` method, plus an entry in the `PROVIDERS` dict.

---

## Tracking

`seen.json` is both the dedupe index and the application tracker — a job you've
already been shown is never shown again. It's gitignored: it's yours, and
shipping one would break the first run for anyone who cloned the repo.

```bash
python -m jobhunt applied "greenhouse:stripe:5501001"   # id is in the digest
python -m jobhunt stats                                 # + CSV export
```

`out/tracker.csv` opens in any spreadsheet.

---

## Scheduling

[`.github/workflows/daily.yml`](.github/workflows/daily.yml) runs it at 06:00 IST
on weekdays. `seen.json` is carried between runs with `actions/cache`, not
committed — it's personal, and a `seen.json` in the repo would mark every job as
already-seen for anyone who cloned it. Nothing personal ever enters git.

Repository **secrets** to set (Settings → Secrets and variables → Actions):

| Secret | What |
|---|---|
| `PROFILE_JSON` | the entire contents of your local `profile.json` |
| `ANTHROPIC_API_KEY` | (or `GEMINI_API_KEY` / `GROQ_API_KEY`) |
| `SMTP_USER` / `SMTP_PASS` | Gmail address + **App Password**, not your login |
| `MAIL_TO` | where the digest goes |

Optional repository **variables**: `LLM_PROVIDER`, `SCREEN_PROVIDER`,
`DRAFT_PROVIDER`, `SCREEN_MODEL`, `DRAFT_MODEL`.

Trigger it by hand first — Actions → *daily job digest* → *Run workflow*, with
`dry_run` ticked to build the digest artifact without emailing.

Gmail needs an [App Password](https://myaccount.google.com/apppasswords); your
normal password stops working once 2FA is on.

---

## Layout

```
jobhunt/
  fetch.py       Job dataclass, strip_html, 3 pure parsers, fetch_all
  prefilter.py   title/location/freshness gate — no LLM, no cost
  providers.py   the swappable provider interface + 5 backends
  llm.py         screen() / draft() / build_profile() / keyword stub
  digest.py      HTML email (inline CSS only — Gmail strips <style>)
  mailer.py      SMTP
  store.py       seen.json dedupe + tracker + CSV export
  mock.py        fixtures in each ATS's native JSON shape
  cli.py         argparse: profile / run / applied / stats
config.yaml      filters, thresholds, paths
companies.yaml   boards to poll
tests/           55 tests, no network, no key
```

HTTP is kept out of the parsers on purpose. Each `parse_*(slug, company, body)`
takes already-decoded JSON and returns `list[Job]`, which is what makes `--mock`
exercise the real code path instead of a parallel implementation.

Every job gets `job_id = "{ats}:{slug}:{id}"` — globally unique, so the same
role posted on two boards is still two rows, and a re-run never duplicates.

### ATS quirks the parsers handle

- **Greenhouse** — `content` is HTML-entity-escaped HTML. Unescape *before*
  stripping tags and again after, or you ship `&amp;` into the prompt.
- **Lever** — `createdAt` is epoch **milliseconds**. The full JD is split across
  `descriptionPlain` **+** `lists[].text` **+** `lists[].content` **+**
  `additionalPlain`; concatenate all four or you lose the requirements section
  and every job looks unqualified.
- **Ashby** — skip `isListed: false`; those are unpublished drafts.

---

## Tests

```bash
python -m pytest tests -q
```

No network, no API key, no cost. The suite covers:

- each parser against fixtures in its **native** ATS shape
- the two bugs that cost me an evening each: Lever's epoch-ms timestamps
  (fixture dates are generated relative to *now*, never hardcoded, so they
  can't silently age past the freshness gate) and the `\bsde\b` regex
- prefilter rejects the planted junk: wrong seniority, wrong city, wrong
  function, a stale posting, an unlisted Ashby draft
- the LLM layer with the provider stubbed: batching splits at the configured
  size, JD truncation is applied before send, fenced/preamble/object-or-array
  JSON all parse, scores land on the right job when returned out of order, a
  failed batch warns and the run continues, and the draft kit always has every
  key the digest renders

---

## Cost

With ~15 boards, a tight `config.yaml`, Haiku screening and Sonnet drafting,
this lands in the low single-digit rupees per day. The prefilter is what makes
that true: nothing reaches a model until it has already passed title, location
and freshness. Set `SCREEN_PROVIDER=groq` or `gemini` and it's free.

Use `--limit` while tuning filters so a bad regex can't run up a bill.
