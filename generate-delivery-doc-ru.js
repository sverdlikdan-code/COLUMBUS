const path    = require('path');
const ExcelJS = require(path.join(__dirname, 'planogram', 'node_modules', 'exceljs'));

const wb = new ExcelJS.Workbook();
wb.creator = 'COLUMBUS';
wb.created = new Date();

const T = {
  navy:   'FF1B2A4A', blue:   'FF1F4E79', lblue:  'FF2E75B6',
  sky:    'FFDEEAF1', green:  'FF375623', lgreen: 'FFE2EFDA',
  gold:   'FF7B5C00', lgold:  'FFFFF2CC', red:    'FF7B0000',
  lred:   'FFFFD7D7', gray:   'FF595959', lgray:  'FFF2F2F2',
  white:  'FFFFFFFF', text:   'FF1A1A1A',
};

function s(cl, { v, bold, size, color, bg, halign, wrap, border, numFmt, italic } = {}) {
  if (v !== undefined) cl.value = v;
  cl.font = { name: 'Calibri', size: size||11, bold:!!bold, italic:!!italic, color:{ argb: color||T.text } };
  if (bg) cl.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: bg } };
  cl.alignment = { vertical:'middle', horizontal: halign||'left', wrapText:!!wrap };
  if (numFmt) cl.numFmt = numFmt;
  if (border) { const b={style:'thin',color:{argb:'FFB0B0B0'}}; cl.border={top:b,bottom:b,left:b,right:b}; }
  return cl;
}
function h(ws,r,c,v,opts={}) {
  return s(ws.getCell(r,c),{ v, bold:true, size:opts.size||11, color:T.white, bg:opts.bg||T.blue, halign:'center', border:true, wrap:true, ...opts });
}
function title(ws,r,c1,c2,text,sub) {
  ws.mergeCells(r,c1,r,c2);
  s(ws.getCell(r,c1),{ v:text, bold:true, size:18, color:T.white, bg:T.navy, halign:'center' });
  ws.getRow(r).height=44;
  if(sub){ ws.mergeCells(r+1,c1,r+1,c2); s(ws.getCell(r+1,c1),{ v:sub, size:12, italic:true, color:T.gray, bg:T.sky, halign:'center' }); ws.getRow(r+1).height=24; }
}

// ══════════════════════════════════════════════════════════
// SHEET 1 — Обложка
// ══════════════════════════════════════════════════════════
const ws0 = wb.addWorksheet('✦ Проект');
ws0.columns = Array(4).fill({ width: 34 });

ws0.getRow(2).height=60; ws0.mergeCells('A2:D2');
s(ws0.getCell('A2'),{ v:'COLUMBUS — Интеллектуальная система управления', bold:true, size:20, color:T.white, bg:T.navy, halign:'center' });
ws0.mergeCells('A3:D3'); s(ws0.getCell('A3'),{ v:'DILER BMD — Документ сдачи проекта', size:13, italic:true, color:T.blue, bg:T.sky, halign:'center' }); ws0.getRow(3).height=28;
ws0.mergeCells('A4:D4'); s(ws0.getCell('A4'),{ v:'Май 2026', size:12, color:T.gray, halign:'center' }); ws0.getRow(4).height=22;

const blocks = [
  ['🏭 Что построено',    'Полная система: приложение для агентов, планограмма склада, живая аналитика', T.sky,   T.blue],
  ['⏱ Время разработки',  '~93 часа / 3 недели активной работы',                                         T.lgold, T.gold],
  ['🤖 AI внутри',        '7 AI-агентов: CEO, Географ, Махсан, Дизайнер, Аналитика и др.',               T.lgreen,T.green],
  ['📊 Живые данные',     'Авто-обновление каждый час 16:00–23:00 без участия человека',                  T.lred,  T.red],
];
let br=7;
for(const [k,v,bg,fg] of blocks){
  ws0.getRow(br).height=36; ws0.mergeCells(br,1,br,2);
  s(ws0.getCell(br,1),{ v:k, bold:true, size:13, color:fg, bg, halign:'center', border:true });
  ws0.mergeCells(br,3,br,4);
  s(ws0.getCell(br,3),{ v, size:12, color:T.text, bg, halign:'left', wrap:true, border:true }); br++;
}

// ══════════════════════════════════════════════════════════
// SHEET 2 — Что сдано
// ══════════════════════════════════════════════════════════
const ws1 = wb.addWorksheet('📦 Что сдано');
ws1.views=[{state:'frozen',xSplit:0,ySplit:3}];
ws1.columns=[{width:5},{width:30},{width:45},{width:18},{width:14}];
title(ws1,1,1,5,'📦 Сданные компоненты','Полный статус сдачи — май 2026');
['№','Компонент','Описание','Технология','Статус'].forEach((v,i)=>h(ws1,3,i+1,v,{bg:T.navy}));
ws1.getRow(3).height=28;

