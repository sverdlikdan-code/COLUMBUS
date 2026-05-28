const ExcelJS = require('exceljs');
const path = require('path');

const wb = new ExcelJS.Workbook();
wb.creator = 'COLUMBUS Agent';
wb.created = new Date();

const BLUE = '1A3F7C'; const GOLD = 'C9A84C';
const GREEN_BG = 'D4EDDA'; const GREEN_FG = '155724';
const RED_BG = 'F8D7DA'; const RED_FG = '721C24';
const YELLOW_BG = 'FFF3CD'; const YELLOW_FG = '856404';
const LIGHT_BG = 'EBF2FC'; const WHITE = 'FFFFFF';

function headerStyle(ws, row) {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BLUE } };
    cell.font = { bold: true, color: { argb: 'FF' + WHITE }, size: 11, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF' + GOLD } } };
  });
  row.height = 28;
}

function stripeBg(i) { return i % 2 === 0 ? LIGHT_BG : 'FFFFFF'; }

function statusStyle(val) {
  if (val && val.startsWith('✅')) return { bg: GREEN_BG, color: GREEN_FG, bold: true };
  if (val && val.startsWith('⚠')) return { bg: RED_BG, color: RED_FG };
  if (val && val.startsWith('⏸')) return { bg: YELLOW_BG, color: YELLOW_FG };
  return {};
}

function addBorders(row) {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D9E8' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D9E8' } },
      left: { style: 'thin', color: { argb: 'FFD0D9E8' } },
      right: { style: 'thin', color: { argb: 'FFD0D9E8' } },
    };
  });
}

// ─── SHEET 1: ОБЗОР ПРОЕКТА ───────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Обзор проекта');
  ws.columns = [{ key: 'a', width: 36 }, { key: 'b', width: 70 }];

  ws.mergeCells('A1:B1');
  const t = ws.getCell('A1');
  t.value = 'MAHSAN FORMULA — Планограмма склада. Сдача проекта';
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BLUE } };
  t.font = { bold: true, size: 15, color: { argb: 'FF' + WHITE }, name: 'Calibri' };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 40;

  const items = [
    { label: 'Название проекта', value: 'MAHSAN FORMULA — Визуальная планограмма холодного склада' },
    { label: 'Заказчик', value: 'FORMULA / DILER BMD — складской отдел' },
    { label: 'Разработчик', value: 'COLUMBUS Agent System' },
    { label: 'Дата завершения', value: '27.05.2026' },
    { label: 'Статус', value: '✅ Сдан в эксплуатацию', status: true },
    { label: '' },
    { label: 'URL планограммы', value: 'https://sverdlikdan-code.github.io/COLUMBUS/planogram-editor.html', link: true },
    { label: '' },
    { label: 'Охват', value: '4 секции: קפוא ❄️ (заморозка) · חלבי 🥛 (молочка) · דגים 🐟 (рыба) · דג יבש 🧂 (сухая рыба)' },
    { label: 'Склады', value: 'אשדוד (Main) + צפון (Zafn) — переключение в интерфейсе' },
    { label: 'Платформа', value: 'Web — GitHub Pages. Открывается на любом устройстве без установки' },
    { label: '' },
    { label: 'Ключевой результат 1', value: 'Визуальная схема расстановки товаров по bay-ам с фотографиями SKU', gold: true },
    { label: 'Ключевой результат 2', value: 'Отчёт о сроках годности (תוקף) — фильтр по опасным позициям', gold: true },
    { label: 'Ключевой результат 3', value: 'Редактирование порядка SKU drag & drop + история версий с восстановлением', gold: true },
  ];

  items.forEach(s => {
    const row = ws.addRow([s.label, s.value || '']);
    row.height = 22;
    const a = row.getCell(1); const b = row.getCell(2);
    a.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    a.alignment = { wrapText: true, vertical: 'middle' };
    if (!s.label) { row.height = 8; return; }
    if (s.status) {
      b.value = s.value; b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + GREEN_BG } };
      b.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + GREEN_FG } };
    } else if (s.link) {
      b.value = { text: s.value, hyperlink: s.value };
      b.font = { size: 11, name: 'Calibri', color: { argb: 'FF0563C1' }, underline: true };
      b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
    } else if (s.gold) {
      b.value = s.value;
      b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + YELLOW_BG } };
      b.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    } else {
      b.value = s.value || ''; b.font = { size: 11, name: 'Calibri' };
    }
    b.alignment = { wrapText: true, vertical: 'middle' };
    addBorders(row);
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

