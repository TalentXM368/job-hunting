# Job Hunting: How It Works and How to Use It

Team guide, written 2026-11-16. Covers the recruiter web app in this repo: what it does, how to start it, and how to use each screen.

## What it does

It turns thousands of public postings into a short, scored list per candidate, with a ready-made application kit, and keeps a record of every application. The steps run in this order:

1. **Boards.** The tool reads public career pages on Greenhouse, Lever and Ashby and stores every open posting. Today it tracks 12 companies and about 3,900 open jobs.
2. **Candidate profile.** A recruiter adds a candidate from their resume. The profile holds contact details, experience, skills, projects and the titles the candidate should aim at.
3. **Job preferences.** Per candidate: locations, remote, posting age, title patterns to include or exclude, and the score a job must reach to count.
4. **Find matches.** Every job that passes the preferences gets a rule-based score from 0 to 10, at no cost. The AI then re-checks only the best few.
5. **Application kit.** From a match, the recruiter starts an application and generates a kit: why it fits, resume bullets rewritten for the role, honest gaps, a cover note, two questions to ask. The recruiter edits it and approves it.
6. **Apply and track.** Applying happens on the company's own site. The recruiter then marks the application submitted. Every step is logged with who did it and when.

## Starting it up

One command starts both halves. In a terminal, from the project folder:

```
cd server
npm run dev:all
```

Then open http://localhost:5173. The API runs on port 8787 behind it. The API takes 20 to 40 seconds to connect to the database on first start; errors in that window are normal and clear on their own.

The data lives in a shared Neon Postgres database, so everyone running the tool sees the same candidates, jobs and applications. Resume files are stored on the machine that runs the API.

There is no login yet. Anyone who can open the address can see and change every candidate. Run it on your own machine and do not put it on a public address with real candidate data until login is added.

## Boards

The **Boards** page lists the companies the tool reads. Choose **Refresh all boards** once a day (it takes 20 to 60 seconds) so new postings come in and closed ones drop out.

| Action | How |
| --- | --- |
| Add a company | Pick the ATS, type the slug (the last part of the careers URL, e.g. `stripe` from boards.greenhouse.io/stripe), optionally a display name, then **Add board** |
| Fetch one company now | **Fetch now** on its row |
| Rename | **Rename** on its row |
| Pause a company without losing its jobs | Untick **Active** |
| Remove a company | **Delete** (refused if any of its jobs has an application; deactivate instead) |

The **HTTP** column shows the last fetch result. Green 200 is fine. Anything else usually means the slug is wrong or the company moved to a different ATS. Only Greenhouse, Lever and Ashby boards can be read; LinkedIn and Naukri cannot.

## Adding a candidate

Go to **Candidates** and choose **Add candidate**. Upload the resume first and the form fills itself.

1. **Upload resume.** PDF, .txt or .md, up to 4 MB. The resume is read on the spot with no AI: contact details, title and company, years of experience, skills, projects with numbers, education and target titles are filled in.
2. **Read with AI** (optional). For resumes written as prose, where the rules miss things, this sends the resume to the model and fills the form from its answer. It costs tokens; the plain read does not.
3. **Review every field.** Nothing is saved yet. Fix anything read wrongly. The **Years of experience** and **Seniority** fields drive every seniority judgement in matching, so check them.
4. **Save candidate.** The record is created and the resume is attached as the primary one.

To change a candidate later, open them and use the **Profile** tab: edit any field and choose **Save profile**. More resumes can be uploaded there; the primary one is attached to applications by default. A candidate's first resume upload fills the form automatically; later uploads do not, so an edited profile is never overwritten unasked.

To remove a candidate, use **Delete** on their row or **Delete candidate** on the profile. Their resumes, matches and applications go with them.

## Job preferences

The **Job preferences** tab holds the free filters. Only jobs that pass them are scored, so tight preferences keep the list short and the AI cost low.

| Field | What it does |
| --- | --- |
| Target titles | A job fits when its title has every word of one of these ("developer" and "engineer" count as the same word). Empty means the target titles on the profile are used. |
| Include title patterns | Optional regular expressions, one per line. A title matching any of them passes too. |
| Exclude title patterns | Regular expressions, one per line. A matching title is dropped. The usual one for a mid-level candidate: `\b(staff|principal|manager|director|intern)\b` |
| Locations | Words matched against the posting's location, e.g. bangalore, bengaluru, india. Empty accepts every location. |
| Allow remote | Lets any posting that says remote through, whatever its location. |
| Maximum posting age | Postings older than this many days are skipped. Tick **Any time** to disable. |
| Score threshold | 0 to 10. Matches at or above it count as worth applying to and appear in the digest. 7 is the default; 6 is more generous. |

Choose **Save** after changes. **Load defaults** resets the form to a neutral starting point.

## Finding matches

On the candidate's **Matches** tab, choose **Find matches**. It takes the open jobs that pass the preferences, skips any this candidate was already scored against, and scores up to 40 new ones per run (the box next to the button raises this to 100). Run it again to score the next batch.

Every job first gets a rule-based score, which costs nothing:

