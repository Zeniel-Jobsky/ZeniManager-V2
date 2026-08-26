#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_TARGET_CHARS = 900;
const DEFAULT_OVERLAP_CHARS = 80;
const DEFAULT_OUTPUT_DIR = 'manual-rag/output';

function usage() {
  return `
Usage:
  node manual-rag/scripts/ingest_manual_pdf.mjs \\
    --file ./manual.pdf \\
    --title "국민취업지원제도 업무매뉴얼" \\
    --version "2026.1" \\
    --published-at 2026-01-01 \\
    --dry-run

Supabase ingest:
  SUPABASE_URL="https://xxx.supabase.co" \\
  SUPABASE_SERVICE_ROLE_KEY="..." \\
  OPENAI_API_KEY="..." \\
  node manual-rag/scripts/ingest_manual_pdf.mjs \\
    --file ./manual.pdf \\
    --title "국민취업지원제도 업무매뉴얼" \\
    --version "2026.1" \\
    --replace

Options:
  --file <path>              PDF file path. Required.
  --title <text>             Manual title. Required.
  --version <text>           Manual version. Required.
  --published-at <date>      Published date, YYYY-MM-DD.
  --source-url <url>         Original source URL.
  --storage-bucket <name>    Upload PDF to Supabase Storage bucket.
  --storage-path <path>      Storage object path. Defaults to manuals/<file>.
  --embedding-model <name>   Defaults to ${DEFAULT_EMBEDDING_MODEL}.
  --target-chars <number>    Target chunk size. Defaults to ${DEFAULT_TARGET_CHARS}.
  --overlap-chars <number>   Chunk overlap. Defaults to ${DEFAULT_OVERLAP_CHARS}.
  --output-dir <path>        Dry-run/summary output dir. Defaults to ${DEFAULT_OUTPUT_DIR}.
  --replace                  Delete existing manual_documents with same title/version before ingest.
  --dry-run                  Extract and chunk only; do not call OpenAI or Supabase.
  --help                     Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    file: '',
    title: '',
    version: '',
    publishedAt: null,
    sourceUrl: null,
    storageBucket: null,
    storagePath: null,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    targetChars: DEFAULT_TARGET_CHARS,
    overlapChars: DEFAULT_OVERLAP_CHARS,
    outputDir: DEFAULT_OUTPUT_DIR,
    replace: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    switch (key) {
      case '--file':
        args.file = requireValue(key, next);
        i += 1;
        break;
      case '--title':
        args.title = requireValue(key, next);
        i += 1;
        break;
      case '--version':
        args.version = requireValue(key, next);
        i += 1;
        break;
      case '--published-at':
        args.publishedAt = requireValue(key, next);
        i += 1;
        break;
      case '--source-url':
        args.sourceUrl = requireValue(key, next);
        i += 1;
        break;
      case '--storage-bucket':
        args.storageBucket = requireValue(key, next);
        i += 1;
        break;
      case '--storage-path':
        args.storagePath = requireValue(key, next);
        i += 1;
        break;
      case '--embedding-model':
        args.embeddingModel = requireValue(key, next);
        i += 1;
        break;
      case '--target-chars':
        args.targetChars = Number(requireValue(key, next));
        i += 1;
        break;
      case '--overlap-chars':
        args.overlapChars = Number(requireValue(key, next));
        i += 1;
        break;
      case '--output-dir':
        args.outputDir = requireValue(key, next);
        i += 1;
        break;
      case '--replace':
        args.replace = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }
  }

  return args;
}

function requireValue(key, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${key} requires a value.`);
  }
  return value;
}

function validateArgs(args) {
  if (args.help) return;
  if (!args.file) throw new Error('--file is required.');
  if (!args.title) throw new Error('--title is required.');
  if (!args.version) throw new Error('--version is required.');
  if (!Number.isFinite(args.targetChars) || args.targetChars < 500) {
    throw new Error('--target-chars must be a number greater than or equal to 500.');
  }
  if (!Number.isFinite(args.overlapChars) || args.overlapChars < 0) {
    throw new Error('--overlap-chars must be a non-negative number.');
  }
  if (args.overlapChars >= args.targetChars) {
    throw new Error('--overlap-chars must be smaller than --target-chars.');
  }
  if (args.publishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(args.publishedAt)) {
    throw new Error('--published-at must be YYYY-MM-DD.');
  }
}

async function extractPdfPages(filePath) {
  installPdfJsNodePolyfills();
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buffer = await fs.readFile(filePath);
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    pages.push({
      pageNumber,
      text,
    });
  }
  return pages;
}

function installPdfJsNodePolyfills() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
        this.is2D = true;
        this.isIdentity = true;
      }

      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      translateSelf() { return this; }
      scaleSelf() { return this; }
      rotateSelf() { return this; }
      invertSelf() { return this; }
      transformPoint(point) { return point; }
    };
  }

  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }

  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {};
  }
}

