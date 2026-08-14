import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as XLSX from "xlsx";
import { getOpenAIKey } from "./supabase";
import type { ClientRow } from "./supabase";

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const ANALYSIS_CACHE_PREFIX = "summary-analysis-cache:v4:";
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export interface ParsedDocumentProfile {
  aiSummary: string;
  desiredJobs: string[];
  certifications: string[];
  extraSpecs: string[];
  gender: string | null;
  reliability: "high" | "medium" | "low";
  keywordTags: string[];
}

export interface FileAnalysisResult extends ParsedDocumentProfile {
  sourceHash: string;
  generatedAt: string;
  extractionMethod: string;
  extractedText: string;
  extractedCharCount: number;
}

export interface DocumentAnalysisResult extends FileAnalysisResult {
  fileName: string;
  fileType: string;
  fileSize: number;
}

function getElectronDocumentApi(): ElectronDocumentApi | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}

export interface PreparedAnalysisFile {
  file: File;
  sourceFileName: string;
  preparationMethod: string | null;
}

type ElectronDocumentApi = {
  isElectron?: boolean;
  convertHwpToPdf?: (payload: {
    fileName: string;
    data: Uint8Array;
  }) => Promise<{
    fileName: string;
    method: string;
    data: Uint8Array;
  }>;
  extractHwpText?: (payload: {
    fileName: string;
    data: Uint8Array;
  }) => Promise<{
    text: string;
    method: string;
  }>;
};

export interface MergedDocumentProfile extends ParsedDocumentProfile {
  sourceHash: string;
  fileCount: number;
  sourceTexts: string[];
}

export async function analyzeDocumentFile(
  file: File,
  client: ClientRow
): Promise<DocumentAnalysisResult> {
  if (isImageFile(file.name)) {
    return analyzeImageFile(file, client);
  }

  const extracted = await extractTextFromFile(file);
  const normalizedText = normalizeText(extracted.text);

  if (!normalizedText) {
    throw new Error("문서에서 추출할 수 있는 텍스트가 없습니다.");
  }

  const sourceHash = await sha256(
    JSON.stringify({
      clientId: client.id,
      fileName: file.name,
      fileSize: file.size,
      text: normalizedText,
    })
  );

  const cached = readCachedAnalysis(sourceHash);
  if (cached) {
    return {
      ...cached,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    };
  }

  const profile = await summarizeWithDeterministicFallback(
    normalizedText,
    client
  );
  const payload: FileAnalysisResult = {
    ...profile,
    sourceHash,
    generatedAt: new Date().toISOString(),
    extractionMethod: extracted.method,
    extractedText: normalizedText,
    extractedCharCount: normalizedText.length,
  };

  writeCachedAnalysis(sourceHash, payload);

  return {
    ...payload,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  };
}

export async function prepareAnalysisFile(
  file: File
): Promise<PreparedAnalysisFile> {
  if (getFileExtension(file.name) !== "hwp") {
    return {
      file,
      sourceFileName: file.name,
      preparationMethod: null,
    };
  }

  const electronApi = getElectronDocumentApi();
  if (!electronApi?.isElectron || !electronApi.convertHwpToPdf) {
    return {
      file,
      sourceFileName: file.name,
      preparationMethod: "hwp-binary",
    };
  }

  try {
    const converted = await electronApi.convertHwpToPdf({
      fileName: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    });

    return {
      file: new File(
        [converted.data as unknown as BlobPart],
        converted.fileName,
        {
          type: "application/pdf",
          lastModified: file.lastModified,
        }
      ),
      sourceFileName: file.name,
      preparationMethod: converted.method,
    };
  } catch {
    return {
      file,
      sourceFileName: file.name,
      preparationMethod: "hwp-binary",
    };
  }
}

