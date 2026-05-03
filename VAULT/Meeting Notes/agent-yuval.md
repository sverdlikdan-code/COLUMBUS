# Agent — יובל

## Overview
הקובץ `.claude/AGENTS/yuval/AGENT.md` מגדיר סוכן קריאייטיב בשם יובל (role: specialist). יובל סורק תמונות ב-`reference/` בשורש הפרויקט, מנתח סגנון/צבעים/קומפוזיציה, מחלץ מרכיבים רלוונטיים, ומנסח prompt שמשלב בין הבקשה לסגנון. לאחר מכן מפעיל את nano-banana-2 skill ושומר את התמונה ב-`outputs/`. מטרה: עקביות ויזואלית בין כל תמונות הפרויקט. CEO Agent מנתב אליו כשמתבקשת יצירת תמונה.

## Open Questions
- none

## Session Log

### 2026-05-01 — Formula Road app icon generation [shipped]
- **What was done:** יצירת אייקון לאפליקציה Android של Formula Road (DILER FORMULA). reference/ ריקה — עיצוב לפי ברנדינג הפרויקט בלבד. סגנון: מינימליסטי, רקע navy כהה #0F2044, אקסנט זהב #C9A84C. סמל: אות F גיאומטרית עם נקודות waypoint (טבעות) בקצות — מייצג נתיב/ניווט. נוצר עם Python/Pillow (GEMINI_API_KEY לא זמין בסביבה).
- **Decisions:** icon.png ו-adaptive-icon.png שניהם עודכנו ב-app/assets/. גודל 1024x1024px PNG עם rounded corners לסגנון Android.
- **Notes / Caveats:** GEMINI_API_KEY לא מוגדר כ-env variable — nano-banana-2 MCP לא הופעל. נוצר programmatically. אם בעתיד GEMINI_API_KEY יהיה זמין — כדאי לשחזר עם AI generation לאיכות גבוהה יותר.
- **Related:** [[skill-nano-banana-2]], [[formula-road-project]]

### 2026-04-27 — יצירת agent יובל [shipped]
- **What was done:** נוצר AGENT.md עם 5-שלבי workflow, Prompt Formula, Reference Analysis Guide, ו-Output Naming convention. CEO Agent עודכן לכלול יובל ב-Registry ו-Routing Logic.
- **Decisions:** תיקיות reference/ ו-outputs/ נוצרו בשורש הפרויקט. Output naming: `<topic>-YYYYMMDD-HHmm.png`.
- **Notes / Caveats:** אם reference/ ריקה — יובל ממשיך ללא ניתוח ויוצר לפי הבקשה בלבד. Anti-pattern מרכזי: אין לדלג על ניתוח reference גם בבקשות פשוטות.
- **Related:** [[skill-nano-banana-2]], [[ceo-agent-prd]], [[agents-folder]]
