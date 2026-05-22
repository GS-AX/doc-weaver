# Doc Weaver — Product Requirements Document

> **Plugin ID**: `doc-weaver`
> **Working title**: Doc Weaver
> **Ecosystem**: Obsidian community plugin
> **Author**: GS-AX
> **Status**: Draft — decisions confirmed 2026-05-23

---

## 1. Overview

Doc Weaver is an Obsidian plugin that converts local document files (Word, PowerPoint, PDF, HWP, etc.) into Markdown and saves the result directly into the user's Vault. It is the companion to Confluence Weaver: where Confluence Weaver pulls from a remote wiki, Doc Weaver imports from the local filesystem.

---

## 2. Problem Statement

Knowledge workers accumulate documents in Word, PowerPoint, PDF, and HWP formats over years. These files are not searchable or linkable from Obsidian. The only workflow today is manual copy-paste, which loses structure. Doc Weaver eliminates that friction with one-click (or automated) conversion.

---

## 3. Target Users

| Persona | Pain |
|---|---|
| Korean office worker | Has years of HWP/Word reports, can't search them in Obsidian |
| Researcher | PDFs pile up; wants highlights and headings auto-extracted |
| Consultant / PM | PowerPoint decks need to become shareable, linkable notes |
| Obsidian power user | Already uses Confluence Weaver, wants the same for local docs |

---

## 4. Supported Formats (v1.0)

| Format | Extension | Library | Fidelity |
|---|---|---|---|
| Word | `.docx` | `mammoth` | High — headings, bold, italic, tables, images |
| PowerPoint | `.pptx` | `jszip` + custom XML | Medium — slide title, bullets, notes, images |
| PDF | `.pdf` | `pdfjs-dist` | Medium — text layer only; scanned PDFs = stub |
| HWP | `.hwp` | `hwp.js` | Low ⚠ beta — binary format, best-effort |
| HWPx | `.hwpx` | `jszip` + custom XML | Medium ⚠ beta — ZIP+XML, better than HWP5 |
| Plain text | `.txt`, `.csv` | Built-in | Exact |

> **Out of scope for v1.0**: `.xls(x)`, `.odt`, `.rtf`, scanned PDFs (OCR)

---

## 5. Core Features

### 5.1 Import Entry Points

| Entry point | Description |
|---|---|
| **Command palette** | `Doc Weaver: Import file…` → system file picker (multi-select supported) |
| **Drag & drop — single** | Drop one supported file onto the Obsidian window |
| **Drag & drop — bulk** | Drop multiple files at once; each converted in sequence with a summary notice at the end |
| **Watch folder** | Automatic background import from configured inbox folders |

> Drag & drop intercepts the `drop` event on the workspace root before Obsidian's default handler. Files with unsupported extensions are silently ignored (not blocked).

### 5.2 Bulk Import Behaviour
- Files are converted one by one in the order they were dropped
- A single summary notice appears on completion: `✅ 5 files imported (1 warning) → Imported/`
- Individual errors are appended to `Imported/_import_errors.md`; the batch does not abort on failure

### 5.3 Watch Folder
- User specifies one or more **inbox folders** outside the Vault
- Plugin polls at a configurable interval for new files
- On detection: convert → save to vault → move original to archive folder (or delete, configurable)
- Already-converted files are tracked by `filename + mtime` hash to avoid duplicates
- Recursive subfolder watching: configurable (default: off)

### 5.4 Conversion Output
- Saved to a configurable **destination folder** inside the Vault (default: `Imported/`)
- Filename: original basename + `.md`
- Collision strategy: `skip` / `overwrite` / `number suffix` (configurable, default: `number`)
- YAML frontmatter injected automatically:

```yaml
---
source_file: "report.docx"
source_format: "docx"
imported_at: "2026-05-23T10:00:00+09:00"
---
```

### 5.5 Asset Handling
- Embedded images extracted to `Imported/_assets/<note-name>/image-001.png`
- Linked as `![[image-001.png]]` (wikilink) or `![](path)` (markdown link), per setting

### 5.6 Conversion Quality Indicators
- Single-file success: `✅ report.docx → Imported/report.md (12 headings, 3 images)`
- Bulk summary: `✅ 5 files imported (1 warning) → Imported/`
- Low-fidelity warning (HWP binary, scanned PDF): `⚠️ report.hwp — limited conversion, some formatting may be lost`
- Failures logged to `Imported/_import_errors.md`

---

## 6. Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| Destination folder | Text | `Imported` | Vault folder for converted notes |
| Asset subfolder | Text | `_assets` | Sub-path inside destination for extracted images |
| Filename collision | Dropdown | `number` | `skip` / `overwrite` / `number` |
| Watch folders | List (add/remove) | `[]` | OS paths to monitor |
| Watch interval (min) | Number | `5` | 0 = disabled |
| Watch subfolders | Toggle | `off` | Recursively watch inbox subfolders |
| After import | Dropdown | `archive` | `archive` / `delete` / `keep` |
| Archive folder | Text | _(blank)_ | OS path to move originals after conversion |
| PPTX output | Dropdown | `single` | `single` note vs `per-slide` notes |
| Wikilinks | Toggle | `true` | `![[...]]` vs `![](...)` for images |
| Open after import | Toggle | `true` | Open the created note (skipped for bulk) |
| Show HWP beta features | Toggle | `false` | Enable HWP/HWPx conversion (marked beta) |
| Language | Dropdown | `auto` | UI language (auto / en / ko / ja / zh) |

---

## 7. Format-Specific Conversion Rules