// ─── SHEET 2: ЧТО СДАНО ──────────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Что сдано');
  ws.columns = [
    { key: 'num', width: 5 }, { key: 'func', width: 30 },
    { key: 'desc', width: 62 }, { key: 'status', width: 16 }, { key: 'prio', width: 12 },
  ];
  const hRow = ws.addRow(['#', 'Функция', 'Описание', 'Статус', 'Приоритет']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'E1' };

  const rows = [
    ['1', 'Визуальная планограмма (4 секции)', 'Интерактивная схема склада: קפוא ❄️, חלבי 🥛, דגים 🐟, דג יבש 🧂. Каждый bay — слот с фото SKU, количеством, наименованием.', '✅ Готово', 'Высокий'],
    ['2', 'Поддержка двух складов', 'Переключение между אשדוד (Main) и צפון (Zafn). Данные по каждому складу раздельно.', '✅ Готово', 'Высокий'],
    ['3', 'Фотографии SKU в bay-ах', 'Каждый слот отображает фото продукта. Фото загружены из базы FORMULA.', '✅ Готово', 'Высокий'],
    ['4', 'Режим редактирования (✏ עריכה)', 'Переключение в режим редактирования. Drag & drop для перестановки SKU между позициями.', '✅ Готово', 'Высокий'],
    ['5', 'Сохранение версии (💾 שמור)', 'Сохранение текущего состояния планограммы с меткой времени. Неограниченное количество версий.', '✅ Готово', 'Высокий'],
    ['6', 'История версий (🕐 היסטוריה)', 'Просмотр всех сохранённых версий по секции. Восстановление любой предыдущей версии в один клик.', '✅ Готово', 'Высокий'],
    ['7', 'Отчёт о сроках годности (📦 תוקף)', 'Сводный отчёт по партиям: тоקף/כמות/сканирование. Фильтр по секции, "⚠ Только опасные", "צפון <3 дней". Средние продажи per SKU.', '✅ Готово', 'Высокий'],
    ['8', 'Таблица позиций (📊 מיקום)', 'Список всех SKU с позициями в планограмме. Возможность изменить порядок печати.', '✅ Готово', 'Средний'],
    ['9', 'Экспорт CSV (⬇ CSV)', 'Выгрузка текущей планограммы секции в CSV файл для передачи или архивирования.', '✅ Готово', 'Средний'],
    ['10', 'Режим "Plan Only"', 'Скрытие резервных слотов — отображение только плановых позиций.', '✅ Готово', 'Средний'],
    ['11', 'Масштаб + полный экран', 'Кнопки +/- для zoom, кнопка "Fit to screen" (⊡), полный экран (⛶).', '✅ Готово', 'Средний'],
    ['12', 'Сброс секции (↩ אפס)', 'Возврат секции к последнему сохранённому состоянию.', '✅ Готово', 'Средний'],
    ['13', 'Печать планограммы (PDF)', 'Генерация PDF из текущего вида. Landscape, без интерфейсных элементов.', '✅ Готово', 'Средний'],
    ['14', 'Auto-build из Excel + Power BI', 'build-planogram.js (1040 строк) собирает planogram из קפוא.xlsx, חלבי.xlsx, דגים.xlsx + данные продаж из Power BI (pbi-kapua.js).', '✅ Готово', 'Высокий'],
    ['15', 'GitHub Actions CI/CD', 'Автоматическая пересборка и деплой при git push. product-data.json обновляется автоматически.', '✅ Готово', 'Высокий'],
    ['16', 'Порядок семейств קפוא (утверждён)', 'חמאה FERMA → חמאה רושן → ממרחי → כיסונים → SANTA BREMOR main → עוגות רושן → עוגות מוזיקה → חטיף גבינה → SANTA BREMOR דגים → VALESTA → מוסדי', '✅ Готово', 'Высокий'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 42;
    const bg = stripeBg(i);
    row.eachCell((cell, cn) => {
      cell.font = { size: 11, name: 'Calibri' };
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: cn === 1 || cn === 4 || cn === 5 ? 'center' : 'left' };
    });
    const st = statusStyle(r[3]);
    if (st.bg) {
      const sc = row.getCell(4);
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + st.bg } };
      sc.font = { bold: st.bold, size: 11, name: 'Calibri', color: { argb: 'FF' + st.color } };
    }
    const pc = row.getCell(5);
    if (r[4] === 'Высокий') {
      pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + RED_BG } };
      pc.font = { size: 11, name: 'Calibri', color: { argb: 'FF' + RED_FG } };
    } else {
      pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + YELLOW_BG } };
      pc.font = { size: 11, name: 'Calibri', color: { argb: 'FF' + YELLOW_FG } };
    }
    [1, 2, 3].forEach(cn => {
      const c = row.getCell(cn);
      if (!c.fill || !c.fill.fgColor) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
    });
    addBorders(row);
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