async function analyzeImageFile(
  file: File,
  client: ClientRow
): Promise<DocumentAnalysisResult> {
  const sourceHash = await sha256Bytes(await file.arrayBuffer(), {
    clientId: client.id,
    fileName: file.name,
    fileSize: file.size,
  });

  const cached = readCachedAnalysis(sourceHash);
  if (cached) {
    return {
      ...cached,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    };
  }

  const profile = await summarizeImageWithOpenAI(file, client);
  const payload: FileAnalysisResult = {
    ...profile,
    sourceHash,
    generatedAt: new Date().toISOString(),
    extractionMethod: "openai-vision",
    extractedText: "",
    extractedCharCount: 0,
  };

  writeCachedAnalysis(sourceHash, payload);

  return {
    ...payload,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  };
}

export function mergeDocumentAnalyses(
  analyses: DocumentAnalysisResult[]
): MergedDocumentProfile {
  const desiredJobs = uniqueStrings(analyses.flatMap(item => item.desiredJobs));
  const certifications = uniqueStrings(
    analyses.flatMap(item => item.certifications)
  );
  const extraSpecs = uniqueStrings(analyses.flatMap(item => item.extraSpecs));
  const gender = analyses.map(item => item.gender).find(Boolean) ?? null;
  const summary = buildMergedSummary({
    desiredJobs,
    certifications,
    extraSpecs,
    gender,
    fileCount: analyses.length,
  });
  const reliability = pickMergedReliability(analyses);
  const keywordTags = uniqueStrings([
    ...desiredJobs,
    ...certifications.slice(0, 3),
    ...extraSpecs.slice(0, 3),
  ]);

  return {
    sourceHash: analyses
      .map(item => item.sourceHash)
      .sort()
      .join(":"),
    fileCount: analyses.length,
    sourceTexts: uniqueStrings(
      analyses.map(item => item.extractedText).filter(Boolean)
    ),
    aiSummary: summary,
    desiredJobs,
    certifications,
    extraSpecs,
    gender,
    reliability,
    keywordTags,
  };
}