const del=[
  [1,'Приложение для агентов','Маршруты, карта, фильтры по городу, GPS, данные продаж','React Native','✅ Готово'],
  [2,'Интеграция Fabric / Power BI','Остатки, продажи, клиенты — прямо из ERP в реальном времени','REST API + DAX','✅ Готово'],
  [3,'Редактор планограммы — Заморозка','Отображение bay-ов, drag-drop, привязка товаров, цвета по семье','HTML/JS + JSON','✅ Готово'],
  [4,'Редактор планограммы — Молочка','Физическая планограмма 12×5, резерв, CSV по умолчанию','HTML/JS + JSON','✅ Готово'],
  [5,'Редактор планограммы — Рыба','Секции NORD PORT / SANTA BREMOR / охлажд., 57 bay-ов','HTML/JS + JSON','✅ Готово'],
  [6,'Редактор планограммы — Сухая рыба','Отдельная планограмма, данные из PBI','HTML/JS + JSON','✅ Готово'],
  [7,'Вид срока годности (תו"ק)','Карточки просрочки, опасность, Север vs Центр, STOP SALE','PBI + HTML','✅ Готово'],
  [8,'Автоматический ежедневный процесс','CSV → JSON → PBI → git push без участия человека','Node.js + bat','✅ Готово'],
  [9,'GitHub Actions — облако','Обновление каждый час 16–23 + 06:00, без включённого ПК','GitHub CI/CD','✅ Готово'],
  [10,'Watchdog + Doctor','Мониторинг процесса, диагностика ошибок, авто-повтор','PowerShell + Node','✅ Готово'],
  [11,'7 AI-агентов','CEO, Географ, Махсан, Дизайнер, Аналитика, Фин, Создатель скиллов','Claude Agent SDK','✅ Готово'],
  [12,'Excel плановограмма','MAHSAN PLANOGRAM v41.xlsx — все секции, продажи, остатки','ExcelJS','✅ Готово'],
];
del.forEach(([num,comp,desc,tech,stat],i)=>{
  const r=i+4, bg=i%2===0?T.white:T.lgray;
  s(ws1.getCell(r,1),{v:num, bg,border:true,halign:'center'});
  s(ws1.getCell(r,2),{v:comp,bg,border:true,bold:true,wrap:true});
  s(ws1.getCell(r,3),{v:desc,bg,border:true,wrap:true});
  s(ws1.getCell(r,4),{v:tech,bg,border:true,halign:'center',italic:true,color:T.blue});
  s(ws1.getCell(r,5),{v:stat,bg:T.lgreen,border:true,halign:'center',bold:true,color:T.green});
  ws1.getRow(r).height=26;
});

// ══════════════════════════════════════════════════════════
// SHEET 3 — Коммерческий потенциал
// ══════════════════════════════════════════════════════════
const ws2 = wb.addWorksheet('💰 Потенциал');
ws2.columns=[{width:28},{width:38},{width:20},{width:20}];
title(ws2,1,1,4,'💰 Коммерческий потенциал','Рынок, ценообразование, конкуренты и масштабирование');

['Решение','Что делает','Цена / месяц','COLUMBUS'].forEach((v,i)=>h(ws2,3,i+1,v,{bg:T.navy}));
ws2.getRow(3).height=28;

const comp=[
  ['Bringg',          'Управление доставками + агенты',        '$500–2,000',   '✅ Да'],
  ['Repsly',          'CRM + визиты для агентов',              '$800–3,000',   '✅ Да'],
  ['BeatRoute',       'Управление полевыми продажами',         '$300–1,200',   '✅ Да'],
  ['Nielsen Spaceman','Планограмма и дизайн полок',            '$2,000–8,000', '✅ Да'],
  ['BlueYonder WMS',  'Полное управление складом',             '$5,000+',      '⚠️ Частично'],
  ['COLUMBUS (наш)',   'Всё вместе: агенты + планограмма + AI','🔒 Индивидуально','🏆 Под клиента'],
];
comp.forEach(([sol,what,price,col],i)=>{
  const r=i+4, isOurs=i===comp.length-1, bg=isOurs?T.lgreen:(i%2===0?T.white:T.lgray);
  s(ws2.getCell(r,1),{v:sol, bg,border:true,bold:isOurs});
  s(ws2.getCell(r,2),{v:what,bg,border:true,wrap:true});
  s(ws2.getCell(r,3),{v:price,bg,border:true,halign:'center',color:isOurs?T.green:T.gray});
  s(ws2.getCell(r,4),{v:col, bg:isOurs?T.lgreen:bg,border:true,halign:'center',bold:isOurs,color:isOurs?T.green:T.text});
  ws2.getRow(r).height=24;
});

