# Agent — ראובן

## Overview
הקובץ `.claude/AGENTS/reuven/AGENT.md` מגדיר סוכן תיאום בשם ראובן (role: sub-orchestrator). ראובן הוא מנהל צינור התוכן — מופעל מהמנכ"ל כשנדרש מאמר שלם מאפס, ומנהל את הפייפליין: חן (מחקר) → יעל (שכתוב) → יובל (תמונות, אם נדרש) → Output/. ראובן לא כותב, לא מחפש, לא מצייר — רק מתאם ומדווח.

## Architecture

```
CEO
 └── ראובן (pipeline שלם)
      ├── חן → Content/
      ├── יעל → Output/
      └── יובל (דרך יעל)
```

## Routing (CEO → ראובן מתי?)
- "כתוב מאמר על X" — pipeline מלא
- "ייצר תוכן על Y" — מחקר + כתיבה
- **לא** כשיש קובץ קיים (→ יעל ישירות) או רק חיפוש (→ חן ישירות)

## Session Log

### 2026-04-27 — יצירת agent ראובן [shipped]
- **What was done:** נוצר AGENT.md עם 5-שלבי workflow, Decision Logic (מחקר או ישירות ליעל), Capabilities. CEO Agent עודכן: ראובן נוסף ל-Registry כסוכן ראשון; Routing Logic מחודד — ראובן מקבל pipeline שלם, יעל ישירות לשכתוב קיים, חן ישירות לחיפוש בלבד.
- **Decisions:** ראובן הוא sub-orchestrator, לא specialist. הוא לא מבצע — רק מתאם. יובל מופעל דרך יעל (לא ישירות מראובן).
- **Notes / Caveats:** "Agent 5" נותר TBD — ראובן תפס את slot של Agent 4.
- **Related:** [[agent-chen]], [[agent-yael]], [[agent-yuval]], [[ceo-agent-prd]]
