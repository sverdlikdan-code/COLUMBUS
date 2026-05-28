const ExcelJS = require('exceljs');
const path = require('path');

const wb = new ExcelJS.Workbook();
wb.creator = 'COLUMBUS Agent';
wb.created = new Date();

// ─── STYLES ──────────────────────────────────────────────────────────────────
const BLUE = '1A3F7C';
const GOLD = 'C9A84C';
const GREEN_BG = 'D4EDDA'; const GREEN_FG = '155724';
const RED_BG = 'F8D7DA'; const RED_FG = '721C24';
const YELLOW_BG = 'FFF3CD'; const YELLOW_FG = '856404';
const LIGHT_BG = 'EBF2FC';
const WHITE = 'FFFFFF';

function headerStyle(ws, row) {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BLUE } };
    cell.font = { bold: true, color: { argb: 'FF' + WHITE }, size: 11, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF' + GOLD } }
    };
  });
  row.height = 28;
}

function dataCell(cell, text, opts = {}) {
  cell.value = text;
  cell.alignment = { wrapText: true, vertical: 'middle', horizontal: opts.center ? 'center' : 'left' };
  cell.font = { size: 11, name: 'Calibri', bold: opts.bold || false, color: { argb: 'FF' + (opts.color || '1A1A1A') } };
  if (opts.bg) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + opts.bg } };
  }
  if (opts.link) {
    cell.value = { text, hyperlink: text };
    cell.font = { ...cell.font, color: { argb: 'FF0563C1' }, underline: true };
  }
}

function stripeBg(rowIdx) {
  return rowIdx % 2 === 0 ? LIGHT_BG : 'FFFFFF';
}

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
  ws.columns = [
    { key: 'a', width: 36 },
    { key: 'b', width: 70 },
  ];

  // Title row
  ws.mergeCells('A1:B1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'Formula Road — Сдача проекта';
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BLUE } };
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF' + WHITE }, name: 'Calibri' };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 40;

  const sections = [
    { label: 'Название проекта', value: 'Formula Road — Маршруты визитов DILER BMD' },
    { label: 'Заказчик', value: 'DILER BMD — отдел продаж (BMD)' },
    { label: 'Разработчик', value: 'COLUMBUS Agent System' },
    { label: 'Дата завершения', value: '27.05.2026' },
    { label: 'Статус', value: '✅ Сдан в эксплуатацию', status: true },
    { label: '' },
    { label: 'URL приложения', value: 'https://sverdlikdan-code.github.io/COLUMBUS/formula-road.html', link: true },
    { label: 'URL туториала', value: 'https://sverdlikdan-code.github.io/COLUMBUS/TUTORIALS/index.html', link: true },
    { label: 'URL презентации', value: 'https://sverdlikdan-code.github.io/COLUMBUS/TUTORIALS/presentation.html', link: true },
    { label: '' },
    { label: 'Целевые пользователи', value: 'Менеджеры по продажам (линейные руководители)' },
    { label: 'Язык интерфейса', value: 'Иврит (основной) + русский. RTL/LTR переключение' },
    { label: 'Платформа', value: 'Web PWA — работает на любом устройстве без установки' },
    { label: '' },
    { label: 'Ключевой результат 1', value: 'Экономия часов работы на управление маршрутами и изменениями', gold: true },
    { label: 'Ключевой результат 2', value: '1 клик для экспорта маршрута в CSV/Excel', gold: true },
    { label: 'Ключевой результат 3', value: '~18% экономия пробега (среднее значение алгоритма оптимизации)', gold: true },
  ];

  sections.forEach((s, i) => {
    const row = ws.addRow([s.label, s.value || '']);
    row.height = 22;
    const cellA = row.getCell(1);
    const cellB = row.getCell(2);
    cellA.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    cellA.alignment = { wrapText: true, vertical: 'middle' };

    if (!s.label) { row.height = 8; return; }

    if (s.status) {
      cellB.value = s.value;
      cellB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + GREEN_BG } };
      cellB.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + GREEN_FG } };
      cellB.alignment = { wrapText: true, vertical: 'middle' };
    } else if (s.link) {
      cellB.value = { text: s.value, hyperlink: s.value };
      cellB.font = { size: 11, name: 'Calibri', color: { argb: 'FF0563C1' }, underline: true };
      cellB.alignment = { wrapText: true, vertical: 'middle' };
      cellB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
    } else if (s.gold) {
      cellB.value = s.value;
      cellB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      cellB.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
      cellB.alignment = { wrapText: true, vertical: 'middle' };
    } else {
      cellB.value = s.value || '';
      cellB.font = { size: 11, name: 'Calibri' };
      cellB.alignment = { wrapText: true, vertical: 'middle' };
    }
    addBorders(row);
  });

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

