export const UserRole = {
    admin: "admin",
    recruiter: "recruiter"
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const CandidateStatus = {
    active: "active",
    paused: "paused",
    archived: "archived"
} as const;
export type CandidateStatus = (typeof CandidateStatus)[keyof typeof CandidateStatus];
export const Ats = {
    greenhouse: "greenhouse",
    lever: "lever",
    ashby: "ashby"
} as const;
export type Ats = (typeof Ats)[keyof typeof Ats];
export const MatchStatus = {
    new: "new",
    shortlisted: "shortlisted",
    dismissed: "dismissed"
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];
export const ApplicationStatus = {
    draft: "draft",
    approved: "approved",
    queued: "queued",
    submitting: "submitting",
    submitted: "submitted",
    needs_human: "needs_human",
    failed: "failed",
    withdrawn: "withdrawn"
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];
