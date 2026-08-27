import {
  forwardRef,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import {
  Check,
  ChevronDown,
  GraduationCap,
  MapPin,
  Search,
  UserRoundSearch,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  normalizeJobRecommendationFilters,
  MAX_JOB_RECOMMENDATION_REGIONS,
  type JobEducationLevel,
  type JobExperienceType,
  type JobRecommendationFilters,
} from "@/lib/jobRecommendations";
import {
  JOB_REGION_ANY,
  JOB_REGION_PROVINCES,
  type JobRegionOption,
} from "@/lib/jobRegions";

const EDUCATION_OPTIONS: readonly {
  value: JobEducationLevel;
  label: string;
}[] = [
  { value: "any", label: "학력 무관" },
  { value: "high-school-or-less", label: "고교 졸업 이하" },
  { value: "high-school", label: "고등학교 졸업" },
  { value: "associate", label: "대학 졸업(2, 3년제)" },
  { value: "bachelor", label: "대학교 졸업(4년제)" },
  { value: "master", label: "대학원 석사 졸업" },
  { value: "doctorate", label: "대학원 박사 졸업" },
  { value: "post-doctorate", label: "박사 졸업 이상" },
] as const;

const EXPERIENCE_OPTIONS: readonly {
  value: JobExperienceType;
  label: string;
}[] = [
  { value: "any", label: "경력 무관" },
  { value: "entry", label: "신입" },
  { value: "experienced", label: "경력" },
] as const;

type FilterPopover = "education" | "experience" | "region" | null;
type ExperienceRangeKind = "up-to-one-year" | "minimum-years" | null;

interface JobRecommendationSearchControlsProps {
  loading: boolean;
  onDraftChange: () => void;
  onSearch: (filters: JobRecommendationFilters) => void;
}

export function JobRecommendationSearchControls({
  loading,
  onDraftChange,
  onSearch,
}: JobRecommendationSearchControlsProps) {
  const [openPopover, setOpenPopover] = useState<FilterPopover>(null);
  const [education, setEducation] = useState<JobEducationLevel[]>(["any"]);
  const [experienceTypes, setExperienceTypes] = useState<JobExperienceType[]>([
    "any",
  ]);
  const [rangeKind, setRangeKind] = useState<ExperienceRangeKind>(null);
  const [minimumYears, setMinimumYears] = useState("");
  const [selectedRegions, setSelectedRegions] = useState<JobRegionOption[]>([
    JOB_REGION_ANY,
  ]);
  const [regionQuery, setRegionQuery] = useState("");
  const [expandedProvince, setExpandedProvince] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);

  const hasExperienced = experienceTypes.includes("experienced");
  const selectedRegionCodes = useMemo(
    () => new Set(selectedRegions.map(region => region.code)),
    [selectedRegions]
  );

  const handleEducationToggle = (value: JobEducationLevel) => {
    setValidationError(null);
    onDraftChange();
    setEducation(current => toggleExclusiveAny(current, value));
  };

  const handleExperienceToggle = (value: JobExperienceType) => {
    setValidationError(null);
    onDraftChange();
    setExperienceTypes(current => {
      const next = toggleExclusiveAny(current, value);
      if (!next.includes("experienced")) {
        setRangeKind(null);
        setMinimumYears("");
      }
      return next;
    });
  };

  const handleRangeKindChange = (next: Exclude<ExperienceRangeKind, null>) => {
    setValidationError(null);
    onDraftChange();
    setRangeKind(current => (current === next ? null : next));
    if (next === "up-to-one-year") setMinimumYears("");
  };

  const handleMinimumYearsChange = (value: string) => {
    if (value && !/^\d{1,2}$/.test(value)) return;
    const numericValue = value ? Number(value) : null;
    if (numericValue !== null && (numericValue < 1 || numericValue > 99))
      return;
    setValidationError(null);
    onDraftChange();
    setMinimumYears(value);
    setRangeKind("minimum-years");
  };

  const toggleRegion = (region: JobRegionOption) => {
    setValidationError(null);
    setRegionError(null);

    if (region.code === "any") {
      if (selectedRegions.length === 1 && selectedRegions[0].code === "any")
        return;
      onDraftChange();
      setSelectedRegions([JOB_REGION_ANY]);
      return;
    }

    if (selectedRegionCodes.has(region.code)) {
      onDraftChange();
      setSelectedRegions(current => {
        const next = current.filter(item => item.code !== region.code);
        return next.length > 0 ? next : [JOB_REGION_ANY];
      });
      return;
    }

    const nonAnyCount = selectedRegions.filter(
      item => item.code !== "any"
    ).length;
    if (nonAnyCount >= MAX_JOB_RECOMMENDATION_REGIONS) {
      setRegionError(
        `지역은 최대 ${MAX_JOB_RECOMMENDATION_REGIONS}개까지 선택할 수 있습니다.`
      );
      return;
    }

    onDraftChange();
    setSelectedRegions(current => [
      ...current.filter(item => item.code !== "any"),
      region,
    ]);
  };

  const removeRegion = (code: string) => {
    const region = selectedRegions.find(item => item.code === code);
    if (region) toggleRegion(region);
  };

  const handleSubmit = () => {
    if (
      hasExperienced &&
      rangeKind === "minimum-years" &&
      minimumYears === ""
    ) {
      setValidationError("경력 최소 연수를 1~99 사이 숫자로 입력해주세요.");
      setOpenPopover("experience");
      return;
    }

    const filters = normalizeJobRecommendationFilters({
      education,
      experience: {
        types: experienceTypes,
        range:
          rangeKind === "up-to-one-year"
            ? { kind: "up-to-one-year" }
            : rangeKind === "minimum-years"
              ? { kind: "minimum-years", years: Number(minimumYears) }
              : null,
      },
      regions: selectedRegions.map(({ code, label }) => ({ code, label })),
    });
    setOpenPopover(null);
    setValidationError(null);
    onSearch(filters);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">검색 조건</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          원하는 조건을 선택한 다음 검색 버튼을 눌러주세요. 조건을 바꿔도
          자동으로 검색되지 않습니다. 구체 조건을 선택하면 해당 정보가 명시적으로
          일치하는 공고만 표시됩니다.
        </p>
      </div>

      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        role="group"
        aria-label="채용공고 검색 조건"
      >
        <Popover
          open={openPopover === "education"}
          onOpenChange={open => setOpenPopover(open ? "education" : null)}
        >
          <PopoverTrigger asChild>
            <FilterTriggerButton
              icon={GraduationCap}
              label="학력 선택"
              summary={summarizeEducation(education)}
              expanded={openPopover === "education"}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(760px,calc(100vw-2rem))] p-4"
            aria-label="학력 선택 항목"
          >
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-foreground">
                학력 선택
              </legend>
              <div className="grid grid-cols-4 gap-2">
                {EDUCATION_OPTIONS.map(option => (
                  <SelectionButton
                    key={option.value}
                    label={option.label}
                    selected={education.includes(option.value)}
                    onClick={() => handleEducationToggle(option.value)}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                여러 항목을 선택할 수 있습니다. 학력 무관을 선택하면 다른 학력은
                해제됩니다.
              </p>
            </fieldset>
          </PopoverContent>
        </Popover>

        <Popover
          open={openPopover === "experience"}
          onOpenChange={open => setOpenPopover(open ? "experience" : null)}
        >
          <PopoverTrigger asChild>
            <FilterTriggerButton
              icon={UserRoundSearch}
              label="신입·경력 선택"
              summary={summarizeExperience(
                experienceTypes,
                rangeKind,
                minimumYears
              )}
              expanded={openPopover === "experience"}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(620px,calc(100vw-2rem))] p-4"
            aria-label="신입과 경력 선택 항목"
          >
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-foreground">
                신입·경력 선택
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {EXPERIENCE_OPTIONS.map(option => (
                  <SelectionButton
                    key={option.value}
                    label={option.label}
                    selected={experienceTypes.includes(option.value)}
                    onClick={() => handleExperienceToggle(option.value)}
                  />
                ))}
              </div>

              <div
                className={`mt-4 rounded-lg border p-3 ${hasExperienced ? "border-border" : "border-border/60 bg-muted/20"}`}
              >
                <div className="mb-2 text-xs font-semibold text-foreground">
                  경력 연수
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleRangeKindChange("up-to-one-year")}
                    disabled={!hasExperienced}
                    aria-pressed={rangeKind === "up-to-one-year"}
                    className={selectionButtonClass(
                      rangeKind === "up-to-one-year"
                    )}
                  >
                    1년 이하
                  </button>
                  <div
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                      rangeKind === "minimum-years"
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background"
                    } ${!hasExperienced ? "opacity-50" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleRangeKindChange("minimum-years")}
                      disabled={!hasExperienced}
                      aria-pressed={rangeKind === "minimum-years"}
                      aria-label="최소 경력 연수 조건 선택"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        rangeKind === "minimum-years"
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-background"
                      } disabled:cursor-not-allowed`}
                    >
                      {rangeKind === "minimum-years" && <Check size={12} />}
                    </button>
                    <label htmlFor="job-minimum-years" className="sr-only">
                      최소 경력 연수
                    </label>
                    <input
                      id="job-minimum-years"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      value={minimumYears}
                      disabled={!hasExperienced}
                      onFocus={() => {
                        if (rangeKind !== "minimum-years")
                          handleRangeKindChange("minimum-years");
                      }}
                      onChange={event =>
                        handleMinimumYearsChange(event.target.value)
                      }
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-right text-sm outline-none focus:border-primary disabled:cursor-not-allowed"
                    />
                    <span className="shrink-0 text-sm text-foreground">
                      년 이상
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  경력을 선택했을 때만 연수를 지정할 수 있으며, 두 범위 중
                  하나만 적용됩니다.
                </p>
              </div>
            </fieldset>
          </PopoverContent>
        </Popover>

        <Popover
          open={openPopover === "region"}
          onOpenChange={open => {
            setOpenPopover(open ? "region" : null);
            if (!open) setRegionQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <FilterTriggerButton
              icon={MapPin}
              label="지역 선택"
              summary={summarizeRegions(selectedRegions)}
              expanded={openPopover === "region"}
              role="combobox"
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(680px,calc(100vw-2rem))] p-0"
            aria-label="지역 검색 및 선택"
          >
            <RegionSelector
              query={regionQuery}
              onQueryChange={setRegionQuery}
              expandedProvince={expandedProvince}
              onExpandedProvinceChange={setExpandedProvince}
              selectedCodes={selectedRegionCodes}
              onToggle={toggleRegion}
              error={regionError}
            />
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="flex min-h-16 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Search size={17} className={loading ? "animate-pulse" : ""} />
          {loading ? "검색 중..." : "검색"}
        </button>
      </div>

      {selectedRegions[0]?.code !== "any" && (
        <div
          className="mt-4 flex flex-wrap items-center gap-2"
          aria-label="선택한 지역"
        >
          <span className="text-xs font-medium text-muted-foreground">
            선택 지역
          </span>
          {selectedRegions.map(region => (
            <span
              key={region.code}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary"
            >
              {region.label}
              <button
                type="button"
                onClick={() => removeRegion(region.code)}
                className="rounded-full p-0.5 hover:bg-primary/10"
                aria-label={`${region.label} 선택 해제`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <span className="text-xs text-muted-foreground">
            {selectedRegions.length}/{MAX_JOB_RECOMMENDATION_REGIONS}
          </span>
        </div>
      )}

      {validationError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {validationError}
        </p>
      )}
    </div>
  );
}

interface FilterTriggerButtonProps extends Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "role"
> {
  icon: LucideIcon;
  label: string;
  summary: string;
  expanded: boolean;
  role?: "combobox";
}

const FilterTriggerButton = forwardRef<
  HTMLButtonElement,
  FilterTriggerButtonProps
>(
  (
    { icon: Icon, label, summary, expanded, role, className, ...buttonProps },
    ref
  ) => (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      role={role}
      aria-expanded={expanded}
      aria-haspopup={role === "combobox" ? "listbox" : "dialog"}
      className={`flex min-h-16 min-w-0 items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${className ?? ""}`}
    >
      <Icon size={18} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {summary}
        </span>
      </span>
      <ChevronDown
        size={15}
        className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
      />
    </button>
  )
);

FilterTriggerButton.displayName = "FilterTriggerButton";

function SelectionButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={selectionButtonClass(selected)}
    >
      <span className="w-full text-center">{label}</span>
    </button>
  );
}

function RegionSelector({
  query,
  onQueryChange,
  expandedProvince,
  onExpandedProvinceChange,
  selectedCodes,
  onToggle,
  error,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  expandedProvince: string | null;
  onExpandedProvinceChange: (value: string | null) => void;
  selectedCodes: Set<string>;
  onToggle: (region: JobRegionOption) => void;
  error: string | null;
}) {
  const normalizedQuery = normalizeSearchText(query);
  const groups = useMemo(
    () =>
      JOB_REGION_PROVINCES.map(item => ({
        province: item,
        children: item.children.filter(
          child =>
            !normalizedQuery ||
            normalizeSearchText(`${child.label} ${child.shortLabel}`).includes(
              normalizedQuery
            )
        ),
        provinceMatches:
          !normalizedQuery ||
          normalizeSearchText(item.label).includes(normalizedQuery),
      })).filter(group => group.provinceMatches || group.children.length > 0),
    [normalizedQuery]
  );

  return (
    <div>
      <div className="border-b border-border p-3">
        <label htmlFor="job-region-search" className="sr-only">
          지역명 검색
        </label>
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="job-region-search"
            type="search"
            role="searchbox"
            autoComplete="off"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="서울, 강남구, 수원시 등 검색"
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      <div
        className="max-h-[420px] overflow-y-auto p-2"
        role="listbox"
        aria-multiselectable="true"
      >
        <RegionOptionButton
          region={JOB_REGION_ANY}
          selected={selectedCodes.has("any")}
          onClick={() => onToggle(JOB_REGION_ANY)}
        />

        {groups.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">
            일치하는 지역이 없습니다.
          </div>
        ) : (
          groups.map(({ province: item, children, provinceMatches }) => {
            const expanded =
              normalizedQuery.length > 0 || expandedProvince === item.code;
            const visibleChildren = normalizedQuery
              ? children
              : expanded
                ? item.children
                : [];
            return (
              <div
                key={item.code}
                className="mt-1 border-t border-border/60 pt-1"
              >
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <RegionOptionButton
                      region={item}
                      selected={selectedCodes.has(item.code)}
                      onClick={() => onToggle(item)}
                      muted={!provinceMatches && normalizedQuery.length > 0}
                    />
                  </div>
                  {item.children.length > 0 && !normalizedQuery && (
                    <button
                      type="button"
                      onClick={() =>
                        onExpandedProvinceChange(expanded ? null : item.code)
                      }
                      className="rounded-md p-2 text-muted-foreground hover:bg-muted"
                      aria-label={`${item.label} 시·군·구 ${expanded ? "접기" : "펼치기"}`}
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        size={15}
                        className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                </div>
                {visibleChildren.length > 0 && (
                  <div className="grid grid-cols-1 gap-1 pb-2 pl-4 sm:grid-cols-2">
                    {visibleChildren.map(child => (
                      <RegionOptionButton
                        key={child.code}
                        region={child}
                        selected={selectedCodes.has(child.code)}
                        onClick={() => onToggle(child)}
                        child
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        시·도 또는 시·군·구를 최대 {MAX_JOB_RECOMMENDATION_REGIONS}개까지 선택할
        수 있습니다.
        {error && (
          <p role="alert" className="mt-1 font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function RegionOptionButton({
  region,
  selected,
  onClick,
  child = false,
  muted = false,
}: {
  region: JobRegionOption;
  selected: boolean;
  onClick: () => void;
  child?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
        selected ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"
      } ${muted ? "text-muted-foreground" : ""}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          selected
            ? "border-primary bg-primary text-white"
            : "border-border bg-background"
        }`}
      >
        {selected && <Check size={11} />}
      </span>
      <span className="truncate">
        {child ? region.shortLabel : region.label}
      </span>
    </button>
  );
}