| Rules check | Effect on the score |
| --- | --- |
| Title fits a target title | up to +3 |
| Candidate's skills named in the posting (synonyms understood: k8s = Kubernetes, golang = Go) | up to +4 |
| Seniority: same level +1; one level up -1; two or more levels up -2 to -3; management role -3; posting asks for more years than the candidate has -1 to -3 | as listed |
| Candidate's domain mentioned | +1 |
| Blockers: security clearance, US citizenship required, no visa sponsorship when the candidate needs it, PhD required | -3 each |

With **Verify top matches with AI** ticked, the model then re-scores at most 10 of the best rule-scored jobs (only those at 5 or above) and writes its own one-line reason. Its score replaces the rule score for those jobs; the rule score stays visible beside it. Untick the box for a free, rules-only run.

Each match shows the score, the reason, and whether rules or the model produced it. Use **Shortlist**, **Dismiss** and **Restore** to sort the list, and **Start application** on the ones worth pursuing. **Preview digest** opens an email-style summary of the matches above the threshold; **Email digest** sends it, once email is configured.

## Applications

**Start application** on a match creates a draft and opens it. The **Applications** page lists every application across candidates, filterable by status; each candidate's **Applications** tab lists theirs.

1. **Generate the kit.** **Generate template kit** builds it from the profile and the posting at no cost; it reads like a template and needs editing. **Draft with AI** asks the model for a written kit: fit summary, three or four resume bullets based only on the candidate's real projects, honest gaps, a 120 to 160 word cover note, two questions for the interviewer.
2. **Edit and save.** Every part is editable. Check every claim against the candidate before going further; the model only knows what the profile says. Pick which resume to send.
3. **Approve.** Records the recruiter's sign-off with a timestamp. The kit becomes read-only.
4. **Apply on the company site.** Choose **Open posting** and apply there with the kit. The tool does not submit anything itself.
5. **Mark submitted.** Records the date. **Withdraw** and **Reopen** are also available; **Delete application** removes it and its history, the match stays.

| Status | Meaning |
| --- | --- |
| Draft | Kit being prepared; editable |
| Approved | Recruiter signed off; apply on the company site next |
| Submitted | Applied, marked by the recruiter |
| Withdrawn | Not pursued; can be reopened |
| Needs attention, Failed, Queued, Submitting | Reserved for automatic submission, which is not built yet |

The **History** panel on each application shows every step: who created, edited, generated, approved or submitted it, and when.

## Where the AI is used

Everything works without the AI; the AI is an opt-in on three actions. Costs are small: each action is one or two model calls.

| Action | AI used | Model | Time seen |
| --- | --- | --- | --- |
| Reading boards, search, filters | No | - | seconds |
| Extract profile from resume | No | - | instant |
| Read with AI / Extract with AI | Yes, one call | claude-sonnet-5-5 | about 4 s |
| Find matches, rules | No | - | about 1 s |
| Find matches, AI verification of the top 10 | Yes, two calls | claude-haiku-5-5 | about 40 s |
| Generate template kit | No | - | instant |
| Draft with AI | Yes, one call | claude-sonnet-5-5 | about 15 s |

If no key is configured, a notice says so and the AI buttons are hidden; everything else keeps working. The key and the scoring mode (`hybrid`, `rules` or `llm`) are set in the `.env` file on the machine running the API:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
SCORING_MODE=hybrid        # hybrid | rules | llm
LLM_RESCORE_MAX=10         # how many top matches the AI re-checks
LLM_RESCORE_MIN=5          # rule score a match needs before the AI looks at it
```

## Limits and things to know

- **It does not submit applications.** Approval records a decision; a person applies on the company site and marks it submitted. Automatic submission is planned but not built.
- **No login.** One shared recruiter identity; anyone with the address sees everything. Keep it on internal machines until login exists.
- **Resumes:** PDF, .txt and .md only, up to 4 MB. Word files are not read yet. A scanned PDF with no text layer needs the AI read or a .txt export.
- **Rules count evidence, not nuance.** Two postings with the same boilerplate get the same reason. That is what the AI verification is for.
- **The template kit is a template.** Treat it as a starting point; the AI kit is far closer to something a person would send.
- **Boards refresh when someone presses the button.** A scheduled daily refresh exists in the code but only runs once the tool is deployed to Vercel.
- **Email digest** needs SMTP details in `.env`; until then **Email digest** reports that email is not configured.

## Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| `http proxy error: ECONNREFUSED` in the terminal, pages show "The API server is not running" | Only the UI is running | Start both with `cd server` then `npm run dev:all`, or run `npm run dev` in `server/` in a second terminal |
| Same error for the first half minute after starting | The API is still connecting to the database | Wait 30 seconds and reload |
| "No LLM key configured" notice | No API key in `.env` | Add `ANTHROPIC_API_KEY` (or Gemini/Groq) to `.env` and restart the API |
| "This PDF has no readable text layer" | Scanned PDF | Use **Read with AI**, or upload a .txt export |
| Find matches returns 0 passed filters | Preferences too tight | Loosen locations, raise the posting age, remove exclude patterns, or add target titles |
| A board shows HTTP 404 | Wrong slug, or the company changed ATS | Check the careers URL and re-add the board |
| "Cannot edit an application that is approved" | Kits lock on approval | **Reopen** it, edit, approve again |
| Delete board refused | Its jobs have applications | Untick **Active** instead |