function chunkPages(pages, options) {
  const chunks = [];
  let current = {
    pageStart: null,
    pageEnd: null,
    sectionTitle: null,
    text: '',
  };

  const flush = ({ keepOverlap = true } = {}) => {
    const normalized = normalizeChunkText(current.text);
    if (!normalized) return;

    chunks.push({
      chunkIndex: chunks.length,
      pageStart: current.pageStart,
      pageEnd: current.pageEnd,
      sectionTitle: current.sectionTitle,
      chunkText: normalized,
      tokenCount: estimateTokenCount(normalized),
    });

    const overlapText = keepOverlap ? normalized.slice(-options.overlapChars) : '';
    current = {
      pageStart: current.pageEnd,
      pageEnd: current.pageEnd,
      sectionTitle: keepOverlap ? current.sectionTitle : null,
      text: overlapText,
    };
  };

  for (const page of pages) {
    const paragraphs = splitParagraphs(page.text);
    for (const paragraph of paragraphs) {
      const sectionTitle = detectSectionTitle(paragraph);
      if (sectionTitle) {
        if (normalizeChunkText(current.text)) {
          flush({ keepOverlap: false });
        }
        current.sectionTitle = sectionTitle;
      }

      if (!current.pageStart) current.pageStart = page.pageNumber;
      current.pageEnd = page.pageNumber;

      if (paragraph.length > options.targetChars) {
        const segments = splitLongText(paragraph, options.targetChars);
        for (const segment of segments) {
          if (current.text.length + segment.length > options.targetChars) flush();
          current.text = [current.text, segment].filter(Boolean).join('\n\n');
          current.pageEnd = page.pageNumber;
        }
        continue;
      }

      if (current.text.length + paragraph.length > options.targetChars) {
        flush();
        if (!current.pageStart) current.pageStart = page.pageNumber;
        current.pageEnd = page.pageNumber;
      }

      current.text = [current.text, paragraph].filter(Boolean).join('\n\n');
    }
  }

  current.text = current.text.trim();
  const tailOnlyOverlap = current.text.length <= options.overlapChars && chunks.length > 0;
  if (!tailOnlyOverlap) flush();

  return chunks;
}

function splitParagraphs(text) {
  const textWithSectionBreaks = markInlineSectionBreaks(text);
  const sentenceBoundary = /(?<=[.!?。！？]|다\.|요\.|임\.|함\.)\s+/g;
  const blocks = textWithSectionBreaks
    .split(/\n{2,}/)
    .map(value => value.trim())
    .filter(Boolean);

  const paragraphs = [];
  for (const block of blocks) {
    const sentences = block
    .split(sentenceBoundary)
    .map(value => value.trim())
    .filter(Boolean);

    let buffer = '';
    for (const sentence of sentences) {
      if (buffer.length + sentence.length > 700) {
        if (buffer) paragraphs.push(buffer);
        buffer = sentence;
      } else {
        buffer = [buffer, sentence].filter(Boolean).join(' ');
      }
    }
    if (buffer) paragraphs.push(buffer);
  }
  return paragraphs.length > 0 ? paragraphs : [text].filter(Boolean);
}

function markInlineSectionBreaks(text) {
  return text
    .replace(/\s+(Part\s+[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*[.．]\s+)/g, '\n\n$1')
    .replace(
      /\s+(\d{1,3}\s+\d+\s+(?:지급대상|지급액|지급기간|지급기준|신청 및 지급|수급자격|공통 요건|Ⅰ유형 요건|Ⅱ유형 요건|신청 절차|지급 여부 결정|부정수급|반환명령|자진신고자))/g,
      '\n\n$1',
    )
    .replace(
      /\s+(\d{1,3}\s+[가-힣]\s+(?:지급회차별 지급기준|구직활동 이행에 따른 지급기준|종료자에 대한 지급기준|지급정지|소득 산정|절차))/g,
      '\n\n$1',
    );
}

function splitLongText(text, targetChars) {
  const segments = [];
  for (let start = 0; start < text.length; start += targetChars) {
    segments.push(text.slice(start, start + targetChars));
  }
  return segments;
}

function detectSectionTitle(text) {
  const normalized = text.trim();
  const numberedHeading = normalized.match(
    /^(\d{1,3}\s+\d+\s+(?:지급대상|지급액|지급기간|지급기준|신청 및 지급|수급자격|공통 요건|Ⅰ유형 요건|Ⅱ유형 요건|신청 절차|지급 여부 결정|부정수급|반환명령|자진신고자))/,
  );
  if (numberedHeading) {
    return numberedHeading[1].trim();
  }

  const candidates = [
    /^(제\s*\d+\s*[장절]\s+[^.]{2,80})/,
    /^(\d+(?:\.\d+)*[.)]?\s+[^.]{2,80})/,
    /^([가-힣A-Za-z0-9\s·/()-]{2,50})$/,
  ];

  for (const pattern of candidates) {
    const match = normalized.match(pattern);
    if (match && match[1].length <= 80) {
      return match[1].trim();
    }
  }
  return null;
}

function normalizeChunkText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function estimateTokenCount(text) {
  return Math.max(1, Math.ceil(text.length / 3));
}

async function createEmbeddings(texts, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required unless --dry-run is used.');

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embeddings request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.data
    .sort((left, right) => left.index - right.index)
    .map(item => item.embedding);
}