function toggleExclusiveAny<T extends "any" | string>(
  current: T[],
  value: T
): T[] {
  if (value === "any") return ["any"] as T[];
  const withoutAny = current.filter(item => item !== "any");
  if (withoutAny.includes(value)) {
    const next = withoutAny.filter(item => item !== value);
    return next.length > 0 ? next : (["any"] as T[]);
  }
  return [...withoutAny, value];
}

function summarizeEducation(selected: JobEducationLevel[]): string {
  const labels = EDUCATION_OPTIONS.filter(option =>
    selected.includes(option.value)
  ).map(option => option.label);
  return labels.length <= 2
    ? labels.join(", ")
    : `${labels[0]} 외 ${labels.length - 1}개`;
}

function summarizeExperience(
  selected: JobExperienceType[],
  rangeKind: ExperienceRangeKind,
  minimumYears: string
): string {
  const labels = EXPERIENCE_OPTIONS.filter(option =>
    selected.includes(option.value)
  ).map(option => option.label);
  if (selected.includes("experienced") && rangeKind === "up-to-one-year")
    labels.push("1년 이하");
  if (
    selected.includes("experienced") &&
    rangeKind === "minimum-years" &&
    minimumYears
  ) {
    labels.push(`${minimumYears}년 이상`);
  }
  return labels.join(", ");
}

