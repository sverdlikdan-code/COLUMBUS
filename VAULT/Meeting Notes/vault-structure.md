# Vault Structure

## Overview
התיקייה `VAULT/` היא ה-Obsidian vault של הפרויקט — הזיכרון לטווח ארוך המנוהל לפי פרוטוקול `obsidian-vault-workflow`. מבנה: Meeting Notes (קוד, ארכיטקטורה, החלטות), Content Briefs (briefs עריכה), Publishing Log (לוג פרסומים), Brand Guidelines (voice, visuals, UI). כל תיקייה מכילה `_index.md` ו-topic files. ה-vault מחובר לObsidian דרך `.obsidian/` בשורש הפרויקט.

## Open Questions
- none

## Session Log

### 2026-04-27 — יצירת מבנה VAULT [shipped]
- **What was done:** נוצרו 4 תיקיות ה-vault (Meeting Notes, Content Briefs, Publishing Log, Brand Guidelines) עם _index.md לכל אחת + topic files לכל קובץ בפרויקט.
- **Decisions:** ה-vault נוצר ריק ואוכלס בסשן זה לפי הוראות obsidian-vault-workflow.
- **Notes / Caveats:** `.obsidian/` בשורש הפרויקט (לא בתוך VAULT/) — Obsidian מוגדר על כל הפרויקט כ-vault.
- **Related:** [[skill-obsidian-vault-workflow]], [[skills-folder-architecture]]
