from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

import yaml
from pathlib import Path

from .fetch import Job
from .mock import fetch_all_mock
from .prefilter import prefilter

ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_AGE = object()


def _normalize_words(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _contains_phrase(text: str, phrase: str) -> bool:
    normalized_text = _normalize_words(text)
    normalized_phrase = _normalize_words(phrase)
    return bool(normalized_phrase) and f" {normalized_phrase} " in f" {normalized_text} "


def _load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _load_companies() -> list[dict]:
    cfg = _load_yaml(ROOT / "config.yaml")
    companies_file = cfg.get("companies_file", "companies.yaml")
    data = _load_yaml(ROOT / companies_file)
    return data.get("companies") or []


def _load_defaults() -> dict:
    cfg = _load_yaml(ROOT / "config.yaml")
    return cfg.get("filters") or {}


def deterministic_job_id(job: Job) -> str:
    raw = f"{job.company}|{job.title}|{job.url}".lower().strip()
    h = hashlib.sha1(raw.encode()).hexdigest()[:12]
    return f"{job.ats}:{h}"


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    v = value.replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.fromisoformat(v) if fmt is None else datetime.strptime(v, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def deduplicate(jobs: list[Job]) -> list[Job]:
    seen: dict[str, Job] = {}
    for j in jobs:
        if j.job_id not in seen:
            seen[j.job_id] = j
    return list(seen.values())


def apply_title_filter(jobs: list[Job], title: str) -> list[Job]:
    if not title or not title.strip():
        return jobs
    q = title.strip().lower()
    q_norm = re.sub(r"[^a-z0-9]+", " ", q).strip()
    tokens = [t for t in q_norm.split() if t]
    if not tokens:
        return jobs

    import difflib

    q_aliases = {
        "sde": ["software development engineer", "sde"],
        "sre": ["site reliability engineer", "sre"],
    }
    alias = q_aliases.get(q_norm)
    if alias:
        return [j for j in jobs if any(_contains_phrase(j.title, a) for a in alias)]

    token_aliases = {
        "developer": ["developer", "engineer"],
        "engineer": ["engineer", "developer"],
        "engg": ["engineer", "developer", "engg"],
        "eng": ["engineer", "developer", "eng"],
        "engr": ["engineer", "developer", "engr"],
        "aiml": ["aiml", "ai ml", "ai/ml", "artificial intelligence", "machine learning", "ml", "ai"],
        "ml": ["ml", "machine learning"],
        "ai": ["ai", "artificial intelligence"],
        "sr": ["sr", "senior"],
    }
    role_tokens = {"developer", "engineer", "engg", "eng", "engr", "sde", "sre", "sr", "analyst", "architect", "scientist", "designer", "manager", "consultant", "specialist", "intern"}
    role_token_indices = [index for index, token in enumerate(tokens) if token in role_tokens]
    SKILL_TOKENS = {"python", "java", "go", "javascript", "js", "typescript", "react", "node", "aws", "kubernetes", "k8s", "docker", "sql", "postgres", "redis", "ai", "ml"}

    def hay_contains_norm(hay: str, term: str) -> bool:
        term = term.lower().strip()
        if " " in term:
            return term in hay
        return bool(re.search(rf"\b{re.escape(term)}\b", hay))

    def score_title(j: Job) -> float:
        tl = j.title.lower()
        tl_norm = re.sub(r"[^a-z0-9]+", " ", tl).strip()
        dl = (j.description or "").lower()
        hay = f"{tl} {dl}"
        hay_norm = re.sub(r"[^a-z0-9]+", " ", hay).strip()
        qn = q_norm

        if qn in tl_norm:
            if qn == tl_norm:
                return 1.0
            if len(tokens) == 1:
                allowed_suffixes = {
                    "engineer", "developer", "analyst", "architect", "scientist",
                    "programmer", "specialist", "sre", "devops", "engineeringspecialist"
                }
                match = re.search(rf"\b{re.escape(qn)}\b\s+(?:[a-z0-9]+\s+)?(?:{'|'.join(sorted(re.escape(s) for s in allowed_suffixes))})\b", tl_norm)
                if match:
                    return 1.0
                return 0.0
            if re.search(rf"\b{re.escape(qn)}\b", tl_norm):
                return 1.0
            return 0.0
        if qn in hay_norm:
            if re.search(rf"\b{re.escape(qn)}\b", tl_norm):
                return 0.98
            if not role_token_indices:
                return 0.98

        ratio = difflib.SequenceMatcher(None, qn, tl_norm).ratio()
        if len(qn) >= 4 and ratio >= 0.85:
            return ratio

        # Strong role match: every meaningful token must be present in the title, with
        # a lightweight synonym map only used at the title level.
        expanded_tokens = [token_aliases.get(tok, [tok]) for tok in tokens]
        title_hits = [any(hay_contains_norm(tl_norm, a) for a in alts) for alts in expanded_tokens]
        if all(title_hits):
            return 0.9

        # Only if title-level hits are too weak do we consider description text.
        # Keep role synonyms title-only. Otherwise a description mentioning
        # "Python developer" would make every unrelated engineer role match.
        description_tokens = [
            [token] if token in role_tokens else token_aliases.get(token, [token])
            for token in tokens
        ]
        desc_hits = [any(hay_contains_norm(hay_norm, a) for a in alts) for alts in description_tokens]
        role_hits = [
            any(hay_contains_norm(tl_norm, a) for a in expanded_tokens[index])
            for index in role_token_indices
        ]
        if all(desc_hits) and all(role_hits):
            return 0.8

        return 0.0

    scored = []
    for j in jobs:
        s = score_title(j)
        if s >= 0.85:
            scored.append((s, j))
    if scored:
        scored.sort(key=lambda x: x[0], reverse=True)
        return [j for _, j in scored]
    if role_token_indices:
        return []

    def hay_contains(hay: str, term: str) -> bool:
        term = term.lower().strip()
        if " " in term:
            return term in hay
        return bool(re.search(rf"\b{re.escape(term)}\b", hay))

    fallback = []
    for j in jobs:
        tl = re.sub(r"[^a-z0-9]+", " ", j.title.lower()).strip()
        hay = f"{tl} {re.sub(r'[^a-z0-9]+', ' ', (j.description or '').lower()).strip()}"
        hay_padded = f" {hay} "
        if all(any(hay_contains(hay_padded, a) for a in token_aliases.get(tok, [tok])) for tok in tokens):
            fallback.append(j)
    if fallback:
        return fallback[:200]
    return []


_SUGGEST_CACHE: dict[str, Any] = {"jobs": None, "ts": 0, "use_mock": None}
_SUGGEST_TTL = 300


def _cached_jobs(use_mock: bool = False) -> list[Job]:
    import time
    now = time.time()
    if _SUGGEST_CACHE["jobs"] is not None and _SUGGEST_CACHE["use_mock"] == use_mock and now - _SUGGEST_CACHE["ts"] < _SUGGEST_TTL:
        return _SUGGEST_CACHE["jobs"]
    jobs = fetch_all_mock() if use_mock else __import__("jobhunt.fetch", fromlist=["fetch_all"]).fetch_all(_load_companies())
    _SUGGEST_CACHE.update({"jobs": jobs, "ts": now, "use_mock": use_mock})
    return jobs


def _normalize_suggest(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _rank_suggestions(candidates: list[str], q_norm: str, limit: int = 6) -> list[str]:
    seen: dict[str, str] = {}
    for c in candidates:
        k = c.lower().strip()
        if k not in seen:
            seen[k] = c
    uniq = list(seen.values())
    if not q_norm:
        from collections import Counter
        cnt = Counter(c.lower().strip() for c in candidates)
        uniq.sort(key=lambda x: (-cnt[x.lower().strip()], x.lower()))
        return uniq[:limit]
    scored: list[tuple[int, str]] = []
    for c in uniq:
        cn = _normalize_suggest(c)
        if cn.startswith(q_norm):
            scored.append((0, c))
        elif any(tok.startswith(q_norm) or q_norm in tok for tok in cn.split()):
            scored.append((1, c))
        elif q_norm in cn:
            scored.append((2, c))
        else:
            import difflib
            if difflib.SequenceMatcher(None, q_norm, cn).ratio() >= 0.6:
                scored.append((3, c))
    scored.sort(key=lambda x: (x[0], x[1].lower()))
    return [c for _, c in scored[:limit]]


def get_title_suggestions(q: str = "", use_mock: bool = False, limit: int = 6) -> list[str]:
    q_norm = _normalize_suggest(q)
    try:
        jobs = _cached_jobs(use_mock)
    except Exception:
        jobs = []
    titles = [j.title for j in jobs if j.title]
    if not titles:
        fallback = ["Backend Engineer", "Software Engineer", "Frontend Engineer", "Data Scientist", "SDE", "SRE", "Python Developer", "AI/ML Engineer"]
        return _rank_suggestions(fallback, q_norm, limit)
    return _rank_suggestions(titles, q_norm, limit)


def get_location_suggestions(q: str = "", use_mock: bool = False, limit: int = 6) -> list[str]:
    q_norm = _normalize_suggest(q)
    static = ["Bangalore, India", "Bengaluru, India", "Hyderabad, India", "Pune, India", "Delhi, India", "Mumbai, India", "Chennai, India", "Remote (India)", "Remote", "India"]
    cfg_locs = _load_defaults().get("locations") or []
    static = list(dict.fromkeys(cfg_locs + static))
    try:
        jobs = _cached_jobs(use_mock)
        live = []
        for j in jobs:
            if j.location:
                live.append(j.location.strip())
                for part in re.split(r"[,/]", j.location):
                    p = part.strip()
                    if p and p not in live:
                        live.append(p)
        candidates = list(dict.fromkeys(static + live))
    except Exception:
        candidates = static
    return _rank_suggestions(candidates, q_norm, limit)


def apply_ats_filter(jobs: list[Job], ats_list: list[str] | None) -> list[Job]:
    if not ats_list:
        return jobs
    allowed = {a.lower() for a in ats_list}
    return [j for j in jobs if j.ats.lower() in allowed]


def sort_by_date(jobs: list[Job]) -> list[Job]:
    def key(j: Job):
        dt = _parse_date(j.posted_at)
        return dt or datetime.min.replace(tzinfo=timezone.utc)
    return sorted(jobs, key=key, reverse=True)


EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"]


def _employment_match(job: Job, types: list[str]) -> bool:
    if not types:
        return True
    hay = f"{job.title} {(job.description or '')}".lower()
    for t in types:
        tl = t.lower()
        if tl == "full-time" and ("full-time" in hay or "full time" in hay):
            return True
        if tl in hay:
            return True
    return False


def search(
    title: str = "",
    locations: list[str] | None = None,
    allow_remote: bool | None = None,
    max_age_days: int | None | object = _DEFAULT_AGE,
    include_titles: list[str] | None = None,
    exclude_titles: list[str] | None = None,
    ats: list[str] | None = None,
    companies_filter: list[str] | None = None,
    employment_types: list[str] | None = None,
    use_mock: bool = False,
    apply_include: bool = False,
    apply_exclude: bool = True,
    limit: int = 50,
    offset: int = 0,
    companies: list[dict] | None = None,
    jobs_override: list[Job] | None = None,
) -> dict[str, Any]:
    defaults = _load_defaults()
    explicit_exclude_titles = exclude_titles is not None
    if locations is None:
        locations = defaults.get("locations") or []
    if allow_remote is None:
        allow_remote = bool(defaults.get("allow_remote", True))
    if max_age_days is _DEFAULT_AGE:
        max_age_days = defaults.get("max_age_days")
    if include_titles is None:
        include_titles = defaults.get("include_titles") or []
    if exclude_titles is None:
        exclude_titles = defaults.get("exclude_titles") or []

    if title and title.strip():
        include_titles = [r"."]

    if jobs_override is not None:
        jobs = list(jobs_override)
        per_board: dict[str, int] = {}
        scanned = len(jobs)
    elif use_mock:
        jobs = fetch_all_mock()
        per_board = {}
        for j in jobs:
            per_board[j.ats] = per_board.get(j.ats, 0) + 1
        scanned = len(jobs)
    else:
        comps = companies if companies is not None else _load_companies()
        if ats:
            allowed = {a.lower() for a in ats}
            comps = [c for c in comps if c.get("ats", "").lower() in allowed]
        from .fetch import fetch_all
        jobs = fetch_all(comps)
        per_board = {}
        for j in jobs:
            key = f"{j.ats}:{j.company}"
            per_board[key] = per_board.get(key, 0) + 1
        scanned = len(jobs)

    jobs = deduplicate(jobs)
    deduped = len(jobs)

    after_title = None
    if title and title.strip():
        jobs = apply_title_filter(jobs, title)
        after_title = len(jobs)

    if companies_filter:
        cf = {c.lower() for c in companies_filter}
        jobs = [j for j in jobs if j.company.strip().lower() in cf]

    if employment_types:
        jobs = [j for j in jobs if _employment_match(j, employment_types)]

    if apply_include and include_titles:
        cfg_inc = {"include_titles": include_titles, "exclude_titles": [], "locations": [], "allow_remote": True, "max_age_days": None}
        before = len(jobs)
        jobs = prefilter(jobs, cfg_inc)
        if len(jobs) == 0 and before > 0 and title.strip():
            pass

    # An explicit title search is a direct query, so profile exclusions such
    # as "architect" must not hide its results. Custom exclusions still apply.
    exc = exclude_titles if apply_exclude and (explicit_exclude_titles or not title.strip()) else []
    cfg = {
        "include_titles": [r"."] if not apply_include else include_titles if include_titles else [r"."],
        "exclude_titles": exc,
        "locations": locations,
        "allow_remote": allow_remote,
        "max_age_days": max_age_days,
    }
    jobs = prefilter(jobs, cfg)
    after_prefilter = len(jobs)

    if ats and jobs_override is not None:
        jobs = apply_ats_filter(jobs, ats)
    elif ats and use_mock:
        jobs = apply_ats_filter(jobs, ats)

    jobs = sort_by_date(jobs)
    total = len(jobs)

    limit = max(1, min(100, int(limit)))
    offset = max(0, int(offset))
    paginated = jobs[offset: offset + limit]

    for j in paginated:
        if not j.job_id or ":" not in j.job_id:
            j.job_id = deterministic_job_id(j)

    return {
        "jobs": [j.to_dict() for j in paginated],
        "meta": {
            "scanned": scanned,
            "deduped": deduped,
            "after_title": after_title if after_title is not None else deduped,
            "after_prefilter": after_prefilter,
            "total": total,
            "limit": limit,
            "offset": offset,
            "per_board": per_board,
        },
    }
