export const JOB_SOURCES = ["jobkorea", "saramin", "incruit"] as const;

export type JobSource = (typeof JOB_SOURCES)[number];

export type JobDeadlineKind = "date" | "always" | "until-hired";

export const JOB_SOURCE_LABELS: Record<JobSource, string> = {
  jobkorea: "잡코리아",
  saramin: "사람인",
  incruit: "인크루트",
};

export interface RawJobPosting {
  source: JobSource;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location?: string | null;
  employmentType?: string | null;
  experience?: string | null;
  education?: string | null;
  postedAtText?: string | null;
  deadlineText?: string | null;
}

export interface JobSourceLink {
  source: JobSource;
  sourceLabel: string;
  url: string;
}

export interface JobPostingRecommendation {
  id: string;
  source: JobSource;
  sourceLabel: string;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  employmentType: string | null;
  experience: string | null;
  education: string | null;
  postedAt: string | null;
  deadline: string | null;
  deadlineAt: string | null;
  deadlineLabel: string;
  deadlineKind: JobDeadlineKind;
  matchedDesiredJob: string;
  links: JobSourceLink[];
}

export interface JobSourceDiagnostic {
  source: JobSource;
  sourceLabel: string;
  status: "success" | "error";
  fetched: number;
  returned: number;
  excludedExpired: number;
  excludedByFilter: number;
  excludedDuplicate: number;
  message?: string;
}

export interface JobRecommendationResponse {
  desiredJob: string;
  results: JobPostingRecommendation[];
  fetchedAt: string;
  partial: boolean;
  /** Allows clients to reject a stale deployment which silently ignores filters. */
  filterContractVersion: 1;
  /** Deterministic serialization of the canonical filters applied by the server. */
  appliedFilterKey: string;
  sources: JobSourceDiagnostic[];
}
