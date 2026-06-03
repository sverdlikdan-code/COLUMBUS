# Meeting Notes — Индекс

Эта папка содержит topic files для каждого кода, архитектуры и решений в проекте COLUMBUS.

## Темы

- [[skills-folder-architecture]] — Структура папки SKILLS/ и конвенция написания навыков
- [[skill-obsidian-bases]] — Навык для создания файлов Obsidian Bases (.base)
- [[skill-obsidian-markdown]] — Навык для создания Obsidian Flavored Markdown
- [[skill-obsidian-vault-workflow]] — Протокол управления vault как долгосрочной памятью
- [[claude-md]] — Файл CLAUDE.md — инструкции для Claude Code
- [[claude-settings]] — Файл .claude/settings.local.json — локальные разрешения
- [[agents-folder]] — Папка AGENTS/ — для самостоятельных агентов
- [[vault-structure]] — Структура папки VAULT/ самой себя
- [[ceo-agent-prd]] — PRD для агента-CEO — главного агента, маршрутизирующего ко всем агентам
- [[skill-nano-banana-2]] — Навык создания изображений с Google Nano Banana 2 через MCP
- [[agent-yuval]] — Агент-креатив Юваль — создание согласованных изображений с reference
- [[agent-yael]] — Агент-копирайтер Яэль — переписывание статей + интеграция изображений от Юваль
- [[agent-reuven]] — Агент-координатор Реувен — управляет полным pipeline: Хен → Яэль → Юваль → Гай → Output
- [[agent-chen]] — Агент веб-поиска Хен — находит статьи, сохраняет в Content/, документирует в Memory/
- [[agent-guy]] — QA-агент Гай — проверяет результаты, закрывает цикл, 5-й и последний агент
- [[agent-geograf]] — Агент Geograf — SQL Server маршрутизация клиентов и расчет סדר ביקור по агенту/дню
- [[skill-geograf-israel-routing]] — Навык маршрутизации визитов в Израиле с SQL, иврит-адресами и benchmark ASCOMY
- [[geograf-ops-obsidian]] — Obsidian-заметка и операционный чеклист для daily маршрутизации Geograf
- [[agent-designer]] — Агент Designer — мониторинг конкурентов и правила UI/UX стиля, кнопок и интеракций
- [[prd-status]] — Живой трекер PRD покрытия агентов системы COLUMBUS (CEO проверяет при старте)
- [[agent-mahsan]] — Агент Mahsan — планограмма холодного склада FORMULA, bay allocation, warehouse-plan.html
- [[agent-skill-creator]] — Агент Skill Creator — создание, редактирование и оптимизация SKILL.md в системе COLUMBUS
- [[agent-fin-agent]] — Агент Fin-Agent — мониторинг токенов Claude API, сравнение моделей, рекомендации по экономии
- [[session-2026-05-10]] — Сессия 2026-05-10: mahsan, skill-creator, fin-agent, CEO dispute mode, weekly market scan routine
- [[mahsan-planogram]] — MAHSAN PLANOGRAM build system + planogram-editor עמוד תוקף, per-warehouse sales/days, סכנה logic
- [[agent-bug-agent]] — Агент Bug Agent — workflow-doctor, watchdog, GitHub Actions мониторинг
- [[agent-biz-analyst]] — Агент Biz Analyst — коммерческая оценка COLUMBUS, Excel delivery docs, ROI
- [[session-2026-05-20]] — Сессия 2026-05-20: GitHub Actions fix, workflow conflict, doctor upgrade, PRD closure
- [[session-2026-05-21]] — Сессия 2026-05-21: תוקף page complete — all warehouses, drag-scroll, print/PDF fix, PDF title fix
- [[session-2026-05-24]] — Сессия 2026-05-24: watchdog fix, dagim TRN кнопка, капуа без Trnz, UI defaults
- [[session-2026-05-25]] — Сессия 2026-05-25: Formula Road RTL fix, Azure Maps, duplicate jitter, pct fix, city detection
- [[session-2026-05-26]] — Сессия 2026-05-26: daysStock через PBI measure, лейбל מכר ממוצע 45 יום
- [[agent-security-agent]] — Security Agent — аудит безопасности Formula Road PWA + API, hardening, Cloudflare WAF, session tokens
- [[session-2026-05-28]] — Сессия 2026-05-28: Formula Road полный hardening, security-agent создан
- [[session-2026-05-29]] — Сессия 2026-05-29: build-halavi-new + build-dagim-fab (Fabric), GPS inBBox fix, Azure Maps, bay шрифт, אפס מלאי grey
- [[session-2026-05-31]] — Сессия 2026-05-31: все 4 секции на KARTIS PARIT, new-product класс ★ חדש, garbled fam чистка, zero-stock hover fix
- [[session-2026-06-03]] — Сессия 2026-06-03: mahsan ФИНАЛЬНЫЙ restore (0 дублей, май-31 база), фильтр 360д откат, 1M context error диагноз
