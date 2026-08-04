---
source: https://jjsbuilder.com/moveset-codes/
retrieved: 2026-07-17
language: en
original_title: JJS Moveset Codes Sources & Community Database
---

# Jujutsu Shenanigans Moveset Codes — Sources & Data Format

> Источник: JJS Skill Builder + GitHub repositories

## Резюме

Найдены пять основных источников кодов мувсетов для Jujutsu Shenanigans (Roblox). Главный ресурс — **jjsbuilder.com** с базой 300+ готовых кодов в текстовом формате. Коды — это base64-строки (зжатие zstd JSON). GitHub репозитории содержат инструменты для создания/парсинга кодов. Discord и YouTube каналы дополняют со ссылками на готовые наборы.

## Ключевые цитаты

> "An import code uses the format: JSON → utf-8 → zstd compression → base64. The JSON is an array of "skill slot" objects." — lilgatitodev/claude-jjs-moveset-creator

> "JJS Skill Builder allows you to export your build as JSON — save your build as a backup or share the file with friends." — jjsbuilder.com

> "Browse community-shared moveset codes for Roblox Jujutsu Shenanigans, copy a code and import it in-game, or open the planner to study the structure." — jjsbuilder.com

## Главные источники кодов

### 1. **jjsbuilder.com** — ОСНОВНОЙ ИСТОЧНИК
- **URL:** https://jjsbuilder.com/moveset-codes/
- **Количество кодов:** 300+ готовых кодов (327+ пользовательских сборок)
- **Формат:** Текстовые base64-строки (одна строка = полный мувсет из 4 слотов)
- **Доступность:** ✅ Полная — можно копировать/импортировать, экспортировать в JSON
- **Примеры:** Flower, Modulo Yuji, Kurourushi, Monkeymans Toji, Re:Zero codes
- **Фишка:** /builds/ раздел для бросвинга кодов по темам

### 2. **GitHub — lilgatitodev/claude-jjs-moveset-creator**
- **URL:** https://github.com/lilgatitodev/claude-jjs-moveset-creator
- **Тип:** Репозиторий с документацией кодека и парсером
- **Содержит:** SKILL.md с полным описанием кодирования JSON→zstd→base64
- **Формат:** Исходный JSON (до кодирования) + процесс сжатия
- **Доступность:** ✅ Open-source — можно использовать для создания собственного парсера

### 3. **Discord серверы**
- **Официальный:** discord.gg/bKaUchYTZK
- **Community:** discord.com/invite/jujutsu-shenanigans
- **Содержит:** Коды обновлений, события, гивэвеи
- **Формат:** Текстовые коды + ссылки на коммьюнити-сборки
- **Доступность:** ✅ Частичная — требует членства на сервере, код выходят событийно

### 4. **Reddit r/JujutsuShenanigans**
- **URL:** https://reddit.com/r/JujutsuShenanigans
- **Содержит:** Посты с кодами, вики (pinned posts)
- **Формат:** Паста кодов в комментариях, ссылки на Pastebin
- **Доступность:** ⚠️ Средняя — требует ручного поиска по постам, не централизовано

### 5. **YouTube**
- **Плейлист:** https://www.youtube.com/playlist?list=PLiheD0UYIL1tBXcJa3HgSzCCCgYll_YSI (Moveset Codes JJS)
- **Каналы:** NATEZO, BAXTH, TECHYOP, RedInkJJS (упоминаются в контексте JJS)
- **Содержит:** Коды в описании видео, туториалы по импорту
- **Доступность:** ✅ Свободная — коды часто в pinned комментариях или описании

## Структура кода мувсета

```
base64_string
  ↓ [decode]
zstd-compressed
  ↓ [decompress]
JSON array (4 skill slots)
  [{
    "slot": 1,
    "name": "Skill Name",
    "DATA": "{nested JSON-string}" ← re-parse to edit
  }, ...]
```

Каждый код — **одна текстовая строка** (20–200 символов base64), содержит 4 движения + анимации + звуки + эффекты.

## Рекомендация для сбора 30+ кодов

1. **Основной сбор (80%):** jjsbuilder.com/moveset-codes/ + /builds/ — там есть готовые примеры, можно скрейпить или вручную скопировать 30 кодов за 15–20 минут.
2. **Дополнение (15%):** Discord официальный сервер + Reddit pinned — для эксклюзивных кодов событий
3. **Парсер (5%):** GitHub lilgatitodev — для автоматизации экспорта JSON из новых кодов

## Файловая структура для сохранения

```json
[
  {
    "name": "Flower Moveset",
    "source": "jjsbuilder.com",
    "code": "base64_string_here",
    "creator": "community",
    "date_found": "2026-07-17"
  }
]
```

---

**Итог:** jjsbuilder.com имеет 300+ готовых текстовых кодов; GitHub provides codec docs; Discord/Reddit/YouTube дополняют ссылками на коммьюнити-сборки. Для полной библиотеки 30–50 кодов — одного jjsbuilder достаточно.
