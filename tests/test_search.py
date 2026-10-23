import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jobhunt.fetch import Job
from jobhunt.search_service import apply_title_filter, deduplicate, search, sort_by_date, deterministic_job_id
from jobhunt.mock import fetch_all_mock


def make_job(title, location="Bangalore, India", ats="greenhouse", company="Acme", url="https://example.com/1", posted_at=None, description="Go"):
    return Job(job_id=f"{ats}:test:{title}", ats=ats, company=company, title=title, location=location, url=url, description=description, posted_at=posted_at)


def test_title_is_primary_not_or_with_include():
    jobs = [make_job("Backend Engineer"), make_job("SDE II"), make_job("Frontend Engineer")]
    result = search(title="Backend Engineer", jobs_override=jobs, apply_include=False, apply_exclude=False, locations=[], max_age_days=None)
    titles = [j["title"] for j in result["jobs"]]
    assert titles == ["Backend Engineer"]
    assert result["meta"]["after_title"] == 1


def test_title_empty_skips_filter():
    jobs = [make_job("Backend Engineer"), make_job("SDE II")]
    result = search(title="", jobs_override=jobs, apply_include=False, apply_exclude=False, locations=[], max_age_days=None)
    assert result["meta"]["total"] == 2


def test_title_query_does_not_match_a_partial_word():
    jobs = [make_job("JavaScript Engineer", url="https://example.com/js")]
    assert apply_title_filter(jobs, "Java") == []


def test_python_developer_search_does_not_match_unrelated_engineering_roles():
    jobs = [
        make_job("Python Developer", description="Python backend role"),
        make_job("Infrastructure Engineer", description="Python automation for cloud infra"),
        make_job("Platform Engineer", description="Python for tooling")
    ]
    result = apply_title_filter(jobs, "python developer")
    assert [job.title for job in result] == ["Python Developer"]


def test_developer_query_matches_engineer_title_without_description_role_leak():
    jobs = [
        make_job("Python Engineer", description="Python backend role"),
        make_job("Infrastructure Engineer", description="We are looking for a Python Developer."),
    ]
    result = apply_title_filter(jobs, "python developer")
    assert [job.title for job in result] == ["Python Engineer"]


def test_explicit_title_search_is_not_removed_by_default_profile_exclusions():
    jobs = [make_job("Sr. Solutions Architect", location="Bengaluru, India")]
    result = search(
        title="Sr. Solutions Architect",
        jobs_override=jobs,
        locations=[],
        max_age_days=None,
    )
    assert [job["title"] for job in result["jobs"]] == ["Sr. Solutions Architect"]


def test_aiml_engg_query_matches_ai_ml_titles_only():
    jobs = [
        make_job("AI/ML Engineer", description="Build ML systems"),
        make_job("Machine Learning Engineer", description="Train models"),
        make_job("Platform Engineer", description="AI systems for infra"),
        make_job("Python Developer", description="Python backend role")
    ]
    result = apply_title_filter(jobs, "AIML Engg")
    assert [job.title for job in result] == ["AI/ML Engineer", "Machine Learning Engineer"]


def test_search_title_query_overrides_broad_default_title_regexes():
    jobs = [
        make_job("Python Developer", description="Python backend role"),
        make_job("IT Software Engineer, Infrastructure", description="We are looking for a Python Developer to build infrastructure automation."),
        make_job("API Developer", description="We are looking for a Python Developer to work on our API platform."),
        make_job("Platform Engineer", description="Python for tooling")
    ]
    result = search(title="python developer", jobs_override=jobs, apply_exclude=False, locations=[], max_age_days=None)
    assert [job["title"] for job in result["jobs"]] == ["Python Developer"]


def test_role_query_does_not_fall_back_to_description_only_matches():
    jobs = [
        make_job("IT Software Engineer, Infrastructure", description="We are looking for a Python Developer to build infrastructure automation."),
        make_job("Platform Engineer", description="Python Developer role supporting platform tooling.")
    ]
    result = search(title="python developer", jobs_override=jobs, apply_exclude=False, locations=[], max_age_days=None)
    assert result["jobs"] == []