### 7.1 DOCX (Word)
- `mammoth.js` converts to HTML; reuse the HTML→MD pipeline from Confluence Weaver
- Headings, bold, italic, strikethrough, tables, lists, images all preserved
- Footnotes → `[^1]` references at bottom of note
- Comments → stripped (v1), optional blockquote append (v2)
- Tracked changes → accept all silently before conversion

### 7.2 PPTX (PowerPoint)

**Single-note mode (default):**
```
# Deck Title

## Slide 1: Introduction
- Bullet one
- Bullet two

> **Notes:** Speaker notes text here

---

## Slide 2: Agenda
...
```

**Per-slide mode:**
- One `.md` file per slide: `DeckTitle - Slide 01.md`
- All slides also linked from a `DeckTitle.md` index note

Common rules:
- Slide title → heading
- Text boxes / bullet shapes → paragraphs / lists
- Tables → GFM tables
- Images extracted as assets
- Speaker notes → blockquote at end of slide section

### 7.3 PDF

**Conversion approach: `pdfjs-dist` + font-size heuristics**

1. Extract text items per page with position, font-name, and font-size metadata
2. Group items into lines by Y-coordinate proximity
3. Compute median body font-size; items ≥ 1.4× median = heading candidate
4. Assign H1/H2/H3 based on relative font-size tiers
5. Detect two-column layout by X-coordinate bimodal split; merge columns in reading order
6. Page breaks inserted as `---` (configurable: on/off)

**Known limitations:**
- No semantic table detection (tables become indented plain text in v1; v2 can add heuristic table reconstruction)
- Mathematical formulas preserved as-is text (no LaTeX)
- Scanned PDFs (no text layer) → emit `⚠️` notice and create stub note:

```markdown
---
source_file: "scan.pdf"
source_format: "pdf"
imported_at: "..."
pdf_has_text_layer: false
---

> ⚠️ This PDF has no text layer (scanned image). Text extraction was not possible.
> Original file: scan.pdf
```

### 7.4 HWP / HWPx (Hangul Word Processor) — Beta

> HWP/HWPx conversion is behind the **"Show HWP beta features"** toggle in settings. It is off by default. When enabled, all notices include a `[beta]` label.

**HWP (binary, `.hwp`)**
- Use `hwp.js` library (HWP5 format parser)
- Paragraphs with named styles: `제목 1`→H1, `제목 2`→H2, etc. (Korean style names)
- Tables → GFM tables (best-effort; merged cells lose merge info)
- Embedded images extracted
- Emit `⚠️ [beta]` notice

**HWPx (ZIP+XML, `.hwpx`)**
- Unzip with `jszip`, parse `Contents/section0.xml`
- Same paragraph style → heading mapping
- Better image fidelity than HWP binary
- Emit `⚠️ [beta]` notice

---

## 8. Architecture

```
src/
  main.ts                  Plugin entry, command registration, drop handler
  settings.ts              Settings tab UI
  types.ts                 Shared types (ImportResult, ConversionWarning, etc.)
  importer.ts              Orchestrator: format detection → converter → vault write
  dropHandler.ts           Intercepts workspace drop events, handles bulk queue
  watchScheduler.ts        Folder polling, hash tracking, archive/delete logic
  converters/
    docxConverter.ts       mammoth → HTML → MD
    pptxConverter.ts       jszip + XML parse → MD (single or per-slide)
    pdfConverter.ts        pdfjs-dist → text items → MD (heuristic headings)
    hwpConverter.ts        hwp.js (.hwp) / jszip+XML (.hwpx) → MD  [beta]
    plainConverter.ts      .txt / .csv → MD
  htmlToMarkdown.ts        Shared HTML → Markdown (adapted from Confluence Weaver)
  i18n/
    index.ts               t(), setLocale()
    en.ts / ko.ts / ja.ts / zh.ts
```

### Key dependencies

| Package | Purpose |
|---|---|
| `mammoth` | DOCX → HTML |
| `pdfjs-dist` | PDF text + layout extraction |
| `hwp.js` | HWP5 binary parsing |
| `jszip` | ZIP extraction for PPTX / HWPX |
| `obsidian` | Plugin API (devDep) |

---

## 9. Non-Goals (v1.0)

- **No reverse export** (Markdown → Word/PDF)
- **No OCR** — scanned PDFs produce stub notes only
- **No cloud sync** — local files only (use Confluence Weaver for remote)
- **No XLS/XLSX** — spreadsheets need dedicated table handling (v2)
- **No batch progress modal** — summary notice only; v2 can add a progress bar modal

---

## 10. Milestones

| Milestone | Deliverable |
|---|---|
| M1 | Scaffold, settings UI, i18n, DOCX conversion end-to-end |
| M2 | PDF conversion (pdfjs-dist, heuristic headings) |
| M3 | PPTX conversion (single + per-slide modes) |
| M4 | Bulk drag & drop + summary notice |
| M5 | Watch folder + archive/delete logic |
| M6 | HWP/HWPx conversion (beta toggle) |
| M7 | Asset extraction, frontmatter, error log, README |
| M8 | Polish, community submission |

---

## 11. Decisions Log

| # | Question | Decision |
|---|---|---|
| 1 | Plugin name | **Doc Weaver** |
| 2 | PPTX output mode | **User-selectable**: single note (default) or per-slide notes |
| 3 | HWP conversion quality | **Beta flag** — off by default, opt-in in settings |
| 4 | Watch folder | **Yes** — included in v1.0 |
| 5 | Bulk drag & drop | **Yes** — drop N files → converted in sequence, summary notice |
| 6 | PDF approach | **pdfjs-dist + font-size heuristics** — no OCR, scanned PDFs get stub note |