export async function extractTextFromFile(
  file: File
): Promise<{ text: string; method: string }> {
  const extension = getFileExtension(file.name);

  if (["txt", "md", "csv", "json"].includes(extension)) {
    return {
      text: await file.text(),
      method: "plain-text",
    };
  }

  if (extension === "pdf") {
    return {
      text: await extractPdfText(file),
      method: "pdfjs",
    };
  }

  if (extension === "xlsx" || extension === "xls") {
    return {
      text: await extractSpreadsheetText(file),
      method: "xlsx",
    };
  }

  if (extension === "hwpx") {
    return {
      text: await extractHwpxText(file),
      method: "hwpx-xml",
    };
  }

  if (extension === "hwp") {
    const electronApi = getElectronDocumentApi();
    if (electronApi?.isElectron && electronApi.extractHwpText) {
      return electronApi.extractHwpText({
        fileName: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }

    throw new Error(
      "HWP 본문 추출은 데스크톱 앱에서만 지원합니다. 데스크톱 앱으로 실행하거나 PDF/HWPX로 변환 후 업로드해 주세요."
    );
  }

  return {
    text: await file.text(),
    method: "fallback-text",
  };
}

function buildMergedSummary(input: {
  desiredJobs: string[];
  certifications: string[];
  extraSpecs: string[];
  gender: string | null;
  fileCount: number;
}): string {
  const segments = [
    `총 ${input.fileCount}개 문서를 기준으로 핵심 항목만 정리했습니다.`,
    input.desiredJobs.length > 0
      ? `희망 직업은 ${input.desiredJobs.join(", ")}로 파악됩니다.`
      : "희망 직업 정보는 문서에서 확인되지 않았습니다.",
    input.gender
      ? `성별은 ${input.gender}로 확인됩니다.`
      : "성별 정보는 문서에 명시되지 않았습니다.",
    input.certifications.length > 0
      ? `자격증은 ${input.certifications.join(", ")}가 확인됩니다.`
      : "자격증 정보는 확인되지 않았습니다.",
    input.extraSpecs.length > 0
      ? `부가 스펙은 ${input.extraSpecs.join(", ")} 중심으로 정리됩니다.`
      : "부가 스펙 정보는 확인되지 않았습니다.",
  ];

  return segments.join(" ");
}

function pickMergedReliability(
  analyses: DocumentAnalysisResult[]
): ParsedDocumentProfile["reliability"] {
  if (analyses.some(item => item.reliability === "high")) return "high";
  if (analyses.some(item => item.reliability === "medium")) return "medium";
  return "low";
}

async function summarizeWithDeterministicFallback(
  extractedText: string,
  client: ClientRow
): Promise<ParsedDocumentProfile> {
  const fallback = buildRuleBasedAnalysis(extractedText, client);
  const openAIKey = getOpenAIKey();

  if (!openAIKey) {
    return fallback;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAIKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        top_p: 1,
        seed: 42,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You extract only job-counseling-relevant structured facts from Korean documents. Return strict JSON only. Be consistent for the same input. If a field is missing, return an empty array or null instead of guessing.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Extract only the requested structured fields from the document.",
              clientContext: {
                id: client.id,
                name: client.name,
                desiredJob: client.desired_job,
                gender: client.gender,
              },
              extractionRules: {
                aiSummary:
                  "Summarize only desired job, gender, certifications, and extra specs such as education, work history, projects, activities, awards.",
                desiredJobs:
                  'Return only atomic desired job keywords or role names mentioned in the document. Split composite phrases like "사무직 마케팅" into ["사무직", "마케팅"]. Exclude salary, location, working days, time conditions, counseling notes, and explanatory sentences.',
                certifications:
                  "Return only certificate names and language test scores explicitly mentioned. Examples: 정보처리기사, 토익 850점. Exclude counseling notes, schedules, benefits, eligibility notes.",
                extraSpecs:
                  "Return only previous companies/career history and completed education or training programs. Examples: 인텔 2년 경력직, KOSA 하이브리드 인프라 교육. Exclude projects, generic activities, counseling notes, checklist text, scores, or schedule lines.",
                gender: "Return gender only if explicitly present in the text.",
              },
              outputSchema: {
                aiSummary: "string",
                desiredJobs: ["string"],
                certifications: ["string"],
                extraSpecs: ["string"],
                gender: "string|null",
                keywordTags: ["string"],
                reliability: "high|medium|low",
              },
              text: extractedText.slice(0, 20000),
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error("OpenAI returned an empty response.");
    }

    const parsed = JSON.parse(rawContent) as Partial<ParsedDocumentProfile> & {
      aiSummary?: unknown;
      keywordTags?: unknown;
    };

    return {
      aiSummary:
        typeof parsed.aiSummary === "string" && parsed.aiSummary.trim()
          ? parsed.aiSummary.trim()
          : fallback.aiSummary,
      desiredJobs: normalizeDesiredJobs(
        sanitizeStringArray(parsed.desiredJobs, fallback.desiredJobs)
      ),
      certifications: normalizeCertifications(
        sanitizeStringArray(parsed.certifications, fallback.certifications)
      ),
      extraSpecs: normalizeExtraSpecs(
        sanitizeStringArray(parsed.extraSpecs, fallback.extraSpecs)
      ),
      gender:
        typeof parsed.gender === "string" && parsed.gender.trim()
          ? parsed.gender.trim()
          : fallback.gender,
      keywordTags: sanitizeStringArray(
        parsed.keywordTags,
        fallback.keywordTags
      ),
      reliability:
        parsed.reliability === "high" ||
        parsed.reliability === "medium" ||
        parsed.reliability === "low"
          ? parsed.reliability
          : fallback.reliability,
    };
  } catch {
    return fallback;
  }
}

async function summarizeImageWithOpenAI(
  file: File,
  client: ClientRow
): Promise<ParsedDocumentProfile> {
  const openAIKey = getOpenAIKey();
  if (!openAIKey) {
    throw new Error("이미지 분석은 OpenAI API Key 설정 후 사용할 수 있습니다.");
  }

  const imageUrl = await fileToDataUrl(file);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAIKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      top_p: 1,
      seed: 42,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You read Korean resume-like images and return strict JSON only. Extract only desired jobs, gender if explicit, certificate names, and extra specs such as training, work history, projects, activities, awards.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                task: "Extract structured career profile fields from the image document.",
                clientContext: {
                  id: client.id,
                  name: client.name,
                  desiredJob: client.desired_job,
                },
                outputSchema: {
                  aiSummary: "string",
                  desiredJobs: ["string"],
                  certifications: ["string"],
                  extraSpecs: ["string"],
                  gender: "string|null",
                  keywordTags: ["string"],
                  reliability: "high|medium|low",
                },
              }),
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`이미지 분석 요청 실패 (${response.status})`);
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;

  if (!rawContent) {
    throw new Error("이미지 분석 결과가 비어 있습니다.");
  }

  const parsed = JSON.parse(rawContent) as Partial<ParsedDocumentProfile> & {
    aiSummary?: unknown;
    keywordTags?: unknown;
  };

  return {
    aiSummary:
      typeof parsed.aiSummary === "string" && parsed.aiSummary.trim()
        ? parsed.aiSummary.trim()
        : "이미지 문서에서 핵심 정보를 추출했지만 요약 본문은 비어 있습니다.",
    desiredJobs: normalizeDesiredJobs(
      sanitizeStringArray(parsed.desiredJobs, [])
    ),
    certifications: normalizeCertifications(
      sanitizeStringArray(parsed.certifications, [])
    ),
    extraSpecs: normalizeExtraSpecs(sanitizeStringArray(parsed.extraSpecs, [])),
    gender:
      typeof parsed.gender === "string" && parsed.gender.trim()
        ? parsed.gender.trim()
        : null,
    keywordTags: sanitizeStringArray(parsed.keywordTags, []),
    reliability:
      parsed.reliability === "high" ||
      parsed.reliability === "medium" ||
      parsed.reliability === "low"
        ? parsed.reliability
        : "medium",
  };
}

