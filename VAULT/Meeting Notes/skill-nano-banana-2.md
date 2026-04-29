# Skill — Nano Banana 2

## Overview
הקובץ `.claude/SKILLS/nano-banana-2/SKILL.md` מגדיר skill ליצירת תמונות דרך Google Nano Banana 2 (Gemini 3.1 Flash Image) באמצעות MCP server בשם `mcp-image` (npm: `shinpr/mcp-image`). ה-tool הנחשף הוא `generate_image` עם תמיכה ב-aspect ratios, quality presets (fast/balanced/quality), image-to-image editing, ו-character consistency. הגישה דורשת `GEMINI_API_KEY` ו-MCP מוגדר ב-`.claude/settings.json`.

## Open Questions
- יש להגדיר `GEMINI_API_KEY` כ-environment variable לפני שימוש ראשון.

## Session Log

### 2026-04-27 — יצירת nano-banana-2 skill [shipped]
- **What was done:** נוצר SKILL.md עם תיעוד מלא של generate_image tool, quality presets, ודוגמאות שימוש. הוגדר MCP server ב-settings.json.
- **Decisions:** שימוש ב-`mcp-image` (shinpr) כי הוא תומך ספציפית ב-Nano Banana 2 ו-Nano Banana Pro. IMAGE_OUTPUT_DIR מוגדר ל-`outputs/` בשורש הפרויקט.
- **Notes / Caveats:** fast preset ~30-40s, quality ~90s+. IMAGE_OUTPUT_DIR חייב להיות absolute path.
- **Related:** [[agent-yuval]], [[agents-folder]], [[skills-folder-architecture]]