def test_sde_alias_does_not_match_an_embedded_substring():
    jobs = [make_job("SDEvelopment Engineer")]
    assert apply_title_filter(jobs, "SDE") == []


def test_explicit_any_time_disables_default_age_filter():
    old_date = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
    jobs = [make_job("Backend Engineer", posted_at=old_date)]
    result = search(title="Backend", jobs_override=jobs, apply_exclude=False,
                    locations=[], max_age_days=None)

    assert result["meta"]["total"] == 1


def test_company_filter_matches_only_selected_company():
    jobs = [
        make_job("Backend Engineer", company="Acme"),
        make_job("Backend Engineer", company="Acme Labs", url="https://example.com/labs"),
    ]
    result = search(jobs_override=jobs, companies_filter=["Acme"],
                    apply_exclude=False, locations=[], max_age_days=None)

    assert [job["company"] for job in result["jobs"]] == ["Acme"]


def test_include_applied_after_title_when_toggled():
    jobs = [make_job("Backend Engineer"), make_job("Backend Manager")]
    result = search(title="Backend", jobs_override=jobs, apply_include=True, include_titles=[r"\bengineer\b"], apply_exclude=False, locations=[], max_age_days=None)
    titles = [j["title"] for j in result["jobs"]]
    assert "Backend Manager" not in titles
    assert "Backend Engineer" in titles


def test_exclude_applied_by_default_and_toggle():
    jobs = [make_job("Backend Engineer"), make_job("Staff Backend Engineer")]
    r_on = search(title="Backend", jobs_override=jobs, apply_exclude=True, exclude_titles=[r"\bstaff\b"], locations=[], max_age_days=None, apply_include=False)
    assert len(r_on["jobs"]) == 1
    r_off = search(title="Backend", jobs_override=jobs, apply_exclude=False, exclude_titles=[r"\bstaff\b"], locations=[], max_age_days=None, apply_include=False)
    assert len(r_off["jobs"]) == 2


def test_deduplication():
    j1 = make_job("Backend Engineer", url="https://example.com/a")
    j2 = make_job("Backend Engineer", url="https://example.com/a")
    j2.job_id = j1.job_id
    result = deduplicate([j1, j2])
    assert len(result) == 1


def test_pagination_limit_offset():
    jobs = [make_job(f"Backend Engineer {i}") for i in range(60)]
    r1 = search(title="Backend", jobs_override=jobs, apply_exclude=False, locations=[], max_age_days=None, limit=50, offset=0)
    assert len(r1["jobs"]) == 50
    assert r1["meta"]["total"] == 60
    r2 = search(title="Backend", jobs_override=jobs, apply_exclude=False, locations=[], max_age_days=None, limit=50, offset=50)
    assert len(r2["jobs"]) == 10


def test_sort_by_date_nulls_last():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    old = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    jobs = [make_job("A", posted_at=None), make_job("B", posted_at=old), make_job("C", posted_at=now)]
    sorted_jobs = sort_by_date(jobs)
    assert sorted_jobs[0].title == "C"
    assert sorted_jobs[-1].title == "A"


def test_mock_funnel_with_title():
    jobs = fetch_all_mock()
    result = search(title="Backend Engineer", use_mock=True, jobs_override=jobs, apply_exclude=True, locations=["bangalore"], max_age_days=30, apply_include=False)
    assert result["meta"]["scanned"] == len(jobs)
    assert all("backend" in j["title"].lower() for j in result["jobs"])


def test_deterministic_job_id():
    j = make_job("Backend Engineer", company="Acme", url="https://example.com/1", ats="greenhouse")
    id1 = deterministic_job_id(j)
    id2 = deterministic_job_id(j)
    assert id1 == id2
    assert id1.startswith("greenhouse:")
