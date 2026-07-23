---
name: hebrew-bidi
description: Use when working with Hebrew text from Power BI, SQL databases, or mixed Hebrew/English display in web apps. Covers BiDi encoding, RTL layout, digit order bugs, and which function to call in which context.
---

# Hebrew BiDi — Skill

## Overview

Hebrew text in COLUMBUS comes from multiple sources, each with a different encoding problem. Using the wrong fix function = garbled text. This skill maps each source to the correct handler.

## When to Use

- Adding a new data field from Power BI that contains Hebrew
- Building a new page/app that displays Hebrew text
- Hebrew text appears reversed, garbled, or digits are in wrong order
- Mixed Hebrew + numbers + English in a single string
- RTL layout for new HTML page or email template

## Source → Function Map

| Data source | Problem | Correct function |
|------------|---------|-----------------|
| Power BI REST API / DAX | LRO/RLO Unicode marks, visual order | `fixBiDi(raw)` |
| Legacy SQL database (planogram) | Raw bytes stored in visual/reversed order | `fixVisualRTL(s)` |
| Planogram family names | Hebrew segments mixed with product codes | `fixHebRTL(s)` |
| Client addresses from Power BI | LR-Override marks on address strings | `fixBiDiAddress(str)` |
| Client-side display (browser) | RTL/LTR mixing in HTML | `_ltrWrap(s)` + `dir` attributes |

## Function Locations (current codebase — as of 2026-07-05)

### fixBiDi(raw)
**Where:** `server/index.js:1444`, `server/build-mmd-orders.js:9`, `server/export-formiice-comparison.js:15`, `server/export-gps-report.js:107` (simplified — no digit/paren fix)

**What it does:**
1. Detects LRO/RLO marks: `/[\u200E\u200F\u202A-\u202E]/`
2. Strips all directional marks
3. Reverses word order
4. Reverses Hebrew characters within each word
5. Re-reverses digit runs (fixes 0021→1200 bug)
6. Swaps parentheses `(` ↔ `)` (visual RTL mirror)

**Use for:** Any string coming from Power BI DAX/REST that contains Hebrew.

### fixVisualRTL(s)
**Where:** `planogram/build-planogram.js:61`, `planogram/build-dagim-yavesh-base.js:18`, `planogram/pbi-extra-sheets.js:38`

**What it does:**
1. Strips Unicode directional marks
2. Reverses entire string
3. Re-reverses ASCII runs `/[\x20-\x7E]+/g` to preserve numbers and codes

**Use for:** Product names/descriptions from legacy SQL stored in reversed byte order.

### fixHebRTL(s)
**Where:** `planogram/build-kapua-new.js:29` and 4 other planogram scripts

**What it does:**
1. Matches Hebrew-only segments: `/[ְ-תװ-״]+/g`
2. Reverses each Hebrew segment internally
3. Leaves ASCII, digits, product codes untouched

**Use for:** Family names like `קפוא`, `חלבי` mixed with product category codes.

### fixBiDiAddress(str)
**Where:** `server/index.js:655`

**What it does:**
1. Checks for LR-Override marks: `/[\u202A\u202D]/`
2. Strips all directional marks
3. Reverses Hebrew segments if LRO was present

**Use for:** Street addresses from Power BI client data.

### _ltrWrap(s) — client-side only
**Where:** `MMD ORDERS/index.html:1149`, `docs/mmd-orders.html:974`

**What it does:** Splits on whitespace, wraps each Latin/digit token in `<span dir="ltr">`.

**Use for:** Displaying mixed text in RTL HTML context without garbling numbers.

## HTML RTL Setup — New Pages

Always on `<html>`:
```html
<html dir="rtl" lang="he">
```

For mixed content inline:
```html
<span dir="ltr">ABC-123</span>   <!-- numbers, codes, English -->
<span dir="rtl">שם מוצר</span>   <!-- Hebrew text -->
```

For emails with Hebrew:
```html
<div dir="rtl" style="direction:rtl; font-family: Arial, sans-serif;">
```

## Key Unicode Ranges

| Pattern | Matches |
|---------|---------|
| `/[\u200E\u200F\u202A-\u202E]/` | BiDi control marks (LRM, RLM, LRO, RLO, LRE, RLE, PDF) |
| `/[א-ת]/` | Hebrew letters Aleph–Tav |
| `/[֐-׿יִ-ﭏ]/` | Full Hebrew block including diacritics |
| `/[ְ-תװ-״]/` | Hebrew block used in planogram scripts |
| `/[\x20-\x7E]+/` | ASCII printable — preserve during reversal |

## Common Bugs and Fixes

### Digits appear reversed (0021 → 1200)
**Cause:** fixBiDi reverses entire word including digits.
**Fix:** After Hebrew character reversal, re-reverse digit runs: `/\d+/g` each match reversed.
**Reference:** `project_bidi_numbers_fix` memory + `server/index.js:1444`

### Parentheses mirrored `(text)` becomes `)text(`
**Cause:** Visual RTL encoding swaps parens.
**Fix:** After reversal, swap `(` ↔ `)` in the result.

### Text looks correct on Windows but garbled on server
**Cause:** File saved with BOM or wrong encoding.
**Fix:** Ensure UTF-8 without BOM. Node.js reads files as UTF-8 by default.

### New Power BI field shows reversed Hebrew
**Cause:** PBI sends LRO-encoded visual-order string.
**Fix:** Pipe through `fixBiDi()`. If export-gps-report variant doesn't fix digits — use the full `server/index.js` version.

## WARNING — Duplication Risk

`fixBiDi` exists in **4 separate files** with slightly different implementations. If you fix a bug in one:
1. Check all 4 files: index.js, build-mmd-orders.js, export-formiice-comparison.js, export-gps-report.js
2. Apply the same fix to each copy
3. Test each script's output after patching

Future refactor target: consolidate into `server/utils/bidi.js` — but only with full test coverage first.

## Quick Decision Tree

```
Hebrew text is garbled?
├── Comes from Power BI (DAX/REST)?
│   ├── Contains addresses? → fixBiDiAddress()
│   └── Other text? → fixBiDi()
├── Comes from planogram SQL (legacy)?
│   ├── Family names? → fixHebRTL()
│   └── Product names? → fixVisualRTL()
└── Displaying in browser (HTML)?
    ├── Numbers/codes mixed in? → _ltrWrap()
    └── Full page layout? → dir="rtl" on <html>
```
