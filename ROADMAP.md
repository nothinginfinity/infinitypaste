# InfinityPaste — Full Feature Roadmap
> Generated: April 12, 2026
> Strategy: Local-first, pre-LLM processing layer. Run cheap deterministic tools first, escalate to LLM only when needed. Target: cut token usage 60–80% on daily workflows.

---

## ⚠️ Phase 2 — Queue Power Features (BUILT, NEEDS PUSH)

### 1. Queue Search
Live filter bar above the queue list. Searches across content, label, and source as you type. No new storage needed — filters in-memory against the existing queue array.

### 2. Queue Sort & Arrange
Sort controls: Date Created (newest/oldest), Label A–Z, Source. Plus touch-based drag-to-reorder for manual ordering. Custom order persists back to localStorage on drop.

### 3. Queue Item Expand / Full Preview
Cards currently truncate at 120 chars with no way to see the rest. Tap the card preview area to toggle full content inline — no new screen, no navigation, just expands in place.

---

## 🔵 Phase 3 — Smart Collect Tab + URL Fetch

### 4. Smart URL Detection on Collect Tab
When a URL is pasted into the Collect textarea, auto-detect it and show a 🌐 Fetch button. Fetches the full page, strips ads/nav/boilerplate with Readability.js (same algorithm as Firefox Reader Mode), fills the textarea with clean content ready to queue. Works on articles, GitHub, Wikipedia, docs, and most public pages.

### 5. HTML Table Extractor
When fetching a URL, detect all table elements in the raw HTML before Readability strips them. Convert to clean Markdown tables. Solves the wide-table-that-doesn't-fit-the-screen problem entirely — no screenshots needed.

### 6. Safari Bookmarklet Generator
In Settings, generate a one-line JavaScript bookmarklet the user saves to Safari. One tap on any page — including Perplexity threads (which block direct fetch via CORS) — grabs the full page text from inside the tab and sends it directly to InfinityPaste's Collect textarea. Bypasses CORS completely since the script runs inside the page.

### 7. Save URL as File
Option to save a fetched URL as a named file in the Files tab. Page title becomes the filename, URL saved as metadata. Reusable later — OCR it, summarize it, extract tables, or push to queue anytime.

### 8. AutoTitle (Smart Label Suggestion)
Label field auto-fills 800ms after you stop typing. 100% local, zero API calls. Logic in priority order:
- URL pasted → extract domain + path slug as title
- First line is short + looks like a heading → use it directly
- Long text blob → TF-IDF keyword extraction → join top 3–4 keywords
- Content from recording → prefix with 🎙️
- Content from OCR → prefix with 📷
- Content from URL fetch → use HTML title tag directly

User can always edit — AutoTitle never overwrites a manually typed label. Small "✨ Auto" badge indicates it's a suggestion.

---

## 🟡 Phase 4 — Local AI Tools (Pre-LLM Layer)

> All tools in this phase use Transformers.js or pure JS — zero API calls, models cached after first download.

### 9. Local Transcription (Whisper via Transformers.js)
Replaces the OpenAI Whisper API call entirely for most recordings. Downloads whisper-tiny (~75MB, cached after first use), transcribes recordings 100% on-device via WebAssembly/WebGPU. Zero API cost, works offline. Same lazy-load pattern already used for Tesseract. Quality: ~90% of Whisper API for clear speech.

### 10. TF-IDF Keyword Extractor
Pure JavaScript, zero libraries needed. Analyzes any queue item or file and extracts the most statistically significant keywords. Powers AutoTitle (Feature 8), suggests labels, and builds a local search index. Instant, runs in under 5ms on any device.

### 11. Local Summarization (distilBART via Transformers.js)
Downloads distilbart-cnn-6-6 (~250MB, cached after first use). Summarizes long documents, transcripts, and fetched pages entirely on-device. 75–80% quality of GPT-4 for factual, structured text at zero cost. Button appears on any queue item or file over ~500 words.

### 12. Readability Cleanup Tool
Uses compromise.js (200KB CDN). Grammar parsing, sentence splitting, verb/noun detection, tense normalization. Cleans up raw OCR output and messy transcripts before they hit the queue or an LLM. Deterministic — same input always gives same output.

### 13. Language Detection
Uses franc (2KB CDN). Instantly detects the language of any text — 99% accuracy. Auto-labels queue items with detected language. Helps route content correctly before summarization or LLM calls. Prevents wasted tokens sending non-English text to English-only prompts.