function buildRuleBasedAnalysis(
  extractedText: string,
  client: ClientRow
): ParsedDocumentProfile {
  const lines = extractedText
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  const desiredJobs = normalizeDesiredJobs([
    ...collectMatches(lines, [
      /희망\s*직업[:：]?\s*(.+)/i,
      /희망\s*직무[:：]?\s*(.+)/i,
      /희망\s*직종[:：]?\s*(.+)/i,
      /지원\s*직무[:：]?\s*(.+)/i,
    ]),
    ...(client.desired_job ? [client.desired_job] : []),
  ]).slice(0, 5);

  const gender =
    collectMatches(lines, [/성별[:：]?\s*(남성|여성|남|여)/i])[0] ??
    client.gender ??
    null;

  const certifications = normalizeCertifications([
    ...collectKeywordValues(lines, [
      "자격증",
      "보유자격",
      "취득자격",
      "자격 사항",
    ]),
    ...collectInlineList(
      lines,
      /(?:산업기사|기사|기능사|컴활|TOEIC(?:\s*Speaking)?|TOEFL|TEPS|OPIC|OPIc|Opic|MOS|워드프로세서|토익(?:\s*스피킹)?|오픽|토플|텝스)/i
    ),
  ]).slice(0, 12);

  const extraSpecs = normalizeExtraSpecs([
    ...collectKeywordValues(lines, [
      "교육",
      "훈련",
      "수료",
      "프로젝트",
      "경력",
      "근무",
      "수상",
      "활동",
      "포트폴리오",
    ]),
    ...collectContextLines(lines, [
      "교육",
      "훈련",
      "프로젝트",
      "경력",
      "활동",
      "수상",
    ]),
  ])
    .filter(item => !certifications.includes(item))
    .slice(0, 12);

  return {
    aiSummary: buildFallbackSummary({
      desiredJobs,
      certifications,
      extraSpecs,
      gender,
    }),
    desiredJobs,
    certifications,
    extraSpecs,
    gender,
    keywordTags: uniqueStrings([
      ...desiredJobs,
      ...certifications.slice(0, 3),
      ...extraSpecs.slice(0, 3),
    ]),
    reliability: lines.length > 25 ? "medium" : "low",
  };
}

