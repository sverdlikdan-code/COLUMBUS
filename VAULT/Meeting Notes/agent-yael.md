# Agent — יעל

## Overview
הקובץ `.claude/AGENTS/yael/AGENT.md` מגדיר סוכנת כתיבת תוכן בשם יעל (role: specialist, LLM-only). יעל סורקת `Content/`, קוראת מאמרי גלם, מנתחת שפה וסוג תוכן (שיווקי/בלוג/B2B/קריאייטיב), מזהה מקומות לתמונות, קוראת ליובל ישירות לקבלת תמונות, ומשכתבת בסגנון Brand Voice של הפרויקט. שומרת תוצר ב-`Output/` ומעבירה גלם ל-`Content/Ready/`. תומכת בעברית ואנגלית. Brand Voice מוגדר כ-placeholder — ממתין לתיעוד מהמשתמש.

## Open Questions
- Brand Voice טרם הוגדר — ממתין לפרטים מהמשתמש (טון, קצב, אוצר מילים, דוגמאות).

## Session Log

### 2026-04-27 — יצירת agent יעל [shipped]
- **What was done:** נוצר AGENT.md עם 6-שלבי workflow, Content Type Profiles ל-4 סוגי תוכן, Image Decision Rules לקריאה ליובל, ו-Output Format. נוצרו תיקיות Content/, Content/Ready/, Output/. CEO Agent עודכן לנתב ליעל לכל בקשת כתיבה/שכתוב.
- **Decisions:** יעל קוראת ליובל ישירות (לא דרך המנכ"ל) — מהיר יותר ופשוט יותר. מקסימום 3 תמונות למאמר למניעת overload.
- **Notes / Caveats:** Brand Voice הוא PLACEHOLDER — חייב עדכון לפני שימוש ראשון אמיתי. יעל לא ממציאה מידע — רק משכתבת.
- **Related:** [[agent-yuval]], [[ceo-agent-prd]], [[agents-folder]]