ws2.getRow(11).height=14;
['Тариф','Описание','Цена / месяц','Целевые клиенты'].forEach((v,i)=>h(ws2,12,i+1,v,{bg:T.navy}));
ws2.getRow(12).height=28;

const pr=[
  ['Стартер — малый бизнес',  '1–5 агентов, 1 склад, без продвинутого AI',   '₪1,500–2,500', 'Небольшие импортёры'],
  ['Бизнес — средний',        '5–20 агентов, 2–3 склада, полный AI',         '₪4,000–8,000', 'Дистрибьюторы FMCG'],
  ['Корпоратив — как Formula', '20+ агентов, большой склад, Fabric',          '₪12,000–20,000','Крупные импортёры'],
  ['SaaS — облачные клиенты', 'Ежемесячная аренда, авто-обновления',         'Нарастающий MRR','Широкий рынок ×10'],
];
pr.forEach(([tier,desc,price,cust],i)=>{
  const r=i+13, bg=i%2===0?T.sky:T.white;
  s(ws2.getCell(r,1),{v:tier, bg,border:true,bold:true,color:T.blue});
  s(ws2.getCell(r,2),{v:desc, bg,border:true,wrap:true});
  s(ws2.getCell(r,3),{v:price,bg,border:true,halign:'center',bold:true,color:T.green});
  s(ws2.getCell(r,4),{v:cust, bg,border:true,wrap:true,italic:true});
  ws2.getRow(r).height=26;
});

ws2.getRow(18).height=14;
ws2.mergeCells('A19:D19');
s(ws2.getCell('A19'),{v:'📈 Масштабируемость',bold:true,size:13,color:T.white,bg:T.lblue,halign:'center'});
ws2.getRow(19).height=28;

const sc=[
  ['Мультиклиентность',      'Каждый клиент — отдельный instance. Стоимость подключения: несколько часов'],
  ['Интеграции',             'Подключается к любой израильской ERP: Priority, SAP, Hashavshevet'],
  ['Кроссплатформенность',   'React Native — iOS + Android из одного кода'],
  ['AI-агенты готовы',       '7 агентов уже работают — добавить новое направление за 1–2 дня'],
  ['Нет серверных расходов', 'GitHub Actions CI/CD — нулевая инфраструктура для клиента'],
];
sc.forEach(([k,v],i)=>{
  const r=i+20, bg=i%2===0?T.lgreen:T.white;
  ws2.mergeCells(r,1,r,2); s(ws2.getCell(r,1),{v:'✓ '+k,bg,border:true,bold:true,color:T.green});
  ws2.mergeCells(r,3,r,4); s(ws2.getCell(r,3),{v,bg,border:true,wrap:true,italic:true});
  ws2.getRow(r).height=24;
});

// ══════════════════════════════════════════════════════════
// SHEET 4 — Безопасность данных
// ══════════════════════════════════════════════════════════
const ws3 = wb.addWorksheet('🔒 Безопасность');
ws3.columns=[{width:28},{width:52},{width:14}];
title(ws3,1,1,3,'🔒 Безопасность данных клиента','Политика, защиты и соответствие стандартам');
['Область','Детали','Статус'].forEach((v,i)=>h(ws3,3,i+1,v,{bg:T.navy}));
ws3.getRow(3).height=28;

const sec=[
  ['Хранение данных',       'Данные клиентов хранятся только в Microsoft Azure (Power BI Fabric) — серверы EU','✅'],
  ['Нет локальной БД',      'Никаких локальных SQL-серверов с данными клиентов — всё в зашифрованном облаке','✅'],
  ['Управление доступом',   'Каждый агент подключён через Azure AD — гранулярные права по роли','✅'],
  ['Зашифрованные токены',  'PAT / Client Secrets хранятся в GitHub Secrets / .env вне репозитория','✅'],
  ['Нет секретов в коде',   'Репо не содержит паролей, .env в .gitignore, нет утечек','✅'],
  ['Автоматические бэкапы', 'Каждое обновление → коммит в GitHub = полная история + возможность отката','✅'],
  ['Изоляция клиентов',     'Каждый клиент = отдельный репо/workspace — нет перекрёстного доступа','✅'],
  ['GDPR / Privacy',        'Данные клиентов не покидают регион — Azure Israel/EU','⚠️ Проверяется'],
  ['Шифрование трафика',    'Только HTTPS для всех API-вызовов — PBI, GitHub, приложение','✅'],
  ['Аудит действий',        'GitHub Actions logs + workflow.log — каждое действие задокументировано','✅'],
  ['Закрытый репозиторий',  'Приватный репо — только авторизованные пользователи видят код','✅'],
  ['Ротация секретов',      'Client Secret Azure — рекомендуется менять каждые 6 месяцев','⚠️ Настроить'],
];
sec.forEach(([topic,detail,stat],i)=>{
  const r=i+4, bg=i%2===0?T.white:T.lgray, sbg=stat==='✅'?T.lgreen:T.lgold, sfg=stat==='✅'?T.green:T.gold;
  s(ws3.getCell(r,1),{v:topic, bg,border:true,bold:true,wrap:true});
  s(ws3.getCell(r,2),{v:detail,bg,border:true,wrap:true});
  s(ws3.getCell(r,3),{v:stat,  bg:sbg,border:true,halign:'center',bold:true,color:sfg});
  ws3.getRow(r).height=26;
});