function buildFallbackSummary(input: {
  desiredJobs: string[];
  certifications: string[];
  extraSpecs: string[];
  gender: string | null;
}): string {
  const parts = [
    input.desiredJobs.length > 0
      ? `희망 직업은 ${input.desiredJobs.join(", ")}입니다.`
      : "희망 직업 정보는 확인되지 않았습니다.",
    input.gender
      ? `성별은 ${input.gender}입니다.`
      : "성별 정보는 확인되지 않았습니다.",
    input.certifications.length > 0
      ? `자격증은 ${input.certifications.join(", ")}입니다.`
      : "자격증 정보는 없습니다.",
    input.extraSpecs.length > 0
      ? `부가 스펙은 ${input.extraSpecs.join(", ")}입니다.`
      : "부가 스펙 정보는 없습니다.",
  ];

  return parts.join(" ");
}

function collectMatches(lines: string[], patterns: RegExp[]): string[] {
  const matches: string[] = [];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      const value = match?.[1]?.trim();
      if (value) {
        matches.push(...splitCandidateValues(value));
      }
    }
  }

  return uniqueStrings(matches);
}

function collectInlineList(lines: string[], pattern: RegExp): string[] {
  return lines
    .filter(line => pattern.test(line))
    .flatMap(line => splitCandidateValues(line))
    .filter(Boolean);
}

function collectKeywordValues(lines: string[], keywords: string[]): string[] {
  return lines
    .filter(line => keywords.some(keyword => line.includes(keyword)))
    .flatMap(line => splitCandidateValues(line))
    .map(item => item.replace(/^[\-\d.\s]+/, "").trim())
    .filter(item => item.length > 1 && item.length < 80);
}

function collectContextLines(lines: string[], keywords: string[]): string[] {
  return lines
    .filter(line => keywords.some(keyword => line.includes(keyword)))
    .map(line => line.trim())
    .filter(line => line.length > 4);
}