---

## 🟠 Phase 5 — Advanced Local Extraction Tools

### 14. Table-Aware OCR (hOCR Mode)
Switches Tesseract to hOCR output format, which returns bounding box coordinates (x, y, width, height) for every word. Post-processes those coordinates to cluster words into rows (by Y position) and columns (by X position within each row). Outputs a clean Markdown table. Works on screenshots of tables where HTML is not available.

### 15. Multi-Page Table Stitcher
Upload 2–3 screenshots of the same wide table that doesn't fit one screen. Detects the overlapping column header between images using fuzzy string matching. Merges all images into one complete Markdown table. Directly solves the wide-table screenshot problem.

### 16. QR Code Reader
Uses jsQR (40KB CDN). Detects and decodes QR codes in any uploaded image automatically. Extracted URL or text pushed straight to queue. Approximately 3 lines of code on top of the existing image upload flow. Free, instant, works offline.

### 17. Code Block Extractor
Detects monospace text regions in OCR hOCR output using font metrics and character spacing patterns. Extracts code snippets, formats them as fenced Markdown code blocks with language detection. Useful for screenshots of terminal output, code editors, and documentation.

### 18. Receipt & Invoice Parser
OCR plus regex pattern matching for common financial document patterns. Extracts: total amount, date, vendor name, line items, tax amounts. Outputs a clean structured text record to queue. Useful for expense logging and feeding the Phone Studio CRM later.

---

## 🔴 Phase 6 — Vision AI (Transformers.js)

### 19. SmolVLM Vision Q&A
Loads microsoft/SmolVLM (~500MB, cached after first use) via Transformers.js. Goes beyond OCR — lets you ask questions about an image in plain English. "What does this chart show?" / "Summarize this whiteboard" / "What are the key numbers in this screenshot?" Answers generated entirely on-device. Quality: ~75% of GPT-4V for common visual questions.

### 20. Business Card Parser
OCR plus structured regex rules for contact data patterns: name (title case), phone (various formats), email (@domain), company, job title keywords. Outputs a clean contact record to queue. Designed to feed directly into the Phone Studio CRM module. Zero LLM needed for standard printed business cards.

---

## 🟣 Cross-App Feature (InfinityPaste + Phone Studio)

### 21. Pre-LLM Processing Pipeline
A configurable processing chain that runs before any LLM call:
- Step 1 — Fetch / Upload
- Step 2 — Readability cleanup
- Step 3 — Language detection
- Step 4 — TF-IDF keyword extraction + AutoTitle
- Step 5 — Local summarization (if content > 500 words)
- Step 6 — Optional: escalate to LLM for generation/reasoning

User can toggle which steps run. Estimated token reduction: 60–80% for typical daily workflows since local tools handle all the prep. LLM only touches content that genuinely needs generation or complex reasoning.

---

## Technical Architecture Notes

**Lazy-load pattern (already established):**
All heavy libraries (Tesseract, Transformers.js, PDF.js) load on first use via dynamic import() or script injection. Model files cached in browser after first download. No bundle size impact until the feature is actually used.

**Storage architecture (Phase 1 complete):**
- Queue metadata → localStorage
- File/image/PDF blobs → IndexedDB (files object store, IDB v2)
- Recording blobs → IndexedDB (recordings object store)
- API keys → localStorage
- Settings → localStorage

**CORS strategy:**
- Direct fetch: works for most public sites
- Safari Bookmarklet: works for all sites including CORS-blocked ones (Perplexity, paywalled content)
- Share Target: already registered in manifest, works for any URL shared from any iOS app

**Model size budget (cumulative, all cached after first use):**
- Tesseract eng: ~10MB (already shipped)
- PDF.js: ~1MB (already shipped)
- Whisper-tiny: ~75MB
- franc: 2KB
- compromise.js: 200KB
- distilBART: ~250MB
- SmolVLM: ~500MB
- Total if all features used: ~836MB (cached, not re-downloaded per session)

---

## Build Priority Summary

1. **Phase 2** — Push the already-built queue features (search, sort, expand)
2. **Phase 3** — Smart Collect + URL fetch + AutoTitle (highest daily-use value)
3. **Phase 4** — Local transcription first (biggest cost savings), then TF-IDF + summarization
4. **Phase 5** — hOCR table extraction + QR reader (quick wins)
5. **Phase 6** — Vision AI (biggest model, most impressive, lowest urgency)
