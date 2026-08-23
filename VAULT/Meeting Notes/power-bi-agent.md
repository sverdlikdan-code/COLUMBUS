# Power BI Agent

## Обзор
Агент для аудита и улучшения Power BI отчётов COLUMBUS.
Главный файл: `INTERNATIONAL CONTROL DESK.pbix`

## Сессии

### 2026-06-01 #created
- Создан агент power-bi с AGENT.md + PRD
- Проведён полный аудит PBIX: 23 страницы, 252 меры
- Найдено 153 неиспользуемых меры (список: `C:\tmp\unused-measures.txt`)
- Создана современная тема `powerbi-theme.json` (dark slate + amber)
- Tabular Editor 3 установлен (`C:\Program Files\Tabular Editor 3`)
- DAX Studio установлен и подключён к модели
- **Ожидает:** удаление 153 мер в Tabular Editor + применение темы в PBI Desktop

### 2026-08-23 #wip
- Запрос: hands-free агент для side-проектов — сам пишет DAX-меры, связи, перепроверяет/чинит SQL, работает автономно с чекпоинтами у пользователя
- **Фундамент оказался частично фикцией** — проверил вживую (не поверил документации): `pbi-cli` не существует (нет такого пакета в PyPI), `te3` CLI не существует, Tabular Editor 3 НЕ был установлен несмотря на запись в AGENT.md/PRD от 01.06 — на машине не было вообще никакого PBI-тулинга (ни Desktop, ни TE, ни ADOMD.NET, ни dotnet)
- Исправил `power-bi-dax` SKILL.md и `power-bi/AGENT.md` — убрал фикцию, вписал реальное состояние
- **Реальные Azure-креды** — в корневом `.env`, не в `server/.env` (моя первая проверка ошибочно решила что credential "протух" — оказалось грузил не тот файл; SP реально рабочий, REST API отвечает 200)
- **Проверил capacity двух workspace через REST API:**
  - `DASHBORDS -ICE-INTER-FORMULA` (analytics-агент, FORMULA/ICE/INTER) — Pro, XMLA недоступен, только read `executeQueries`
  - `CONTROL` (содержит `INTERNATIONAL CONTROL DESK`) — **dedicated capacity**, XMLA read/write в принципе доступен
- Установил **Tabular Editor 2** (winget, бесплатный MIT, свои AMO/TOM DLL в комплекте) — реальный путь в `power-bi/AGENT.md`
- **Не сделано (нужно подтверждение пользователя):** живой XMLA write-тест на `CONTROL` — прод-отчёт с ежедневными пользователями, не стал трогать без разрешения
- Детали: memory `project_powerbi_handsfree_foundation`

## Ресурсы
- AGENT.md: `.claude/AGENTS/power-bi/AGENT.md`
- PRD: `PRD/power-bi-agent-prd.md`
- Тема: `BIZNES-AI/powerbi-theme.json`
- Неиспользуемые меры: `C:\tmp\unused-measures.txt`