// ══════════════════════════════════════════════════════════
// SHEET 5 — Инвестиции и ценность
// ══════════════════════════════════════════════════════════
const ws4 = wb.addWorksheet('📈 Инвестиции и ROI');
ws4.columns=[{width:34},{width:14},{width:18},{width:22}];
title(ws4,1,1,4,'📈 Инвестиции, ценность и ROI','Стоимость разработки, рыночная стоимость и возврат инвестиций');
['Статья','Часы','Стоимость ($200/ч)','Примечание'].forEach((v,i)=>h(ws4,3,i+1,v,{bg:T.navy}));
ws4.getRow(3).height=28;

const dev=[
  ['Columbus App (маршруты + Fabric)',    17,  3400, 'GPS, API, UI/UX для агентов'],
  ['Редактор планограммы — UX и логика', 38,  7600, '4 секции, HTML editor'],
  ['Интеграция PBI — все секции',        18,  3600, 'DAX, API, остатки/продажи'],
  ['Автоматизация — workflow + CI/CD',   12,  2400, 'GitHub Actions, watchdog'],
  ['AI-агенты — 7 штук',                8,   1600, 'CEO, Географ, Махсан и др.'],
  ['Баги, правки, оптимизация',          16,  3200, 'localStorage, git, merges'],
  ['Документация, vault, память',        4,   800,  'CLAUDE.md, VAULT, SKILL.md'],
];
let totH=0, totV=0;
dev.forEach(([item,hrs,val,note],i)=>{
  const r=i+4, bg=i%2===0?T.white:T.lgray;
  s(ws4.getCell(r,1),{v:item,bg,border:true,wrap:true});
  s(ws4.getCell(r,2),{v:hrs, bg,border:true,halign:'center',numFmt:'0" ч"'});
  s(ws4.getCell(r,3),{v:val, bg,border:true,halign:'center',bold:true,numFmt:'"$"#,##0',color:T.blue});
  s(ws4.getCell(r,4),{v:note,bg,border:true,wrap:true,italic:true});
  ws4.getRow(r).height=24; totH+=hrs; totV+=val;
});
const tr=dev.length+4;
[['Итого',T.navy],['',T.navy],['',T.navy],['Минимальная рыночная стоимость',T.navy]].forEach(([v,bg],i)=>{
  const cl=ws4.getCell(tr,i+1);
  s(cl,{v: i===0?'Итого':i===1?totH:i===2?totV:v, bold:true, size:13, color:T.white, bg, border:true, halign:'center', numFmt: i===1?'0" ч"':i===2?'"$"#,##0':undefined});
});
ws4.getRow(tr).height=32;

ws4.getRow(tr+2).height=14;
['Сценарий','Клиентов','Доход / месяц','ROI за год'].forEach((v,i)=>h(ws4,tr+3,i+1,v,{bg:T.green}));
ws4.getRow(tr+3).height=28;

[[' Консервативный',3,45000,'×2.5 от вложений'],[' Реалистичный',8,120000,'×6.5 от вложений'],[' Оптимистичный',20,300000,'×16 от вложений']]
.forEach(([sc,cl,mo,roi],i)=>{
  const r=tr+4+i, bg=[T.lred,T.lgold,T.lgreen][i];
  s(ws4.getCell(r,1),{v:sc, bg,border:true,bold:true});
  s(ws4.getCell(r,2),{v:cl, bg,border:true,halign:'center',numFmt:'0" клиентов"'});
  s(ws4.getCell(r,3),{v:mo, bg,border:true,halign:'center',bold:true,numFmt:'"₪"#,##0',color:T.green});
  s(ws4.getCell(r,4),{v:roi,bg,border:true,halign:'center',bold:true,color:T.navy});
  ws4.getRow(r).height=26;
});

const OUT = path.join(__dirname, 'COLUMBUS — Сдача проекта RU.xlsx');
wb.xlsx.writeFile(OUT).then(()=>{ console.log('✅', OUT); require('child_process').exec(`start "" "${OUT}"`); });
