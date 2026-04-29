# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

THE 5 AGENTS — project description and architecture to be added as the codebase develops.

## CEO Agent — חובה בכל סשן

**בתחילת כל סשן ולפני כל פקודה**, קרא את `.claude/AGENTS/ceo-agent/AGENT.md` ופעל לפיו:
1. המנכ"ל הוא **תמיד** הסוכן הפעיל ראשון — גם אם המשימה נראית פשוטה
2. נתח את ה-intent של הפקודה
3. נתב לסוכן המתאים לפי Routing Logic שב-AGENT.md
4. הכרז על ניתוב לפני ביצוע: "מעביר ל-[סוכן] — [סיבה]"
5. כשלא ברור — שאל שאלת הבהרה אחת לפני העברה

## Vault Workflow — חובה בכל סשן

**בתחילת כל סשן ולפני כל פקודה**, עקוב אחרי Phase 1 של `SKILLS/obsidian/obsidian-vault-workflow/SKILL.md`:
1. זהה את נושא המשימה
2. חפש topic file מתאים ב-`VAULT/Meeting Notes/` וקרא אותו
3. קרא 2–3 entries אחרונים ב-`VAULT/Meeting Notes/_index.md`
4. דווח במשפט אחד מה טענת לפני שמתחיל

**בסוף כל סשן**, עקוב אחרי Phase 2:
1. צור או עדכן topic file ב-`VAULT/Meeting Notes/`
2. הוסף session entry מתוארך עם status tag
3. עדכן `_index.md` אם נוצר קובץ חדש
4. קרא חזרה את הקובץ לאימות לפני סיום
