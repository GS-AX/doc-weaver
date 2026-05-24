# Document Weaver

> **[English README](README.md)**

**복붙은 그만. 파일을 드롭하면 노트가 됩니다.**

Word, PDF, PowerPoint, Excel, HWP 파일을 깔끔한 Markdown으로 즉시 변환합니다. 파일을 창에 드래그하거나, 감시 폴더를 Downloads에 연결하거나, 커맨드 팔레트에서 선택하세요. 이미지는 자동 추출, 프론트매터는 자동 삽입.

- 📄 **DOCX** — 제목, 굵기, 기울임, 표, 이미지 완벽 보존
- 📑 **PDF** — 텍스트 레이어 추출 + 폰트 크기 기반 제목 감지
- 📊 **PPTX** — 단일 노트 또는 슬라이드별 노트 분리, 발표자 노트 포함
- 📈 **XLSX / XLS** — 시트마다 GitHub 표(GFM)로 변환
- 🇰🇷 **HWP / HWPx** — 한글 문서 지원 *(베타)*
- 📝 **TXT / CSV** — 그대로 또는 표 형식으로 변환

API 키 없음. 클라우드 없음. 완전 오프라인.  
[Confluence Weaver](https://github.com/GS-AX/confluence-weaver)의 로컬 파일 버전입니다.

---

## 스크린샷

### 메뉴
![Menu](docs/menu.PNG)

### 변환 예시

| DOCX | PDF |
|---|---|
| ![DOCX](docs/docx.PNG) | ![PDF](docs/pdf.PNG) |

| PPTX | XLSX |
|---|---|
| ![PPTX](docs/ppt.PNG) | ![XLSX](docs/xlsx.PNG) |

### HWPx
![HWPx](docs/hwpx.PNG)

---

## 지원 형식

| 형식 | 확장자 | 변환 품질 |
|---|---|---|
| Word | `.docx` | ★★★★ — 제목·서식·표·이미지 보존, 차트 데이터 표로 추출. `.doc` 미지원. |
| PowerPoint | `.pptx` | ★★★☆ — 슬라이드 제목·내용·발표자 노트·이미지. 애니메이션·전환 효과 미보존. |
| PDF | `.pdf` | ★★★☆ — 텍스트 레이어 추출·제목 감지. 차트는 이미지로 추출. 스캔 PDF는 페이지 이미지로 렌더링. 표는 텍스트 전용. |
| Excel | `.xlsx` / `.xls` | ★★☆☆ — 시트별 GFM 표 변환. 차트 추출 미지원. |
| HWP | `.hwp` | ★★☆☆ ⚠ 베타 — 바이너리 포맷 최선 변환. 셀 병합·복잡한 서식 손실 가능. |
| HWPx | `.hwpx` | ★★★☆ ⚠ 베타 — ZIP+XML, HWP보다 높은 품질. 이미지 인라인 배치는 XML 구조에 따라 다를 수 있음. |
| 일반 텍스트 / CSV | `.txt` / `.csv` | ★★★★ — 그대로 또는 GFM 표로 자동 변환. |

---

## 설치

### 커뮤니티 플러그인 (권장)
1. Obsidian → **설정 → 커뮤니티 플러그인 → 탐색**
2. **Document Weaver** 검색 후 **설치** 클릭
3. **활성화** 클릭

### 수동 설치
1. [Releases](https://github.com/GS-AX/doc-weaver/releases)에서 `main.js`, `manifest.json` 다운로드
2. Vault의 `.obsidian/plugins/document-weaver/` 폴더에 복사
3. Obsidian → **설정 → 커뮤니티 플러그인** → **Document Weaver** 활성화

---

## 사용법

### 파일 가져오기
- **커맨드 팔레트**: `Doc Weaver: 파일 가져오기…` → 파일 선택 (다중 선택 가능)
- **드래그 앤 드롭**: 지원 파일을 Obsidian 창에 드롭 (단일/다중 모두 가능)
- **감시 폴더**: 설정에서 지정한 OS 폴더를 자동으로 감시, 새 파일 감지 시 자동 변환

### 변환 결과
변환된 노트는 설정된 대상 폴더(기본: `Imported/`)에 저장됩니다.

```markdown
---
source_file: "보고서.docx"
source_format: "docx"
imported_at: "2026-05-23T10:00:00+09:00"
---

# 보고서 제목
...
```

이미지는 `Imported/_assets/<노트명>/image-001.png` 형태로 추출됩니다.

### 완료 알림
- 단일 파일: `✅ 보고서.docx → Imported/보고서.md (제목 12개, 이미지 3개)`
- 여러 파일: `✅ 5개 파일 가져오기 완료 (경고 1개) → Imported/`
- 오류는 `Imported/_import_errors.md`에 기록됩니다

---

## 설정

### 출력
| 설정 | 기본값 | 설명 |
|---|---|---|
| 대상 폴더 | `Imported` | 변환된 노트가 저장될 Vault 폴더 |
| 에셋 하위 폴더 | `_assets` | 추출된 이미지 저장 경로 |
| 파일명 충돌 | `번호 접미사` | 건너뛰기 / 덮어쓰기 / 번호 추가 |
| PowerPoint 출력 | `단일 노트` | 단일 노트 또는 슬라이드별 노트 |
| 이미지에 위키링크 | ON | `![[...]]` vs `![](...)` |
| 가져오기 후 열기 | ON | 변환 후 노트 자동 열기 (일괄 제외) |

### 감시 폴더
| 설정 | 기본값 | 설명 |
|---|---|---|
| 감시 폴더 목록 | (없음) | 자동 감시할 OS 경로 (여러 개 추가 가능) |
| 감시 간격(분) | `5` | 0이면 비활성화 |
| 하위 폴더 감시 | OFF | 재귀적으로 하위 폴더 감시 |
| 가져오기 후 처리 | `보관` | 보관 / 삭제 / 그대로 유지 |
| 보관 폴더 | (없음) | 변환 후 원본 파일을 이동할 경로 |

### 고급
| 설정 | 기본값 | 설명 |
|---|---|---|
| HWP 베타 기능 | OFF | HWP/HWPx 변환 활성화 (품질 제한 있음) |
| 언어 | 자동 | 자동 / 한국어 / English / 日本語 / 中文 |

---

## v1.0 한계점

- **역방향 내보내기 없음** — Markdown → Word/PDF 변환 미지원
- **OCR 없음** — 스캔된 PDF는 스텁 노트만 생성
- **클라우드 없음** — 로컬 파일 전용 (원격은 Confluence Weaver 사용)
- **HWP/HWPx** — 베타 품질. 복잡한 서식, 합쳐진 표 셀 등은 손실될 수 있음
- **PDF 표** — v1에서는 일반 텍스트로 변환 (v2에서 표 재구성 예정)

---

## 라이선스

MIT © [GS-AX](https://github.com/GS-AX)