// ─── SHEET 2: ЧТО СДАНО ──────────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Что сдано');
  ws.columns = [
    { key: 'num', width: 5 },
    { key: 'func', width: 30 },
    { key: 'desc', width: 62 },
    { key: 'status', width: 18 },
    { key: 'prio', width: 12 },
  ];

  const hRow = ws.addRow(['#', 'Функция', 'Описание', 'Статус', 'Приоритет']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'E1' };

  const rows = [
    ['1', 'Просмотр маршрутов по дням', 'Фильтр по агенту и дню недели. Отображение клиентов на карте Azure Maps с маркерами и линиями маршрута.', '✅ Готово', 'Высокий'],
    ['2', 'Фильтр по городу', 'Быстрые чипы-кнопки для фильтрации клиентов по городу внутри маршрута.', '✅ Готово', 'Высокий'],
    ['3', 'Карточки клиентов', 'Полная карточка: имя, адрес, город, ежемесячные продажи, план, % выполнения, дата последнего заказа, GPS.', '✅ Готово', 'Высокий'],
    ['4', 'AI-сортировка (מיון ביקור)', 'Алгоритм оптимизации порядка визитов с минимизацией пробега. Кнопка возврата к оригинальному порядку.', '✅ Готово', 'Высокий'],
    ['5', 'Ручное перетаскивание', 'Drag & drop карточек клиентов для изменения порядка визитов. Иконка ≡ — зажать и тянуть. КМ пересчитывается.', '✅ Готово', 'Высокий'],
    ['6', 'GPS-коррекция координат', 'Кнопка GPS на карточке. Открывает Google Maps — пользователь находит точное место и сохраняет координаты в БД.', '✅ Готово', 'Высокий'],
    ['7', 'Экспорт CSV/Excel', 'Кнопка "XL שמור". Экспортирует: порядок визита, № клиента, имя, день, город, адрес, GPS. Имя файла с датой автоматически.', '✅ Готово', 'Высокий'],
    ['8', 'Ежемесячные продажи + % цели', 'На каждой карточке: план, факт, % выполнения, дата последнего заказа — данные из SQL Server.', '✅ Готово', 'Средний'],
    ['9', 'Расчёт километража', 'Автоматический подсчёт суммарного пробега. Обновляется при AI-сортировке и ручном перетаскивании.', '✅ Готово', 'Средний'],
    ['10', 'Туториал (11 шагов)', 'Пошаговый визуальный туториал со скриншотами. Двуязычный ивр/рус. Языковой селектор на старте.', '✅ Готово', 'Средний'],
    ['11', 'Презентация проекта', 'Одностраничная HTML-презентация (6 слайдов). Двуязычная ивр/рус. Для передачи руководству.', '✅ Готово', 'Средний'],
    ['12', 'PWA (Progressive Web App)', 'Устанавливается на телефон/рабочий стол как нативное приложение. manifest.json + иконки. Без App Store.', '✅ Готово', 'Средний'],
    ['13', 'Auto-build GitHub Actions', 'При каждом git push — автоматическая пересборка и деплой на GitHub Pages.', '✅ Готово', 'Высокий'],
    ['14', 'Cloudflare Tunnel', 'Туннель для доступа к данным из SQL Server через публичный HTTPS URL. Автозапуск при старте Windows.', '✅ Готово', 'Высокий'],
    ['15', 'APK / Android App', 'Нативное Android-приложение — решено не делать. PWA покрывает все потребности без сложностей сборки.', '⏸ Отложено', 'Низкий'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 38;
    const bg = stripeBg(i);
    row.eachCell((cell, colNum) => {
      cell.font = { size: 11, name: 'Calibri' };
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: colNum === 1 || colNum === 4 || colNum === 5 ? 'center' : 'left' };
    });
    // Status cell
    const st = statusStyle(r[3]);
    if (st.bg) {
      const sc = row.getCell(4);
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + st.bg } };
      sc.font = { bold: st.bold || false, size: 11, name: 'Calibri', color: { argb: 'FF' + st.color } };
    }
    // Priority cell
    const prio = r[4];
    const pc = row.getCell(5);
    if (prio === 'Высокий') {
      pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + RED_BG } };
      pc.font = { size: 11, name: 'Calibri', color: { argb: 'FF' + RED_FG } };
    } else if (prio === 'Средний') {
      pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + YELLOW_BG } };
      pc.font = { size: 11, name: 'Calibri', color: { argb: 'FF' + YELLOW_FG } };
    } else {
      pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
    }
    // Stripe bg for data columns
    [1, 2, 3].forEach(cn => {
      const c = row.getCell(cn);
      if (!c.fill || c.fill.pattern !== 'solid' || !c.fill.fgColor) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
      }
    });
    addBorders(row);
  });

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

