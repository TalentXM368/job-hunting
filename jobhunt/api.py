from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .search_service import _load_companies, _load_defaults, search

app = FastAPI(title="JobHunt API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    title: str = Field(default="", description="Primary title filter")
    locations: Optional[list[str]] = None
    allow_remote: Optional[bool] = None
    max_age_days: Optional[int] = Field(default=None)
    include_titles: Optional[list[str]] = None
    exclude_titles: Optional[list[str]] = None
    ats: Optional[list[str]] = None
    companies_filter: Optional[list[str]] = Field(default=None, alias="companies")
    employment_types: Optional[list[str]] = None
    use_mock: bool = False
    apply_include: bool = False
    apply_exclude: bool = True
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class SearchResponse(BaseModel):
    jobs: list[dict[str, Any]]
    meta: dict[str, Any]


@app.get("/health")
def health():
    companies = _load_companies()
    return {"status": "ok", "boards": len(companies)}


@app.get("/companies")
def companies():
    return {"companies": _load_companies()}


@app.get("/config/defaults")
def config_defaults():
    defaults = _load_defaults()
    return {"filters": defaults}


@app.post("/search", response_model=SearchResponse)
def search_post(req: SearchRequest):
    print(f"[search] title={req.title!r} mock={req.use_mock} loc={req.locations} remote={req.allow_remote} age={req.max_age_days} ats={req.ats} companies={req.companies_filter} emp={req.employment_types} inc={req.apply_include} exc={req.apply_exclude}")
    search_args = dict(
        title=req.title,
        locations=req.locations,
        allow_remote=req.allow_remote,
        include_titles=req.include_titles,
        exclude_titles=req.exclude_titles,
        ats=req.ats,
        companies_filter=req.companies_filter,
        employment_types=req.employment_types,
        use_mock=req.use_mock,
        apply_include=req.apply_include,
        apply_exclude=req.apply_exclude,
        limit=req.limit,
        offset=req.offset,
    )
    if "max_age_days" in req.model_fields_set:
        search_args["max_age_days"] = req.max_age_days
    result = search(**search_args)
    print(f"[search] -> scanned={result['meta']['scanned']} after_title={result['meta']['after_title']} total={result['meta']['total']}")
    return result


@app.get("/suggest/titles")
def suggest_titles(q: str = Query(default=""), limit: int = Query(6, ge=1, le=10), use_mock: bool = Query(False)):
    from .search_service import get_title_suggestions
    return {"suggestions": get_title_suggestions(q, use_mock, limit)}


@app.get("/suggest/locations")
def suggest_locations(q: str = Query(default=""), limit: int = Query(6, ge=1, le=10), use_mock: bool = Query(False)):
    from .search_service import get_location_suggestions
    return {"suggestions": get_location_suggestions(q, use_mock, limit)}


@app.get("/search", response_model=SearchResponse)
def search_get(
    q: str = Query(default="", alias="q"),
    title: str = Query(default=""),
    locations: Optional[str] = Query(default=None, description="comma-separated"),
    allow_remote: Optional[bool] = None,
    max_age_days: Optional[int] = None,
    ats: Optional[str] = Query(default=None, description="comma-separated: greenhouse,lever,ashby"),
    companies: Optional[str] = Query(default=None, description="comma-separated companies"),
    employment_types: Optional[str] = Query(default=None, description="comma-separated employment types"),
    use_mock: bool = False,
    apply_include: bool = False,
    apply_exclude: bool = True,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    t = title or q
    loc_list = [s.strip() for s in locations.split(",") if s.strip()] if locations else None
    ats_list = [s.strip() for s in ats.split(",") if s.strip()] if ats else None
    comp_list = [s.strip() for s in companies.split(",") if s.strip()] if companies else None
    emp_list = [s.strip() for s in employment_types.split(",") if s.strip()] if employment_types else None
    search_args = dict(
        title=t,
        locations=loc_list,
        allow_remote=allow_remote,
        ats=ats_list,
        companies_filter=comp_list,
        employment_types=emp_list,
        use_mock=use_mock,
        apply_include=apply_include,
        apply_exclude=apply_exclude,
        limit=limit,
        offset=offset,
    )
    if max_age_days is not None:
        search_args["max_age_days"] = max_age_days
    result = search(**search_args)
    return result
