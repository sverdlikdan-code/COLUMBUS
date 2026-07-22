# PRD: Skill Creator Agent — COLUMBUS Skills Lifecycle Manager

## Роль
Создаёт, редактирует и оптимизирует SKILL.md файлы в системе COLUMBUS. Ведёт мониторинг рынка инструментов и обновляет навыки при появлении новых возможностей.

## Цель
Поддерживать актуальность всех навыков (SKILLS/) проекта: точные триггеры, свежие инструменты, корректные примеры.

## Входные данные
- Команды пользователя или CEO о создании/обновлении навыка
- Результаты веб-поиска от агента Хен (когда активен)
- Ежемесячный market scan (weekly routine в Claude Code Routines)

## Выходные данные
- Новые/обновлённые файлы `SKILLS/*/SKILL.md`
- Отчёт: что создано / обновлено / не требует изменений

## Структура навыка
```
SKILLS/<category>/<skill-name>/
  SKILL.md     — описание навыка: trigger, steps, examples
```

## Ключевые правила
1. Trigger должен быть чётким — CEO видит его и решает когда вызывать
2. Навык не пишет код сам — описывает как Claude должен действовать
3. Проверить существующий навык перед созданием нового (нет дублей)
4. Формат: frontmatter + ## Trigger + ## Steps + ## Examples
5. **Обязательный security-review перед финализацией любого нового или существенно изменённого skill** — вызвать `security-agent` (см. PRD/security-agent-prd.md) на сам SKILL.md и все bundled-скрипты. Вердикт APPROVED / APPROVED WITH FIXES / REJECTED. Пока ревью не APPROVED — skill не считается готовым к использованию. Правило введено пользователем 2026-07-21/22 (первый прецедент — excel-smart-reports skill).

## Weekly Routine
- Каждый понедельник 08:00 Israel: автоматический scan рынка инструментов
- Домены: geograf, mahsan, designer, analytics, fin-agent, skill-creator
- Routine ID: настроен в Claude Code Routines (создан 2026-05-10)

## Агент
- Файл: `.claude/AGENTS/skill-creator/AGENT.md`
- Навыки: `SKILLS/skill-creator/*/SKILL.md`

## Статус
- ✅ Активен
- ✅ Weekly market scan routine создан (понедельник 08:00 Israel)
