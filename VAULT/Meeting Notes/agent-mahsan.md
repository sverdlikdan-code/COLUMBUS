# agent-mahsan — Агент планограммы склада FORMULA

## Роль
Mahsan строит и обновляет планограммы для холодного склада FORMULA.  
Управляет расстановкой SKU, конфигурацией комнат и визуальными схемами.

## Статус
#active — Room 1 קפוא ❄ завершена (v1). Rooms 2 и 3 в очереди.

## Связанные файлы
- AGENT.md: `.claude/AGENTS/mahsan/AGENT.md`
- SKILL: `.claude/SKILLS/warehouse-floor-plan/SKILL.md`
- Скрипт: `PLANOGRAM MAHSAN FORMULA/planogram-gen.js`
- Визуал: `PLANOGRAM MAHSAN FORMULA/warehouse-plan.html`
- Output: `PLANOGRAM MAHSAN FORMULA/planogram-kapua.xlsx`

## Логика распределения позиций
```
bays = ceil(dailySales / kratnost)   // мин. 1
```
Kratnost с коррекцией: חטיף גבינה = 81×12=972, ידסומי = 70×7=490, остальные — raw из FORMULA PALLETS.xlsx.

## Маршрут сборки (Room 1)
E → D → C → B → A (от дока вглубь). Серпантин.  
Самые частые семьи (по dailyClients/יום) — ближайшие к доку.

## Зарезервировано
- 8 bay в конце Row A → **VALESTA** (новый товар)
- 20 bay пустых → резерв

## Семьи по порядку от дока
1. כיסונים/סריקי (213 клиентов/день)
2. חטיף גבינה (187)
3. עוגות רושן (52) — 1 позиция каждый, нет kratnost
4. SANTA BREMOR (52)
5. עוגות מוזיקה (23)
6. ידסומי (3)
7. VALESTA — резерв

---

## Сессии

### 2026-05-10 #done
Создан агент mahsan:
- AGENT.md написан с полной логикой kratnost, workflow, антипаттернами
- SKILL.md warehouse-floor-plan создан
- warehouse-plan.html — интерактивный браузерный редактор схемы склада (RTL, SVG, печать/экспорт)
- planogram-gen.js обновлён: новая логика allocatePositions (ceil dailySales/kratnost), VALESTA reserve 8 bay, маршрут исправлен E→A (dock-first)
- CLAUDE.md обновлён — mahsan добавлен в активные агенты

### 2026-05-07 #done
Room 1 קפוא ❄ — первая версия планограммы:
- 62 bay, 34 SKU + VALESTA
- Сортировка по familyClients DESC, weight DESC внутри семьи
- Kratnost: исправлены חטיף גבינה (×12) и ידסומי (×7)
- Visual map (3 листа Excel): полная таблица + сводка + карта с рядами
