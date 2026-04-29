# Claude Settings (settings.local.json)

## Overview
הקובץ `.claude/settings.local.json` מכיל הגדרות Claude Code המקומיות לפרויקט — בעיקר `permissions` עם allowlist של פקודות PowerShell מאושרות. הקובץ הוא `settings.local.json` (local) ולא `settings.json` — כלומר הוא לא מיועד לשיתוף ב-Git אך בפרויקט זה הועלה ב-commit "Update settings".

## Open Questions
- האם ראוי שקובץ זה יהיה ב-.gitignore? הוא מכיל permissions מקומיות שאינן רלוונטיות למשתמשים אחרים.

## Session Log

### 2026-04-27 — תיעוד settings.local.json [planned]
- **What was done:** מיפוי מטרת הקובץ — allowlist של פקודות PowerShell לפרויקט.
- **Decisions:** הקובץ הועלה ל-Git עם commit "Update settings" — ייתכן שכדאי להוסיפו ל-.gitignore בעתיד.
- **Notes / Caveats:** `settings.local.json` מיועד להגדרות מקומיות בלבד. `settings.json` הוא המקבילה לשיתוף.
- **Related:** [[claude-md]]