function vectorLiteral(values) {
  return `[${values.map(value => Number(value).toFixed(8)).join(',')}]`;
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function uploadPdfIfRequested(admin, args, absoluteFilePath) {
  if (!args.storageBucket) {
    return {
      storageBucket: null,
      storagePath: null,
    };
  }

  const fileName = path.basename(absoluteFilePath);
  const storagePath = args.storagePath || `manuals/${Date.now()}-${fileName}`;
  const bytes = await fs.readFile(absoluteFilePath);

  const { error } = await admin.storage
    .from(args.storageBucket)
    .upload(storagePath, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload PDF to Supabase Storage: ${error.message}`);
  }

  return {
    storageBucket: args.storageBucket,
    storagePath,
  };
}

async function replaceExistingDocument(admin, title, version) {
  const { data, error } = await admin
    .from('manual_documents')
    .select('id')
    .eq('title', title)
    .eq('version', version);

  if (error) throw error;
  const ids = (data ?? []).map(row => row.id);
  if (ids.length === 0) return 0;

  const { error: deleteError } = await admin
    .from('manual_documents')
    .delete()
    .in('id', ids);

  if (deleteError) throw deleteError;
  return ids.length;
}

async function insertManual(admin, args, chunks, storage) {
  if (args.replace) {
    const removed = await replaceExistingDocument(admin, args.title, args.version);
    if (removed > 0) {
      console.log(`Removed ${removed} existing document(s) with same title/version.`);
    }
  }

  const { data: documentRow, error: documentError } = await admin
    .from('manual_documents')
    .insert({
      title: args.title,
      version: args.version,
      source_type: 'pdf',
      source_url: args.sourceUrl,
      storage_bucket: storage.storageBucket,
      storage_path: storage.storagePath,
      published_at: args.publishedAt,
    })
    .select('id')
    .single();

  if (documentError) throw documentError;

  const documentId = documentRow.id;
  const batchSize = 32;
  let insertedCount = 0;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const embeddings = await createEmbeddings(batch.map(chunk => chunk.chunkText), args.embeddingModel);
    const rows = batch.map((chunk, index) => ({
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      section_title: chunk.sectionTitle,
      chunk_text: chunk.chunkText,
      token_count: chunk.tokenCount,
      embedding: vectorLiteral(embeddings[index]),
      embedding_model: args.embeddingModel,
      metadata: {
        ingest_script: 'manual-rag/scripts/ingest_manual_pdf.mjs',
      },
    }));

    const { error } = await admin.from('manual_chunks').insert(rows);
    if (error) throw error;
    insertedCount += rows.length;
    console.log(`Inserted chunks ${insertedCount}/${chunks.length}`);
  }

  return {
    documentId,
    insertedCount,
  };
}

async function writeSummary(args, pages, chunks, result) {
  await fs.mkdir(args.outputDir, { recursive: true });
  const baseName = path.basename(args.file, path.extname(args.file)).replace(/[^A-Za-z0-9._-]+/g, '_');
  const chunksPath = path.join(args.outputDir, `${baseName}.chunks.json`);
  const summaryPath = path.join(args.outputDir, `${baseName}.summary.json`);

  await fs.writeFile(chunksPath, JSON.stringify(chunks, null, 2), 'utf8');
  await fs.writeFile(summaryPath, JSON.stringify({
    file: args.file,
    title: args.title,
    version: args.version,
    pageCount: pages.length,
    chunkCount: chunks.length,
    targetChars: args.targetChars,
    overlapChars: args.overlapChars,
    result,
    sampleChunks: chunks.slice(0, 3).map(chunk => ({
      chunkIndex: chunk.chunkIndex,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      sectionTitle: chunk.sectionTitle,
      preview: chunk.chunkText.slice(0, 300),
    })),
  }, null, 2), 'utf8');

  return {
    chunksPath,
    summaryPath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);

  if (args.help) {
    console.log(usage());
    return;
  }

  const absoluteFilePath = path.resolve(args.file);
  console.log(`Extracting PDF: ${absoluteFilePath}`);
  const pages = await extractPdfPages(absoluteFilePath);
  const chunks = chunkPages(pages, {
    targetChars: args.targetChars,
    overlapChars: args.overlapChars,
  });

  if (chunks.length === 0) {
    throw new Error('No chunks were created. Check whether the PDF contains extractable text.');
  }

  let result = {
    mode: 'dry-run',
    documentId: null,
    insertedCount: 0,
    storageBucket: null,
    storagePath: null,
  };

  if (!args.dryRun) {
    const admin = getSupabaseAdmin();
    const storage = await uploadPdfIfRequested(admin, args, absoluteFilePath);
    const inserted = await insertManual(admin, args, chunks, storage);
    result = {
      mode: 'ingest',
      documentId: inserted.documentId,
      insertedCount: inserted.insertedCount,
      storageBucket: storage.storageBucket,
      storagePath: storage.storagePath,
    };
  }

  const outputs = await writeSummary(args, pages, chunks, result);
  console.log(JSON.stringify({
    pageCount: pages.length,
    chunkCount: chunks.length,
    result,
    outputs,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
