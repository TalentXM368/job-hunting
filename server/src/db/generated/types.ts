import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type { UserRole, CandidateStatus, Ats, MatchStatus, ApplicationStatus } from "./enums";

export type Application = {
    id: Generated<string>;
    candidate_id: string;
    job_id: string;
    match_id: string | null;
    resume_id: string | null;
    status: Generated<ApplicationStatus>;
    fit_summary: string | null;
    tailored_bullets: string[];
    gaps: string[];
    cover_note: string | null;
    questions_to_ask: string[];
    approved_by: string | null;
    approved_at: Timestamp | null;
    submitted_at: Timestamp | null;
    failure_reason: string | null;
    /**
     * Screenshot of the confirmation page, as evidence of what was sent.
     */
    proof_url: string | null;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type ApplicationEvent = {
    id: Generated<string>;
    application_id: string;
    /**
     * Null when the system, not a person, caused the event.
     */
    actor_id: string | null;
    type: string;
    detail: unknown | null;
    created_at: Generated<Timestamp>;
};
export type Candidate = {
    id: Generated<string>;
    owner_id: string;
    status: Generated<CandidateStatus>;
    full_name: string;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedin_url: string | null;
    github_url: string | null;
    portfolio_url: string | null;
    current_title: string | null;
    current_company: string | null;
    years_experience: string | null;
    seniority: string | null;
    work_authorization: string | null;
    requires_sponsorship: boolean | null;
    willing_to_relocate: boolean | null;
    notice_period_days: number | null;
    /**
     * Annual amounts in `salary_currency`.
     */
    current_salary: number | null;
    expected_salary: number | null;
    salary_currency: Generated<string | null>;
    /**
     * Same shape as profile.example.json: core_skills, domains,
     * notable_projects, education, target_titles. Extracted from the resume,
     * then edited by the recruiter. This is what screening is scored against.
     */
    profile: unknown | null;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type CandidatePreference = {
    candidate_id: string;
    target_titles: string[];
    /**
     * Regexes, same semantics as include_titles / exclude_titles in prefilter.py.
     */
    include_title_patterns: string[];
    exclude_title_patterns: string[];
    locations: string[];
    allow_remote: Generated<boolean>;
    /**
     * Null disables the freshness gate.
     */
    max_age_days: Generated<number | null>;
    score_threshold: Generated<string>;
    updated_at: Generated<Timestamp>;
};
export type CandidateResume = {
    id: Generated<string>;
    candidate_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    /**
     * Where the file lives (object storage URL). The file is never in Postgres.
     */
    storage_url: string;
    /**
     * Plain text pulled from the file, kept for providers that cannot read PDFs.
     */
    extracted_text: string | null;
    is_primary: Generated<boolean>;
    uploaded_at: Generated<Timestamp>;
};
export type Company = {
    id: Generated<string>;
    ats: Ats;
    slug: string;
    name: string;
    is_active: Generated<boolean>;
    last_fetched_at: Timestamp | null;
    /**
     * HTTP status of the last poll; a board stuck on 404 is a dead slug.
     */
    last_http_status: number | null;
    last_job_count: number | null;
    created_at: Generated<Timestamp>;
};
export type Job = {
    id: Generated<string>;
    /**
     * "{ats}:{slug}:{id}" as built by the parsers in fetch.py. Dedupe key.
     */
    external_id: string;
    company_id: string;
    title: string;
    location: Generated<string>;
    url: string;
    description: Generated<string>;
    salary: string | null;
    employment_type: string | null;
    posted_at: Timestamp | null;
    first_seen_at: Generated<Timestamp>;
    last_seen_at: Generated<Timestamp>;
    /**
     * Set when the posting disappears from its board.
     */
    closed_at: Timestamp | null;
};
export type Match = {
    id: Generated<string>;
    candidate_id: string;
    job_id: string;
    status: Generated<MatchStatus>;
    /**
     * Final 0.0 to 10.0: the LLM's score where it re-scored the job, else the rule score.
     */
    score: string | null;
    reason: string | null;
    /**
     * What produced `score`: "rules", or "rules+<provider>/<model>" after LLM verification.
     */
    model: string | null;
    /**
     * The free, deterministic score every job gets before any LLM call.
     */
    rule_score: string | null;
    rule_reason: string | null;
    screened_at: Timestamp | null;
    created_at: Generated<Timestamp>;
};
export type User = {
    id: Generated<string>;
    email: string;
    name: string;
    role: Generated<UserRole>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type DB = {
    application_events: ApplicationEvent;
    applications: Application;
    candidate_preferences: CandidatePreference;
    candidate_resumes: CandidateResume;
    candidates: Candidate;
    companies: Company;
    jobs: Job;
    matches: Match;
    users: User;
};
