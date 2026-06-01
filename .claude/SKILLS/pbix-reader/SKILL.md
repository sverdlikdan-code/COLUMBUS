# SKILL: pbix-reader

## Trigger

Use when asked to:
- Open, read, parse, or extract data from a `.pbix` file
- Audit a Power BI report structure
- List dashboard pages, visuals, or measures from a PBIX
- Use PBIX content as reference for presentations or documentation
- "Посмотри в PBIX", "что в файле PowerBI", "извлеки структуру из pbix"

## How it works

A `.pbix` file is a ZIP archive. It contains:
- `Report/Layout` — JSON with all pages, visuals, positions, field bindings (Unicode-encoded)
- `DataModel` — binary compressed model (measures, tables, relationships — partially readable)
- `DAXQueries/` — saved DAX queries (plain text)
- `Report/StaticResources/` — embedded images and theme files

## Workflow

### Step 1 — Extract the PBIX

```powershell
$pbix = "<path-to-file.pbix>"
$out  = "C:\tmp\pbix-extracted"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null
Copy-Item $pbix "C:\tmp\_pbix_work.zip"
Expand-Archive "C:\tmp\_pbix_work.zip" -DestinationPath $out -Force
```

### Step 2 — Read report structure

```powershell
$layout = Get-Content "$out\Report\Layout" -Raw -Encoding Unicode
$json   = $layout | ConvertFrom-Json

# Pages summary
$json.sections | Select-Object `
  @{N="Page";    E={$_.displayName}}, `
  @{N="Visuals"; E={$_.visualContainers.Count}}, `
  @{N="W";       E={$_.width}}, `
  @{N="H";       E={$_.height}} | Format-Table -AutoSize
```

### Step 3 — Extract visual types per page

```powershell
$json.sections | ForEach-Object {
    $pageName = $_.displayName
    Write-Host "`n=== $pageName ==="
    $_.visualContainers | ForEach-Object {
        try {
            $cfg  = $_.config | ConvertFrom-Json
            $type = $cfg.singleVisual.visualType
            if ($type) { $type }
        } catch {}
    } | Group-Object | Sort-Object Count -Descending |
      Select-Object Count, Name | Format-Table -AutoSize
}
```

### Step 4 — Extract field/measure bindings

```powershell
$json.sections | ForEach-Object {
    $pageName = $_.displayName
    Write-Host "`n=== $pageName ==="
    $_.visualContainers | ForEach-Object {
        try {
            $cfg  = $_.config | ConvertFrom-Json
            $type = $cfg.singleVisual.visualType
            if ($_.config -match '"NativeReferenceName":"([^"]+)"') {
                Write-Host "  [$type] $($Matches[1])"
            }
        } catch {}
    }
}
```

### Step 5 — Read DAX queries (if present)

```powershell
Get-ChildItem "$out\DAXQueries" -Filter "*.dax" | ForEach-Object {
    Write-Host "`n=== $($_.Name) ==="
    Get-Content $_.FullName -Raw
}
```

### Step 6 — Read theme

```powershell
$themeFile = Get-ChildItem "$out\Report\StaticResources\SharedResources\BaseThemes" -Filter "*.json" | Select-Object -First 1
if ($themeFile) { Get-Content $themeFile.FullName -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 3 }
```

## Output format

After extracting, synthesize and report:

```
PBIX SUMMARY: <filename>
Pages: <count>
─────────────────────────────────────
PAGE STRUCTURE (grouped by department):
  [Dept] Page name — N visuals (visual types)
  ...

KEY MEASURES FOUND:
  - <measure name>
  - ...

VISUAL TYPE DISTRIBUTION:
  advancedSlicerVisual: N   (filters)
  pivotTable: N             (cross-tabs)
  card / cardVisual: N      (KPI cards)
  ribbonChart: N            (trends)
  tableEx: N                (detail tables)
  lineStackedColumnComboChart: N

CUSTOM VISUALS:
  - <name>

NOTES:
  - DataModel is binary — measures/relationships not directly readable
  - Use DAX queries file for calculated measure definitions
```

## Symmetry check

After reading structure, check for:
1. **Page symmetry** — do all pages have consistent slicer setup (same filter fields across departments)?
2. **Visual symmetry** — similar pages should have similar visual counts and types
3. **Naming consistency** — page names mix Hebrew/English/emoji — note inconsistencies
4. **Missing pages** — if one department has more coverage than another, flag it

Report findings as a punch list: ✅ consistent / ⚠️ asymmetric / ❌ missing

## Cleanup

```powershell
Remove-Item "C:\tmp\pbix-extracted" -Recurse -Force
Remove-Item "C:\tmp\_pbix_work.zip" -Force
```

## Limitations

- `DataModel` is Vertipaq-compressed binary. Measure DAX code is NOT readable without Power BI Desktop or third-party tools (DAX Studio, Tabular Editor).
- Images embedded in visuals are not extractable via this method.
- Real data values are not in the PBIX — only schema/structure.