// ─── SHEET 3: ПРОБЛЕМЫ → РЕШЕНИЯ ─────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Проблемы → Решения');
  ws.columns = [
    { key: 'num', width: 5 },
    { key: 'prob', width: 40 },
    { key: 'sol', width: 52 },
    { key: 'tech', width: 32 },
  ];

  const hRow = ws.addRow(['#', 'Проблема (ДО)', 'Решение (ПОСЛЕ)', 'Инструмент / Технология']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'D1' };

  const rows = [
    ['1', 'Администрирование маршрутов требовало часы работы', 'Web-приложение Formula Road: автоматический вывод маршрута по агенту/дню, карта с маркерами, порядок визитов.', 'Azure Maps API, SQL Server, GitHub Pages'],
    ['2', 'GPS-координаты клиентов были неточными или отсутствовали — маркеры на карте отображались неверно', 'Кнопка GPS-коррекции на каждой карточке. Менеджер открывает Google Maps, находит точное место, сохраняет в БД одним нажатием.', 'Google Maps Intent, REST API PUT /api/clients/gps'],
    ['3', 'Порядок визитов не был оптимизирован — агенты ездили неэффективными маршрутами', 'AI-сортировка (מיון ביקור) — алгоритм минимизации пробега. Одна кнопка — маршрут перестраивается. Есть кнопка возврата к оригиналу.', 'Nearest-neighbor + 2-opt алгоритм, JS'],
    ['4', 'Нет возможности быстро получить маршрут в виде файла для передачи агенту или архивирования', 'Кнопка "XL שמור" — одним кликом выгружает CSV с порядком визита, клиентами, адресами, GPS. Имя файла автоматическое с датой.', 'xlsx.js, FileSaver, Blob API'],
    ['5', 'Данные о продажах и выполнении плана были отдельно от маршрута — менеджер переключался между системами', 'Карточка каждого клиента показывает: план, факт, % выполнения, дату последнего заказа — прямо в маршруте.', 'SQL Server VIEW, REST API'],
    ['6', 'Приложение требовало ручного запуска сервера каждый раз при перезагрузке компьютера', 'Автозапуск: ярлык FormulaRoadTunnel.lnk в Windows Startup → bat-файл запускает Node.js сервер + cloudflared туннель.', 'Windows Startup, .bat, cloudflared'],
    ['7', 'Пользователи не знали как пользоваться функциями (экспорт, перетаскивание, GPS)', 'Полный пошаговый туториал (11 шагов) со скриншотами реального приложения. Двуязычный ивр/рус.', 'HTML, CSS, scroll-snap'],
    ['8', 'Нет материала для презентации функций руководству', 'Одностраничная HTML-презентация (6 слайдов): что это, как работает, KPI, результаты. Двуязычная ивр/рус.', 'HTML, CSS scroll-snap, Heebo font'],
    ['9', 'Деплой требовал ручной пересборки и загрузки файлов', 'GitHub Actions: при каждом git push — автоматический build и деплой на GitHub Pages.', 'GitHub Actions, Node.js build script'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 52;
    const bg = stripeBg(i);
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
    { key: 'comp', width: 24 },
    { key: 'tech', width: 28 },
    { key: 'loc', width: 44 },
    { key: 'desc', width: 50 },
  ];

  const hRow = ws.addRow(['Компонент', 'Технология', 'Расположение / URL', 'Описание']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'D1' };

  const rows = [
    ['Frontend (UI)', 'HTML + CSS + Vanilla JS', 'docs/formula-road.html → GitHub Pages', 'Одностраничное приложение. Azure Maps, карточки клиентов, фильтры, экспорт.'],
    ['Хостинг', 'GitHub Pages', 'sverdlikdan-code.github.io/COLUMBUS/', 'Бесплатный статический хостинг. SSL автоматически. Деплой при git push.'],
    ['CI/CD', 'GitHub Actions', '.github/workflows/build-formula-road.yml', 'Workflow: build-formula-road.js → formula-road.html в docs/. Триггер: push в master.'],
    ['Туннель', 'Cloudflare Tunnel', 'Имя туннеля: formula-road', 'Открывает публичный HTTPS URL для локального Node.js сервера на port 3000.'],
    ['Локальный сервер', 'Node.js + Express', 'server/index.js (port 3000)', 'REST API: GET /api/agents, /api/clients, PUT /api/clients/gps, /api/route-order.'],
    ['База данных', 'SQL Server (MSSQL)', 'Локально на машине пользователя', 'Таблицы: agents, clients, visit_routes. Подключение через mssql npm.'],
    ['Автозапуск', 'Windows Startup + .bat', 'C:\\Users\\d.sverdlik\\Desktop\\start-tunnel.bat', 'Запускает node index.js + cloudflared. Ярлык в папке Startup Windows.'],
    ['Карты', 'Azure Maps', 'API ключ в конфиге приложения', 'Тайлы карты, маркеры, линии маршрута, всплывающие окна.'],
    ['PWA', 'Web App Manifest', 'docs/manifest.json', 'Иконка, название, display:standalone. Установка как нативное приложение.'],
    ['Туториал', 'HTML (scroll)', 'docs/TUTORIALS/index.html', '11 шагов, скриншоты в docs/TUTORIALS/, двуязычный ивр/рус.'],
    ['Презентация', 'HTML (scroll-snap)', 'docs/TUTORIALS/presentation.html', '6 слайдов, двуязычная ивр/рус, для передачи руководству.'],
    ['Build-скрипт', 'Node.js', 'scripts/build-formula-road.js', 'Собирает formula-road.html из исходников, копирует в docs/.'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 38;
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
  ws.columns = [
    { key: 'res', width: 32 },
    { key: 'url', width: 72 },
    { key: 'who', width: 32 },
  ];

  const hRow = ws.addRow(['Ресурс', 'URL', 'Для кого']);
  headerStyle(ws, hRow);

  const rows = [
    ['Приложение Formula Road', 'https://sverdlikdan-code.github.io/COLUMBUS/formula-road.html', 'Менеджеры, агенты'],
    ['Туториал (11 шагов)', 'https://sverdlikdan-code.github.io/COLUMBUS/TUTORIALS/index.html', 'Менеджеры, новые пользователи'],
    ['Презентация проекта', 'https://sverdlikdan-code.github.io/COLUMBUS/TUTORIALS/presentation.html', 'Руководство, стейкхолдеры'],
    ['GitHub репозиторий', 'https://github.com/sverdlikdan-code/COLUMBUS', 'Разработчики'],
    ['GitHub Actions (CI/CD)', 'https://github.com/sverdlikdan-code/COLUMBUS/actions', 'Мониторинг деплоев'],
    ['', '', ''],
    ['Локальный сервер (API)', 'http://localhost:3000', 'Только локально — не для публичного доступа'],
    ['Cloudflare туннель', 'Динамический URL — смотри в логах cloudflared', 'Внутреннее использование'],
  ];

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 26;
    if (!r[0]) { row.height = 10; return; }

    row.getCell(1).font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF' + BLUE } };
    row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };

    const urlVal = r[1];
    if (urlVal && urlVal.startsWith('http')) {
      row.getCell(2).value = { text: urlVal, hyperlink: urlVal };
      row.getCell(2).font = { size: 11, name: 'Calibri', color: { argb: 'FF0563C1' }, underline: true };
    } else {
      row.getCell(2).value = urlVal;
      row.getCell(2).font = { size: 11, name: 'Calibri' };
    }
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFF' } };

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
    { key: 'num', width: 5 },
    { key: 'topic', width: 32 },
    { key: 'status', width: 18 },
    { key: 'comment', width: 62 },
    { key: 'date', width: 14 },
  ];

  const hRow = ws.addRow(['#', 'Тема', 'Статус', 'Решение / Комментарий', 'Дата']);
  headerStyle(ws, hRow);
  ws.autoFilter = { from: 'A1', to: 'E1' };

  const rows = [
    ['1', 'APK — нативное Android-приложение', '⏸ Отложено', 'Принято решение использовать PWA вместо нативного APK. PWA устанавливается как приложение на любое устройство без Google Play. Дополнительная разработка не требуется.', '27.05.2026'],
    ['2', 'Синхронизация порядка визитов в БД', '⚠ Частично', 'Ручное перетаскивание меняет порядок в UI, но visit_order в БД обновляется только через PUT /api/route-order. Рекомендуется добавить автосохранение после drag & drop.', '27.05.2026'],
    ['3', 'Офлайн-режим (PWA cache)', '⏸ Не нужно', 'Приложение работает с живыми данными из SQL Server (продажи, маршруты, GPS). Без сервера данных нет — кешировать нечего. Офлайн-режим не добавляет ценности для данного типа приложения.', '27.05.2026'],
    ['4', 'Аутентификация пользователей', '✅ Готово', 'Логин реализован. Менеджер (מנהל) входит с паролем 1999. Агенты входят по номеру סוכן. Данные о продажах защищены.', '27.05.2026'],
    ['5', 'Мобильная адаптация (responsive)', '✅ Базовая', 'Приложение работает на мобильных устройствах. Возможны улучшения UX для маленьких экранов в будущих итерациях.', '27.05.2026'],
    ['6', 'Push-нотификации', '⏸ Не реализовано', 'Не входило в первоначальный объём. Можно добавить в будущем: уведомление о новом маршруте, изменении визита.', '27.05.2026'],
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
      row.getCell(3).font = { bold: st.bold || false, size: 11, name: 'Calibri', color: { argb: 'FF' + st.color } };
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

// ─── Save ─────────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '..', 'COLUMBUS — Formula Road Сдача проекта.xlsx');
wb.xlsx.writeFile(outPath).then(() => {
  console.log('✅ Файл создан:', outPath);
});