function splitCandidateValues(value: string): string[] {
  return value
    .split(/[,\n/|;·•]/g)
    .map(item => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;

  const normalized = value
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return normalized.length > 0 ? uniqueStrings(normalized) : fallback;
}

function normalizeDesiredJobs(values: string[]): string[] {
  return uniqueStrings(
    values.flatMap(value => splitDesiredJobValue(value))
  ).slice(0, 8);
}

function normalizeCertifications(values: string[]): string[] {
  return uniqueStrings(
    values
      .flatMap(value => splitCertificateValue(value))
      .filter(item => isLikelyCertificate(item))
  ).slice(0, 12);
}

function normalizeExtraSpecs(values: string[]): string[] {
  return uniqueStrings(
    values
      .flatMap(value => splitExtraSpecValue(value))
      .filter(item => isLikelyExtraSpec(item))
  ).slice(0, 12);
}

function splitDesiredJobValue(value: string): string[] {
  let cleaned = value
    .replace(/\s+/g, " ")
    .replace(/^\uD76C\uB9DD\s*\uC9C1\uC5C5[:?]?\s*/i, "")
    .replace(/^\uD76C\uB9DD\s*\uC9C1\uBB34[:?]?\s*/i, "")
    .replace(/^\uD76C\uB9DD\s*\uC9C1\uC885[:?]?\s*/i, "")
    .replace(/^\uC9C0\uC6D0\s*\uC9C1\uBB34[:?]?\s*/i, "")
    .trim();

  cleaned = truncateAtFirstMarker(cleaned, [
    "\uD76C\uB9DD\uADFC\uBB34",
    "\uD76C\uB9DD \uADFC\uBB34",
    "\uD76C\uB9DD\uC784\uAE08",
    "\uD76C\uB9DD \uC784\uAE08",
    "\uD76C\uB9DD\uADFC\uBB34\uC9C0\uC5ED",
    "\uD76C\uB9DD \uADFC\uBB34\uC9C0\uC5ED",
    "\uAD6C\uC9C1\uC560\uB85C",
    "\uD504\uB85C\uD30C\uC77C\uB9C1",
    "\uAD6C\uC9C1\uACC4\uD68D\uC0C1\uB2F4",
    "\uCC38\uC5EC\uC790\uB294",
    "\uCC38\uC5EC\uC790",
  ]);

  cleaned = cleaned
    .replace(/\s*-\s*/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .trim();

  const keywordMatches = cleaned.match(
    /([\uAC00-\uD7A3A-Za-z0-9]+(?:\uC9C1|\uB9C8\uCF00\uD305|\uC601\uC5C5|\uD64D\uBCF4|\uAE30\uD68D|\uD589\uC815|\uD68C\uACC4|\uC7AC\uBB34|\uCD1D\uBB34|\uB514\uC790\uC778|\uAC1C\uBC1C|\uC0C1\uB2F4|\uAC04\uD638|\uC870\uAD50|\uC5F0\uAD6C\uC6D0|\uAC15\uC0AC|\uAD50\uC0AC|\uAD00\uB9AC))/g
  );
  if (keywordMatches && keywordMatches.length > 0) {
    return uniqueStrings(keywordMatches.map(item => item.trim()));
  }

  return cleaned
    .split(/,|\/|\||;|\u00B7|\u2022|\s+(?:\uBC0F|\uC640|\uACFC)\s+|\s+/g)
    .map(item =>
      item
        .replace(
          /(\uBD84\uC57C|\uC5C5\uBB34|\uC9C1\uBB34|\uC9C1\uC885|\uD76C\uB9DD|\uC9C0\uC6D0|\uCDE8\uC5C5).*/g,
          ""
        )
        .trim()
    )
    .filter(item => isLikelyDesiredJobToken(item));
}

function splitCertificateValue(value: string): string[] {
  const cleaned = truncateAtFirstMarker(
    value
      .replace(/\s+/g, " ")
      .replace(/^\uC790\uACA9\uC99D[:：]?\s*/i, "")
      .replace(/^\uBCF4\uC720\uC790\uACA9[:：]?\s*/i, "")
      .replace(/^\uCDE8\uB4DD\uC790\uACA9[:：]?\s*/i, "")
      .trim(),
    [
      "\uD76C\uB9DD\uADFC\uBB34",
      "\uD76C\uB9DD\uC784\uAE08",
      "\uD76C\uB9DD\uADFC\uBB34\uC9C0\uC5ED",
      "\uAD6C\uC9C1\uC560\uB85C",
      "\uD504\uB85C\uD30C\uC77C\uB9C1",
      "\uAD6C\uC9C1\uACC4\uD68D\uC0C1\uB2F4",
    ]
  );

  const exactMatches = cleaned.match(
    /([가-힣A-Za-z0-9+\- ]+(?:기사|산업기사|기능사|기술사|관리사|컴활\s*\d?급|워드프로세서|MOS|GTQ|(?:OPIC|OPIc|Opic|opic|오픽)\s*(?:AL|IH|IM1|IM2|IM3)?|(?:TOEIC\s*Speaking|Toeic\s*Speaking|toeic\s*speaking|토익\s*스피킹|토익스피킹)\s*(?:AH|AM|AL|IH|IM1|IM2|IM3)?|(?:TOEIC|Toeic|toeic|토익)\s*\d{3,4}(?:점)?|(?:TOEFL|Toefl|toefl|토플)\s*\d{3,4}(?:점)?|(?:TEPS|Teps|teps|텝스)\s*\d{3,4}(?:점)?))/g
  );
  const languageMatches = extractLanguageScoreCandidates(cleaned);
  const combined = [...(exactMatches ?? []), ...languageMatches];
  if (combined.length > 0) {
    return uniqueStrings(
      combined.map(item => item.replace(/\s+/g, " ").trim())
    );
  }

  return cleaned
    .split(/,|\/|\||;|\u00B7|\u2022|\n/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function splitExtraSpecValue(value: string): string[] {
  const cleaned = truncateAtFirstMarker(
    value
      .replace(/\s+/g, " ")
      .replace(/^\uACBD\uB825[:：]?\s*/i, "")
      .replace(/^\uAD50\uC721[:：]?\s*/i, "")
      .replace(/^\uD6C8\uB828[:：]?\s*/i, "")
      .replace(/^\uC218\uB8CC[:：]?\s*/i, "")
      .trim(),
    [
      "\uD76C\uB9DD\uADFC\uBB34",
      "\uD76C\uB9DD\uC784\uAE08",
      "\uD76C\uB9DD\uADFC\uBB34\uC9C0\uC5ED",
      "\uAD6C\uC9C1\uC560\uB85C",
      "\uD504\uB85C\uD30C\uC77C\uB9C1",
      "\uAD6C\uC9C1\uACC4\uD68D\uC0C1\uB2F4",
    ]
  );

  const exactMatches = cleaned.match(
    /([가-힣A-Za-z0-9().+\- ]+(?:경력(?:직)?|근무|재직|인턴|교육|훈련|수료|아카데미|부트캠프))/g
  );
  if (exactMatches && exactMatches.length > 0) {
    return exactMatches.map(item => item.replace(/\s+/g, " ").trim());
  }

  return cleaned
    .split(/,|\/|\||;|\u00B7|\u2022|\n/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function isLikelyDesiredJobToken(value: string): boolean {
  if (!value) return false;
  if (/^\d/.test(value)) return false;
  if (
    /(\uC6D4|\uB9CC\uC6D0|\uC8FC\s*\d|\uC2DC\uAC04|\uC694\uC77C|\uC9C0\uC5ED|\uC6B8\uC0B0|\uBD80\uC0B0|\uC11C\uC6B8|\uACBD\uAE30|\uC560\uB85C|\uC0C1\uB2F4|\uC784\uAE08|\uADFC\uBB34)/.test(
      value
    )
  )
    return false;
  return /(\uC9C1|\uB9C8\uCF00\uD305|\uC601\uC5C5|\uD64D\uBCF4|\uAE30\uD68D|\uD589\uC815|\uD68C\uACC4|\uC7AC\uBB34|\uCD1D\uBB34|\uB514\uC790\uC778|\uAC1C\uBC1C|\uAC04\uD638|\uC870\uAD50|\uC5F0\uAD6C\uC6D0|\uAC15\uC0AC|\uAD50\uC0AC|\uAD00\uB9AC)/.test(
    value
  );
}

function isLikelyCertificate(value: string): boolean {
  if (!value) return false;
  if (value.length > 40) return false;
  if (
    /(\[|\]|\d+회차|상담|안내|희망근무|희망임금|희망근무지역|구직애로|등록일|참여)/.test(
      value
    )
  )
    return false;
  return /(기사|산업기사|기능사|기술사|관리사|컴활|워드프로세서|MOS|GTQ|OPIc|OPIC|Opic|opic|오픽|TOEIC(?:\s*Speaking)?|Toeic(?:\s*Speaking)?|toeic(?:\s*speaking)?|TOEFL|TEPS|토익(?:\s*스피킹)?|토익스피킹|토플|텝스)/i.test(
    value
  );
}

function extractLanguageScoreCandidates(value: string): string[] {
  const patterns = [
    /(?:TOEIC\s*Speaking|Toeic\s*Speaking|toeic\s*speaking|토익\s*스피킹|토익스피킹)\s*(?:AH|AM|AL|IH|IM1|IM2|IM3)/gi,
    /(?:OPIC|OPIc|Opic|opic|오픽)\s*(?:AL|IH|IM1|IM2|IM3)/gi,
    /(?:TOEIC|Toeic|toeic|토익)\s*\d{3,4}(?:점)?/gi,
    /(?:TOEFL|Toefl|toefl|토플)\s*\d{3,4}(?:점)?/gi,
    /(?:TEPS|Teps|teps|텝스)\s*\d{3,4}(?:점)?/gi,
  ];

  return patterns.flatMap(pattern => value.match(pattern) ?? []);
}

function isLikelyExtraSpec(value: string): boolean {
  if (!value) return false;
  if (value.length > 80) return false;
  if (
    /(\[|\]|\d+회차|상담|안내|희망근무|희망임금|희망근무지역|구직애로|체크리스트|점검|취약성|자아존중감|자기효능감|의사전달|정보수집활용)/.test(
      value
    )
  )
    return false;
  return /(경력|근무|재직|인턴|교육|훈련|수료|아카데미|부트캠프)/.test(value);
}

function truncateAtFirstMarker(value: string, markers: string[]): string {
  const indexes = markers
    .map(marker => value.indexOf(marker))
    .filter(index => index >= 0);

  if (indexes.length === 0) return value;
  return value.slice(0, Math.min(...indexes)).trim();
}

async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map(item => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(text);
  }

  return pages.join("\n");
}

async function extractSpreadsheetText(file: File): Promise<string> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });

  return workbook.SheetNames.map(sheetName => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    }) as Array<Array<string | number>>;

    const body = rows
      .map(row =>
        row
          .map(cell => String(cell).trim())
          .filter(Boolean)
          .join(" | ")
      )
      .filter(Boolean)
      .join("\n");

    return `[시트] ${sheetName}\n${body}`;
  }).join("\n\n");
}