function summarizeRegions(selected: JobRegionOption[]): string {
  if (selected.some(item => item.code === "any")) return "지역 무관";
  return selected.length === 1
    ? selected[0].label
    : `${selected[0].label} 외 ${selected.length - 1}개`;
}

export function describeJobRecommendationFilters(
  filters: JobRecommendationFilters
): string[] {
  const education = filters.education
    .map(
      value => EDUCATION_OPTIONS.find(option => option.value === value)?.label
    )
    .filter((value): value is string => Boolean(value))
    .join(", ");
  const experienceLabels = filters.experience.types
    .map(
      value => EXPERIENCE_OPTIONS.find(option => option.value === value)?.label
    )
    .filter((value): value is string => Boolean(value));
  if (filters.experience.range?.kind === "up-to-one-year")
    experienceLabels.push("1년 이하");
  if (filters.experience.range?.kind === "minimum-years") {
    experienceLabels.push(`${filters.experience.range.years}년 이상`);
  }
  const regions = filters.regions.map(region => region.label).join(", ");
  return [education, experienceLabels.join(", "), regions];
}

function selectionButtonClass(selected: boolean): string {
  return `flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors ${
    selected
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-background text-foreground hover:border-primary/30"
  } disabled:cursor-not-allowed disabled:opacity-50`;
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}
