---
name: commit
description: Use when the user types /commit or asks to commit changes, stage and commit files, write a git commit message, or save current work to git. Analyzes staged/unstaged changes and generates a Conventional Commits message in Russian for the COLUMBUS project. Always invoke this skill before running git commit — never write a commit message without it.
---

# Commit — автоматизация git commit для COLUMBUS

## Overview

Скилл читает diff, выбирает правильный `type(scope)` по Conventional Commits, составляет описание на русском и коммитит после подтверждения пользователя. Добавляет `Co-Authored-By` в конец каждого commit message.

## Trigger

Вызывается по `/commit` или любой фразе вида "закоммить", "сделай коммит", "commit изменения", "сохрани в git".

---

## Workflow

### Шаг 1 — Проверка безопасности (ОБЯЗАТЕЛЬНО перед diff)

Проверить наличие запрещённых файлов в staged области:

```bash
git diff --cached --name-only
```

Если в списке есть файлы, совпадающие с паттернами ниже — **остановиться** и предупредить пользователя:

- `*.env` или `.env*`
- `*.xlsx`, `*.xls`
- `*token*`, `*secret*`, `*key*` (если это не исходный код — `.js`, `.ts`, `.py`, `.go`)
- `*.pem`, `*.p12`, `*.pfx`

Сообщение пользователю:
```
СТОП: обнаружены файлы, которые не следует коммитить:
  - <имя файла> (<причина>)

Исключи их через `git reset HEAD <файл>` и повтори /commit.
```

Не продолжать workflow пока запрещённые файлы не убраны из staged.

### Шаг 2 — Получить diff

Сначала проверить staged изменения:

```bash
git diff --cached --stat
git diff --cached
```

Если staged пусто — взять unstaged:

```bash
git diff HEAD --stat
git diff HEAD
```

Если оба пусты — сообщить: "Нет изменений для коммита. Сначала добавь файлы через `git add`."

### Шаг 3 — Определить type и scope

**Type** — выбрать одно:

| type | когда использовать |
|------|-------------------|
| `feat` | новая функциональность, новый файл с логикой |
| `fix` | исправление бага или неверного поведения |
| `chore` | техническая правка: конфиги, зависимости, build |
| `docs` | документация, README, SKILL.md, AGENT.md |
| `refactor` | изменение кода без изменения поведения |
| `style` | форматирование, пробелы, переименования без логики |
| `test` | тесты |

**Scope** — выбрать по затронутым файлам/директориям:

| scope | файлы / признаки |
|-------|-----------------|
| `geograf` | routing, GPS, координаты, `latitude`, `longitude`, `visit_order`, Azure Maps |
| `mahsan` | планограмма, `planogram/`, холодное хранилище, bay, `kapua`, `dagim`, `halavi` |
| `formula-road` | веб-карта маршрутов, `index.html`, `map.js`, карта агентов |
| `designer` | мобильный UX, React Native, `App.js`, экраны приложения |
| `analytics` | Power BI, DAX, отчёты, `docs/`, `.pbix`, `.pbit` |
| `fin-agent` | токены, бюджеты, расход API, cost monitoring |
| `skill-creator` | `SKILLS/`, `SKILL.md`, скиллы |
| `ceo` | `AGENTS/ceo-agent/`, роутинг агентов |
| `vault` | `VAULT/`, заметки сессий, Obsidian |
| `planogram` | `planogram/`, build скрипты планограммы, `pbi-kapua` |
| `docs` | `docs/` статические файлы, `health-report.json` |
| `workflow` | `.github/`, `*.yml`, CI/CD, build scripts |

Если изменения касаются нескольких scope — выбрать наиболее специфичный. Если ни один не подходит — опустить scope: просто `feat: описание`.

### Шаг 4 — Составить commit message

Формат:
```
type(scope): описание на русском

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Правила описания:
- Инфинитив: "добавить", "исправить", "обновить", "удалить", "переименовать"
- До 72 символов в первой строке включая `type(scope): `
- Конкретно: что именно сделано, а не "изменить файлы"
- Не добавлять точку в конец первой строки

Если изменений много и они разнородные — предложить пользователю разбить на несколько коммитов.

### Шаг 5 — Показать и подтвердить

Вывести предлагаемый commit message в блоке кода и спросить:

```
Предлагаемый commit message:

feat(mahsan): добавить фильтр по температурной зоне в планограмме

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

Подтверждаешь? (да / изменить / отмена)
```

Ждать ответа пользователя. Не коммитить без явного подтверждения.

### Шаг 6 — Выполнить коммит

После подтверждения:

```bash
git commit -m "$(cat <<'EOF'
type(scope): описание

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Если пользователь попросил изменить — скорректировать сообщение и вернуться к шагу 5.

После успешного коммита вывести хэш коммита из вывода git.

---

## Примеры для COLUMBUS

**Пример 1 — исправление бага в маршрутизации:**
```
fix(geograf): исправить порядок визитов при старте из Хайфы
```

**Пример 2 — новая функция в планограмме:**
```
feat(mahsan): добавить экспорт планограммы в PDF
```

**Пример 3 — обновление конфига CI:**
```
chore(workflow): обновить GitHub Actions до Node 20
```

**Пример 4 — правки в документации агента:**
```
docs(ceo): уточнить правила роутинга в AGENT.md
```

**Пример 5 — правки в Power BI метрике:**
```
fix(analytics): добавить фильтр по месяцу в DAX-мере % ביצוע
```

**Пример 6 — несколько изменений в разных областях:**
```
chore: обновить зависимости и очистить временные файлы
```
(без scope — изменения не привязаны к одному домену)

---

## Запреты

- Никогда не коммитить без подтверждения пользователя
- Никогда не использовать `--no-verify`
- Никогда не коммитить `.env`, `*.xlsx`, секреты — остановиться и предупредить
- Никогда не писать commit message на английском (только первая строка `type(scope):` — латиница, описание — русский)
- Никогда не делать `git add .` или `git add -A` — только коммитить то, что уже в staged, или явно перечисленные пользователем файлы
- Не добавлять `--amend` без явной просьбы пользователя