// ─── SHEET 3: ПРОБЛЕМЫ → РЕШЕНИЯ ─────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Проблемы → Решения');
  ws.columns = [
    { key: 'num', width: 5 }, { key: 'prob', width: 42 },
    { key: 'sol', width: 52 }, { key: 'tech', width: 30 },
  ];
  const hRow = ws.addRow(['#', 'Проблема (ДО)', 'Решение (ПОСЛЕ)', 'Инструмент / Технология']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'D1' };

  const rows = [
    ['1', 'Планограмма существовала только в Excel (MAHSAN 8.xlsx). Трудно читать, нет фотографий, нет фильтров по складу', 'Интерактивная web-планограмма с фотографиями SKU по каждому bay. 4 секции, 2 склада. Открывается в браузере без установки.', 'HTML + JS, GitHub Pages, product-data.json'],
    ['2', 'Нет контроля сроков годности — менеджер обходил физически весь склад чтобы проверить партии', 'Отчёт תוקף: все партии по секциям с датами, цветовые индикаторы опасности, фильтр "только ⚠ опасные" и "צפון <3 дней"', 'product-data.json → pakuot/pakuotZafn, buildExpiryPage()'],
    ['3', 'Порядок расстановки SKU нигде не закреплён — разные люди расставляли по-разному', 'Утверждённый порядок семейств (16 позиций) зафиксирован в build-скрипте. Автоматически применяется при каждой пересборке.', 'build-planogram.js, FAMILY_ORDER константа'],
    ['4', 'Нет возможности сохранить изменения в расстановке без пересборки всей планограммы', 'Режим редактирования: drag & drop + кнопка שמור. История версий с возможностью восстановления. Данные в localStorage браузера.', 'SortableJS, localStorage, version history'],
    ['5', 'Данные о продажах не были видны рядом с планограммой', 'В каждом слоте bay отображается ממוצע מכירה (средние продажи за 45 дней). В отчёте תוקף — сколько дней товара осталось.', 'pbi-kapua.js → Power BI API, product-data.json'],
    ['6', 'Пересборка планограммы требовала ручного запуска скрипта и знания Node.js', 'GitHub Actions: при git push — автоматическая пересборка и деплой за ~60 секунд. Пользователь не участвует.', 'GitHub Actions, build-planogram.js, Node.js 20'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 56;
    row.getCell(1).font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + RED_BG } };
    row.getCell(2).font = { size: 11, name: 'Calibri', color: { argb: 'FF' + RED_FG } };
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + GREEN_BG } };
    row.getCell(3).font = { size: 11, name: 'Calibri', color: { argb: 'FF' + GREEN_FG } };
    row.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
    row.getCell(4).font = { size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    row.getCell(4).alignment = { wrapText: true, vertical: 'middle' };
    addBorders(row);
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

// ─── SHEET 4: АРХИТЕКТУРА ─────────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Архитектура');
  ws.columns = [
    { key: 'comp', width: 24 }, { key: 'tech', width: 28 },
    { key: 'loc', width: 46 }, { key: 'desc', width: 50 },
  ];
  const hRow = ws.addRow(['Компонент', 'Технология', 'Расположение / Файл', 'Описание']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'D1' };

  const rows = [
    ['Web-интерфейс', 'HTML + CSS + Vanilla JS', 'docs/planogram-editor.html → GitHub Pages', 'Планограмма, табы, режим редактирования, отчёт תוקף, экспорт, история'],
    ['Данные планограммы', 'JSON (auto-generated)', 'docs/product-data.json', 'Все SKU, bay-позиции, фото, продажи, партии תוקף. Генерируется build-планограм.js'],
    ['Build-скрипт', 'Node.js (1040 строк)', 'PLANOGRAM MAHSAN FORMULA/build-planogram.js', 'Читает Excel-файлы + Power BI, собирает product-data.json. Порядок семейств жёстко закреплён.'],
    ['Power BI интеграция', 'Node.js + PBI REST API', 'PLANOGRAM MAHSAN FORMULA/pbi-kapua.js', 'Загружает данные продаж (ממוצע מכירה 45 дней) и партии תוקף из Power BI Fabric.'],
    ['Источники данных', 'Excel (ежедневно)', 'קפוא.xlsx · חלבי.xlsx · דגים.xlsx · FORMULA PALLETS.xlsx', 'קפוא/חלבי/דגים — ежедневные. FORMULA PALLETS + MAHSAN 8 — статичные шаблоны.'],
    ['Хостинг', 'GitHub Pages', 'sverdlikdan-code.github.io/COLUMBUS/planogram-editor.html', 'Бесплатный хостинг, SSL автоматически. Деплой при git push.'],
    ['CI/CD', 'GitHub Actions', '.github/workflows/build-planogram.yml', 'Триггер: push в master → build-planogram.js → product-data.json в docs/.'],
    ['Хранение состояния', 'localStorage браузера', 'Ключ: mahsan_planogram_state_[секция]', 'Сохранение версий редактирования. Хранится локально в браузере пользователя.'],
    ['Фотографии SKU', 'PNG/JPG', 'docs/product-images/ (или FORMULA photo base)', 'Фото загружены один раз. Ссылки в product-data.json.'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 40;
    const bg = stripeBg(i);
    row.getCell(1).font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFD6E4F7' : 'FFE8F0FB' } };
    row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    [2, 3, 4].forEach(cn => {
      row.getCell(cn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
      row.getCell(cn).font = { size: 11, name: 'Calibri' };
      row.getCell(cn).alignment = { wrapText: true, vertical: 'middle' };
    });
    addBorders(row);
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

// ─── SHEET 5: ССЫЛКИ ─────────────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Ссылки');
  ws.columns = [{ key: 'res', width: 32 }, { key: 'url', width: 72 }, { key: 'who', width: 30 }];
  const hRow = ws.addRow(['Ресурс', 'URL / Путь', 'Для кого']);
  headerStyle(ws, hRow);

  const rows = [
    ['Планограмма MAHSAN (web)', 'https://sverdlikdan-code.github.io/COLUMBUS/planogram-editor.html', 'Менеджеры склада, руководство'],
    ['GitHub репозиторий', 'https://github.com/sverdlikdan-code/COLUMBUS', 'Разработчики'],
    ['GitHub Actions', 'https://github.com/sverdlikdan-code/COLUMBUS/actions', 'Мониторинг деплоев'],
    ['', '', ''],
    ['Исходные данные קפוא', 'PLANOGRAM MAHSAN FORMULA\\קפוא.xlsx', 'Ежедневно — оператор склада'],
    ['Исходные данные חלבי', 'PLANOGRAM MAHSAN FORMULA\\MAHSAN חלבי\\חלבי.xlsx', 'Ежедневно — оператор склада'],
    ['Исходные данные דגים', 'PLANOGRAM MAHSAN FORMULA\\MAHSAN דגים\\דגים.xlsx', 'Ежедневно — оператор склада'],
    ['Шаблон склада', 'PLANOGRAM MAHSAN FORMULA\\MAHSAN 8.xlsx', 'Статичный — менять редко'],
    ['Кратность паллет', 'PLANOGRAM MAHSAN FORMULA\\FORMULA PALLETS.xlsx', 'Статичный — менять редко'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 24;
    if (!r[0]) { row.height = 8; return; }
    row.getCell(1).font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
    const urlVal = r[1];
    if (urlVal && urlVal.startsWith('http')) {
      row.getCell(2).value = { text: urlVal, hyperlink: urlVal };
      row.getCell(2).font = { size: 11, name: 'Calibri', color: { argb: 'FF0563C1' }, underline: true };
    } else {
      row.getCell(2).value = urlVal;
      row.getCell(2).font = { size: 11, name: 'Calibri', color: { argb: 'FF555555' } };
    }
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(3).font = { size: 11, name: 'Calibri', color: { argb: 'FF555555' } };
    row.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    addBorders(row);
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

// ─── SHEET 6: ОТКРЫТЫЕ ВОПРОСЫ ───────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Открытые вопросы');
  ws.columns = [
    { key: 'num', width: 5 }, { key: 'topic', width: 32 },
    { key: 'status', width: 18 }, { key: 'comment', width: 62 }, { key: 'date', width: 14 },
  ];
  const hRow = ws.addRow(['#', 'Тема', 'Статус', 'Решение / Комментарий', 'Дата']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'E1' };

  const rows = [
    ['1', 'daySales фильтр по מחסן=Main', '⚠ Известный баг', 'Query 2 в pbi-kapua.js не фильтрует по מחסן=Main — содержит продажи всех складов. ממוצע מכירה может быть завышен для Main. Нужно уточнить DAX-меру или добавить фильтр.', '27.05.2026'],
    ['2', 'Хранение версий в localStorage', '⚠ Ограничение', 'История версий хранится в браузере. При очистке кеша или смене устройства — история теряется. Рекомендуется добавить сохранение на сервер.', '27.05.2026'],
    ['3', 'Авторизация', '✅ Не требуется', 'Планограмма не содержит коммерчески чувствительных данных. Открытый доступ — норма для складских схем.', '27.05.2026'],
    ['4', 'Переход на SQL-коннект вместо Excel', '⏸ Будущее', 'Три ежедневных Excel-файла (קפוא/חלבי/דגים) — кандидаты на замену прямым SQL-запросом к FORMULA. PALLETS и MAHSAN 8 — оставить файлами.', '27.05.2026'],
    ['5', 'Мобильная версия', '⚠ Частично', 'Приложение открывается на мобильных, но планограмма требует горизонтального скролла. Для полного мобильного UX нужна адаптация.', '27.05.2026'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 52;
    const bg = stripeBg(i);
    row.getCell(1).font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).font = { bold: true, size: 11, name: 'Calibri' };
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
    const st = statusStyle(r[2]);
    if (st.bg) {
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + st.bg } };
      row.getCell(3).font = { bold: st.bold, size: 11, name: 'Calibri', color: { argb: 'FF' + st.color } };
    }
    row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.getCell(4).font = { size: 11, name: 'Calibri' };
    row.getCell(4).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
    row.getCell(5).font = { size: 11, name: 'Calibri', color: { argb: 'FF888888' } };
    row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
    addBorders(row);
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

const outPath = path.join(__dirname, '..', 'COLUMBUS — MAHSAN Сдача проекта.xlsx');
wb.xlsx.writeFile(outPath).then(() => console.log('✅', outPath));
