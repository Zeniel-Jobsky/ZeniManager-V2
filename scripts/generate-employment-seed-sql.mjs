import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';

const SOURCE_PATH = 'D:/docs/truth/data.xlsx';
const OUTPUT_PATH = 'D:/docs/truth/employment_success_seed_from_data_xlsx.sql';

const workbook = xlsx.readFile(SOURCE_PATH);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

const dataRows = rows
  .slice(4)
  .filter(row => Array.isArray(row) && row.some(value => value !== null && value !== ''));

const employedRows = dataRows
  .map(toSeedRecord)
  .filter(record => record !== null);

const sql = buildSql(employedRows);
fs.writeFileSync(OUTPUT_PATH, sql, 'utf8');

console.log(JSON.stringify({
  outputPath: OUTPUT_PATH,
  totalRows: dataRows.length,
  employedRows: employedRows.length,
}, null, 2));

function toSeedRecord(row) {
  const seq = toInteger(row[0]);
  const clientName = normalizeText(row[3]);
  const age = toInteger(row[7]);
  const genderCode = mapGender(row[8]);
  const participationType = normalizeText(row[10]);
  const desiredJobs = parseDesiredJobs(row[14]);
  const schoolName = normalizeText(row[17]);
  const major = normalizeText(row[18]);
  const educationLevel = normalizeText(row[19]);
  const hireType = normalizeText(row[40]);
  const employmentDate = toIsoDate(row[41]);
  const employmentCompany = normalizeText(row[42]);
  const employmentJobType = normalizeText(row[43]);
  const employmentSalary = normalizeText(row[44]);

  if (!clientName || !employmentCompany) {
    return null;
  }

  const seqSuffix = String(seq ?? 0).padStart(7, '0');

  return {
    memo: `seed:data.xlsx:${seq ?? seqSuffix}`,
    classification: 'excel-seed',
    client_name: clientName,
    phone_encrypted: `0109${seqSuffix}`,
    age,
    gender_code: genderCode,
    education_level: educationLevel,
    school_name: schoolName,
    major,
    participation_type: participationType,
    participation_stage: '취업완료',
    desired_job_1: desiredJobs[0] ?? null,
    desired_job_2: desiredJobs[1] ?? null,
    desired_job_3: desiredJobs[2] ?? null,
    hire_type: hireType,
    hire_place: employmentCompany,
    hire_job_type: employmentJobType,
    hire_payment: employmentSalary,
    hire_date: employmentDate,
    job_place_start: employmentDate,
  };
}

function buildSql(records) {
  const columns = [
    'memo',
    'classification',
    'client_name',
    'phone_encrypted',
    'age',
    'gender_code',
    'education_level',
    'school_name',
    'major',
    'participation_type',
    'participation_stage',
    'desired_job_1',
    'desired_job_2',
    'desired_job_3',
    'hire_type',
    'hire_place',
    'hire_job_type',
    'hire_payment',
    'hire_date',
    'job_place_start',
  ];

  const valueLines = records.map(record => {
    const values = columns.map(column => sqlLiteral(record[column]));
    return `  (${values.join(', ')})`;
  });

  return [
    '-- Generated from D:/docs/truth/data.xlsx',
    '-- Rerunnable: rows are skipped when memo already exists.',
    `-- Source employed rows: ${records.length}`,
    'with seed_rows (',
    `  ${columns.join(',\n  ')}`,
    ') as (',
    'values',
    valueLines.join(',\n'),
    ')',
    'insert into public.client (',
    `  ${columns.join(',\n  ')}`,
    ')',
    'select',
    '  v.memo,',
    '  v.classification,',
    '  v.client_name,',
    '  v.phone_encrypted,',
    '  v.age,',
    '  v.gender_code,',
    '  v.education_level,',
    '  v.school_name,',
    '  v.major,',
    '  v.participation_type,',
    '  v.participation_stage,',
    '  v.desired_job_1,',
    '  v.desired_job_2,',
    '  v.desired_job_3,',
    '  v.hire_type,',
    '  v.hire_place,',
    '  v.hire_job_type,',
    '  v.hire_payment,',
    '  v.hire_date,',
    '  v.job_place_start::date',
    'from seed_rows v',
    'where not exists (',
    '  select 1',
    '  from public.client c',
    '  where c.memo = v.memo',
    ');',
    '',
    '-- Verification',
    "select count(*) as excel_seed_client_count from public.client where classification = 'excel-seed';",
    "select count(*) as excel_seed_success_case_count from public.employment_success_case where source_client_id in (select client_id from public.client where classification = 'excel-seed');",
    '',
  ].join('\n');
}

function normalizeText(value) {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function parseDesiredJobs(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  const jobs = normalized
    .split('\n')
    .map(part => part.replace(/^\d+\s*[.)]?\s*/, '').trim())
    .filter(Boolean);

  return jobs.slice(0, 3);
}

function mapGender(value) {
  const normalized = normalizeText(value);
  if (normalized === '남') return 'M';
  if (normalized === '여') return 'F';
  return null;
}

function toInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d-]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toIsoDate(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }

  const normalized = normalizeText(value);
  if (!normalized) return null;

  const dotted = normalized.replace(/[./]/g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(dotted)) return dotted;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sqlLiteral(value) {
  if (value == null) return 'null';
  if (typeof value === 'number') return String(value);
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}
