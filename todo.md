# Project TODO

- [x] Initialize project scaffold
- [x] Design tokens: #009C64, #F0EEE9, Noto Sans KR
- [x] Login page with role selection
- [x] Counselor dashboard with mock data
- [x] Client list with filter tabs
- [x] Client registration form
- [x] Admin dashboard
- [x] Counselor list (admin)
- [x] Admin client list
- [x] Analyze Excel data (150 rows, 56 columns)
- [x] Analyze PDF survey form (구직준비도 설문지)
- [x] Design Supabase schema from real data
- [x] Write RLS policies SQL
- [x] Generate seed SQL from Excel data
- [x] Remove ALL Supabase/OpenAI keys from env vars and code (localStorage only)
- [x] Build Settings page: Supabase URL, anon key, service role key, OpenAI key (all localStorage only)
- [x] Update Supabase client to read only from localStorage
- [x] Update AuthContext to use Supabase Auth with runtime keys
- [x] Update all pages to use real Supabase data via API layer (with mock fallback)
- [x] Add 구직준비도 설문지 management UI (입력/조회/수정) in client detail
- [x] Provide SQL schema file for user to run in Supabase dashboard (supabase_setup.sql)
- [x] Ensure .gitignore covers all sensitive files
- [x] Write vitest tests (11 tests passing)
- [x] Add Zeniel logo to login page and sidebar nav
- [x] AdminDashboard: use real Supabase data with mock fallback
- [x] AdminClientList: use real Supabase data with CSV export
- [x] Save checkpoint

## Electron Packaging
- [x] Install electron and electron-builder as devDependencies
- [x] Create electron/main.js (main process with BrowserWindow)
- [x] Create electron/preload.js (contextBridge IPC)
- [x] Configure electron-builder.yml for Windows NSIS + macOS DMG
- [x] Update package.json with electron scripts
- [x] Create vite.electron.config.ts for Electron builds (base: './' for file:// protocol)
- [x] Write ELECTRON_BUILD.md with build instructions
- [x] Save checkpoint

## Security Audit & GitHub Upload
- [x] Scan source files for hardcoded secrets/API keys
- [x] Verify .gitignore covers all sensitive files
- [x] Verify .env files are not committed
- [x] Upload Excel data to Supabase (skipped - URL not configured)
- [x] Push to SuranS2/ZemiManager (private) on GitHub

## README & Branch
- [ ] Create dev branch
- [ ] Write README.md (KR/EN)
- [ ] Push dev branch to ZeniManager
