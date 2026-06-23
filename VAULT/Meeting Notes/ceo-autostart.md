# CEO Autostart + Last Session

## Overview
Автозапуск COLUMBUS при включении Windows и автоматическая активация CEO Agent при старте Cursor Agent-сессии. Реализовано через Cursor project hooks (`.cursor/hooks.json`) и Scheduled Task `COLUMBUS-Autostart` при logon. Hook `sessionStart` инжектит CEO AGENT.md + последний `session-*.md` из VAULT; hook `sessionEnd` пишет `.cursor/last-session.json`.

## Open Questions
- Нужен ли автозапуск отдельного Agent-чата с промптом «CEO?» или достаточно открытия workspace?
- Имя cloudflared tunnel `formula-road` — проверить что совпадает с реальным конфигом на этом ПК

## Session Log

### 2026-06-22 — CEO autostart + last session [shipped]
- **What was done:** Созданы `.cursor/hooks.json`, `ceo-session-start.js`, `ceo-session-end.js`; скрипты `scripts/columbus-autostart.ps1` и `install-columbus-autostart.ps1`; зарегистрирована задача `COLUMBUS-Autostart` при logon.
- **Decisions:** Node.js для hooks (надёжный JSON на Windows); последняя сессия = newest `VAULT/Meeting Notes/session-*.md` по имени; `last-session.json` в gitignore.
- **Notes / Caveats:** После установки hooks — перезапустить Cursor; hook срабатывает на sessionStart Agent-чата, не на каждый Tab.
- **Related:** [[ceo-agent-prd]], [[claude-md]], [[skill-obsidian-vault-workflow]]

### 2026-06-22 — Agent chat CEO? autostart on boot [shipped]
- **What was done:** Локальное расширение `tools/columbus-ceo-autostart` → `workbench.action.chat.open` с промптом `CEO?`; флаг `.cursor/ceo-boot-pending` от `columbus-autostart.ps1`; `install-columbus-ceo-extension.ps1`.
- **Decisions:** Autostart Agent только при boot-flag (не при каждом ручном открытии Cursor); delay 8s для загрузки workspace.
- **Notes / Caveats:** Нужен один раз `install-columbus-ceo-extension.ps1` + restart Cursor.
- **Related:** [[ceo-agent-prd]], [[claude-md]]