async function extractHwpxText(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xmlEntries = Object.keys(zip.files).filter(
    name =>
      /contents\/section\d+\.xml$/i.test(name) || /header\d*\.xml$/i.test(name)
  );

  if (xmlEntries.length === 0) {
    throw new Error("HWPX 본문 XML을 찾지 못했습니다.");
  }

  const parts = await Promise.all(
    xmlEntries.map(async entry => {
      const xml = await zip.file(entry)?.async("text");
      return xml ? extractXmlText(xml) : "";
    })
  );

  return parts.join("\n");
}

function extractXmlText(xml: string): string {
  try {
    const parsed = xmlParser.parse(xml);
    return normalizeText(collectTextNodes(parsed).join(" "));
  } catch {
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    return normalizeText(dom.documentElement?.textContent ?? "");
  }
}

function collectTextNodes(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.flatMap(item => collectTextNodes(item));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(item =>
      collectTextNodes(item)
    );
  }
  return [];
}

function normalizeText(input: string): string {
  return input
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values.map(item => item.replace(/\s+/g, " ").trim()).filter(Boolean)
    )
  );
}

async function sha256(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(
  buffer: ArrayBuffer,
  meta: Record<string, string | number>
): Promise<string> {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const merged = new Uint8Array(metaBytes.byteLength + buffer.byteLength);
  merged.set(metaBytes, 0);
  merged.set(new Uint8Array(buffer), metaBytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", merged);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readCachedAnalysis(hash: string): FileAnalysisResult | null {
  try {
    const raw = localStorage.getItem(`${ANALYSIS_CACHE_PREFIX}${hash}`);
    if (!raw) return null;
    return JSON.parse(raw) as FileAnalysisResult;
  } catch {
    return null;
  }
}

function writeCachedAnalysis(hash: string, payload: FileAnalysisResult): void {
  try {
    localStorage.setItem(
      `${ANALYSIS_CACHE_PREFIX}${hash}`,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore cache write failures.
  }
}

function getFileExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

function isImageFile(name: string): boolean {
  return ["png", "jpg", "jpeg", "webp"].includes(getFileExtension(name));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}
