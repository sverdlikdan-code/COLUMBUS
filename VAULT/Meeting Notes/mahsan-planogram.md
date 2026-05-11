# mahsan-planogram — MAHSAN PLANOGRAM (FORMULA cold storage)

Topic file for planogram build system: ExcelJS builder, Power BI data, GitHub Actions CI/CD.

## Архитектура

- **Builder**: `C:\Users\d.sverdlik\Desktop\WORKSPACE\PLANOGRAM MAHSAN FORMULA\build-planogram.js`
- **Sync copy**: `COLUMBUS/planogram/build-planogram.js` (sync with Node fs.writeFileSync — PowerShell corrupts Hebrew)
- **CI/CD**: `.github/workflows/planogram.yml` — runs 08:00 Israel time Sun–Thu + workflow_dispatch
- **Web viewer**: `docs/index.html` → GitHub Pages at `https://sverdlikdan-code.github.io/COLUMBUS/`
- **Secrets**: PBI_TENANT, PBI_CLIENT, PBI_SECRET, PBI_DATASET, PBI_WORKSPACE, WORKFLOW_TRIGGER_TOKEN
- **Output**: `MAHSAN PLANOGRAM v41.xlsx` → 5 sheets (קפוא, חלבי, דגים, מחסן מעבר, צפון מלאי פחות מ3DAYS SALES)

## Cell structure (fillCell)

```
← START (pick #1 only, blue bold)
#pick_number
[🏅/⭐] [🏋️] product_name
────────────────────  (thin grey separator)
AVG/d: X.X קרט | Y.Y PAL  (if kratnost > 0)
KG: weight
╔══════════════╗
  מלאי: X PAL   (blue) or X קרט (red)
╚══════════════╝
────────────────────  (separator before dates)
פק"ע dd/mm/yy (Xd) Yקרט
```

## Compact fill rule (all 3 sheets)

Zero-stock products skip planogram slots. In-stock products fill sequentially. פנוי only at end after all products placed.

## Family legend bar (row 2)

- Colored family labels, height=30, shrinkToFit, medium top border
- No hyperlinks — pure visual legend
- Refresh timestamp in last cell

## Empty cells (פנוי)

- Added to colsToResize (width=32) + rowsToResize (height=160)
- Light grey border + near-white background, font size 10 bold grey

## Sessions

### 2026-05-12 #session-end ✅
Fixed legend row overflow (FERMA napolzaet): navRow.height 20→30, medium top border, shrinkToFit+wrapText:false.
Added PAL delimiter: thin separator line before פק"ע dates section.
Fixed empty cells: added to resize sets + border/fill.
Build output: ✅ v41.xlsx, all 3 sheets, 16 zero קפוא / 4 zero חלבי / 15 zero דגים.
