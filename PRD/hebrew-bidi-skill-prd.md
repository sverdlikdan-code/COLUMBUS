# PRD: hebrew-bidi Skill — Hebrew BiDi/RTL Text Handling

## Роль
Единый справочник для работы с ивритским текстом в COLUMBUS: какую функцию вызвать, в каком файле она живёт, какой баг она решает.

## Проблема
В COLUMBUS иврит приходит из разных источников (Power BI, Legacy SQL, планограмма) каждый со своей кодировкой. Функции `fixBiDi`, `fixVisualRTL`, `fixHebRTL`, `fixBiDiAddress` частично дублируются (4 копии fixBiDi), применяются в неправильных контекстах, и при добавлении нового поля разработчик не знает какую именно использовать.

## Цель
Скилл отвечает на вопрос "какую BiDi-функцию вызвать для этого источника данных" за одно обращение, без чтения кода.

## Триггер
- Новое поле из Power BI показывает перевёрнутый иврит
- Добавляется страница/приложение с ивритским текстом
- Цифры в ивритских строках в неправильном порядке
- RTL layout для новой HTML страницы

## Содержание скилла

### Source → Function Map
| Источник | Проблема | Функция |
|----------|----------|---------|
| Power BI REST/DAX | LRO/RLO Unicode marks | `fixBiDi(raw)` |
| Legacy SQL планограмма | Байты в визуальном порядке | `fixVisualRTL(s)` |
| Семейства планограммы | Иврит + коды продуктов | `fixHebRTL(s)` |
| Адреса клиентов (PBI) | LR-Override marks | `fixBiDiAddress(str)` |
| Браузер / HTML | RTL+LTR mixing | `_ltrWrap(s)` + `dir` |

### Расположение функций (2026-07-05)
- `fixBiDi` — `server/index.js`, `server/build-mmd-orders.js`, `server/export-formiice-comparison.js`, `server/export-gps-report.js`
- `fixVisualRTL` — `planogram/build-planogram.js`, `planogram/build-dagim-yavesh-base.js`, `planogram/pbi-extra-sheets.js`
- `fixHebRTL` — `planogram/build-kapua-new.js` + 4 других скрипта планограммы
- `fixBiDiAddress` — `server/index.js:655`
- `_ltrWrap` — `MMD ORDERS/index.html`, `docs/mmd-orders.html`

## Ключевые правила
1. fixBiDi существует в 4 копиях — при изменении обновить все 4
2. fixBiDi из export-gps-report.js — упрощённая версия (нет fix цифр)
3. HTML-страницы: всегда `<html dir="rtl" lang="he">`
4. Баг 0021→1200 (цифры переворачиваются): re-reverse digit runs после char reversal
5. Future target: консолидировать в `server/utils/bidi.js`

## Статус
- SKILL.md создан: 2026-07-05
- PRD создан: 2026-07-28
- Vault note: skill-hebrew-bidi.md
