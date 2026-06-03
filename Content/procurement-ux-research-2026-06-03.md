---
source: multiple
retrieved: 2026-06-03
language: ru
original_title: UX и функциональность procurement-инструментов для рынка витаминов и БАД
---

# Procurement-инструменты для витаминов и БАД: UX-исследование

> Исследование выполнено: 2026-06-03 | Хен

---

## Резюме

Рынок procurement-инструментов для дистрибьюторов витаминов и нутрицевтиков делится на два сегмента: универсальные inventory-платформы (Cin7, Unleashed, Finale, DOSS) и специализированные решения для пищевой/фармацевтической промышленности (Brahmin Solutions, Acctivate). Лидирующие UX-паттерны: цветовые индикаторы дефицита, автоматические reorder-сuggestions на основе lead time + velocity, kanban для PO-воркфлоу, AI-прогнозирование. Специфика отрасли: обязательный FEFO, lot tracking, CoA, GMP-compliance — требования, которые большинство универсальных систем покрывают минимально, а специализированные — в полную меру.

---

## Конкуренты — детальный разбор

### 1. Cin7 Core

**Тип:** Универсальный inventory + ERP для SMB и mid-market  
**Сайт:** [cin7.com](https://www.cin7.com/)  
**Целевой пользователь:** Байеры в дистрибьюторских компаниях, eCommerce операторы

**UX-фишки:**
- **Intelligent Document Recognition (IDR):** загружаешь PDF-заказ поставщику — система автоматически распознаёт поля и создаёт черновик PO. Экономия 4–8 часов в неделю на ручном вводе.
- **Smart Reorder Points:** AI-рекомендации по safety stock на основе velocity + lead time. Система сама генерирует предложения о пополнении без участия байера.
- **Recurring PO:** автоматические повторяющиеся заказы для регулярных позиций.
- **Approval workflow:** обязательное согласование перед приёмкой или оплатой инвойса — встроено в UI как conditional button (кнопка недоступна до выполнения условий).
- **Supplier dashboard:** единый экран всех поставщиков с историей заказов.
- **Barcode receiving:** приёмка товара сканированием прямо против открытого PO.

**Как показывают дефицит:** Через Smart Reorder Points — система сравнивает stock-on-hand с reorder point и подсвечивает позиции для заказа.

**PO Creation flow:** Автоматический (из IDR или reorder suggestions) → черновик → review → approval → отправка поставщику.

**Alerts:** In-app + email. WhatsApp не упоминается.

**Специфика витаминов/БАД:** Batch tracking и serial tracking есть. Expiry date — минимально. Не позиционируется как GMP-compliant решение.

---

### 2. Unleashed Software

**Тип:** Cloud inventory для оптовых дистрибьюторов  
**Сайт:** [unleashedsoftware.com](https://www.unleashedsoftware.com/)

**UX-фишки:**
- **Advanced Inventory Manager (AIM):** модуль автоматически вычисляет оптимальные min/max уровни для каждого SKU на основе lead times и rate of use. Уровни можно настраивать по каждому складу (локации) отдельно.
- **Visual PO Board (Kanban):** список открытых PO отображается в виде drag-and-drop карточек по стадиям воркфлоу. Запущено май 2025 — один из самых свежих UX-паттернов на рынке. Позволяет видеть узкие места в procurement pipeline.
- **Graphical demand/supply forecast:** интерактивные графики спроса и предложения, top performers, AIM-активность — всё на одном dashboard.
- **Automated reorder alerts:** уведомление когда сток падает ниже установленного порога.
- **Extensive filtering:** кастомизация и фильтрация ключевых метрик инвентаря.

**Как показывают дефицит:** Автоматические alerts при падении ниже min. В AIM — наглядный диапазон healthy range с визуализацией.

**PO Creation flow:** Kanban-доска по стадиям → drag-and-drop между статусами → identify bottlenecks.

**Alerts:** In-app + email. Автоматические при нарушении min-max диапазона.

**Специфика витаминов/БАД:** Базовый batch tracking. Не специализирован под GMP/FDA требования.

---

### 3. Finale Inventory (Descartes Finale)

**Тип:** Inventory management для eCommerce и оптовиков  
**Сайт:** [finaleinventory.com](https://www.finaleinventory.com/)  
**Специальная страница для витаминов:** [finaleinventory.com/industries/nutritional-supplements](https://www.finaleinventory.com/industries/nutritional-supplements-inventory-management/)

**UX-фишки:**
- **Reorder Point (ROP) alerts:** автоматический триггер когда сток падает ниже ROP. Система учитывает quantity on hand + lead time + sales velocity.
- **Landed cost algorithm:** точный учёт полной стоимости закупки включая freight/shipping — важно для margin calculations.
- **Barcode receiving:** приёмка против открытого PO через сканер.
- **Multi-location management:** централизованный reorder с распределением по складам включая Amazon FBA.
- **Workflow customization:** настраиваемые PO-воркфлоу с определёнными стадиями.
- **LOT ID tracking:** нативный для supplement-индустрии — каждая партия получает lot number для traceability.

**Рейтинг:** SelectHub — 100/100 по purchasing module (лучший результат среди сравниваемых решений, Fishbowl — 89, ASAP Systems — 74).

**PO Creation flow:** Упрощённый, "jump straight in" — описывается как самоочевидный. Быстрое создание PO в несколько минут.

**Alerts:** Автоматические при достижении ROP. Channels не уточняются.

**Специфика витаминов/БАД:** Lot ID tracking нативный. Позиционируется как решение для nutritional supplements. Упоминается expiry management через FEFO.

---

### 4. RELEX Solutions

**Тип:** Enterprise supply chain + demand planning (retail & CPG)  
**Сайт:** [relexsolutions.com](https://www.relexsolutions.com/)  
**Кейс:** The Vitamin Shoppe — 750+ розничных точек + 2 distribution центра

**UX-фишки:**
- **ML-based demand forecasting:** машинное обучение для точного прогноза с учётом сезонности, промо и slow-movers. Планировщики работают с exceptions, а не с базовым объёмом.
- **Manual correction UI:** интерфейс позволяет легко вручную корректировать forecasts — важная фича для экспертов-байеров.
- **Multi-level dashboards:** иерархические дашборды для review на разных уровнях (SKU, категория, поставщик, DC).
- **Forecast visualizations:** графики показывают влияние разных demand-факторов на прогноз (seasonality, promotions, trends).
- **Promotion optimization:** снижение избыточного стока при высокой доступности продукта.
- **Exception management:** система сама выделяет аномалии, байер работает только с отклонениями.

**Как показывают прогноз:** Многоуровневые графики с декомпозицией факторов. Возможность ручной коррекции прямо в UI.

**Специфика витаминов/БАД:** Прямой кейс The Vitamin Shoppe. Учитывает сезонность — ключевое для иммунных добавок, электролитов, Omega-3. Enterprise уровень, не для SMB.

---

### 5. Brahmin Solutions

**Тип:** MRP + Inventory для производителей и оптовиков нутрицевтиков/БАД  
**Сайт:** [brahmin-solutions.com](https://www.brahmin-solutions.com/)  
**Специальная страница:** [Health & Supplements](https://www.brahmin-solutions.com/industry/health-and-supplements)

**UX-фишки (специализированы под GMP/FDA):**
- **Digital Batch Records:** автоматические производственные журналы с ingredient lots, operator data, yield — создаются в момент производства. Разработаны специально для FDA-инспекций и аудитов.
- **Version Control для формул:** каждая production run связана с конкретной версией формулы.
- **FEFO picking rules:** "first expired, first out" — автоматическое правило отбора по сроку годности.
- **Ingredient lot tracking:** каждый ингредиент при поступлении получает lot number + expiration date + supplier record.
- **Certificate of Analysis (CoA):** вложение CoA к lot-записям ингредиентов.
- **Recall report:** генерация отчёта за минуты — какие клиенты получили продукцию с определённым ingredient lot.
- **Forward/backward traceability:** от сырья до готового продукта и обратно.
- **Automatic expiry alerts:** уведомления при приближении к истечению срока годности.
- **Supplier qualification docs:** хранение документов квалификации поставщиков в системе.

**PO Creation flow:** BOM-driven — система рассчитывает потребность в сырье автоматически из производственного плана.

**Специфика витаминов/БАД:** Единственный из рассматриваемых продуктов, построенный изначально для supplement manufacturing. FDA/GMP compliance — core feature, не add-on.

---

### 6. GMDH Streamline

**Тип:** AI-powered demand planning и replenishment  
**Сайт:** [streamlineplan.com](https://www.streamlineplan.com/)

**UX-фишки:**
- **Autonomous replenishment:** автоматическое обновление планов пополнения, система сообщает "что заказать, сколько и когда".
- **Multi-location planning:** планирование по нескольким складам и локациям одновременно.
- **Easy-to-understand UI:** пользователи отмечают простоту интерфейса — "позиция кнопок и размеры модулей обеспечивают отличное взаимодействие".
- **Forecasting accuracy:** высокая точность прогнозов на основе sales data.
- **Сообщаемый ROI:** $210,000/месяц сэкономленных средств для eCommerce-клиентов; 25% снижение времени на оптимизацию инвентаря.

**Слабые места UX:** Ограниченная кастомизация dashboard; нет независимых view с отдельными фильтрами — все view имеют одни и те же поля.

**Специфика витаминов/БАД:** Не специализирован. Подходит для дистрибьюторов с большим количеством SKU где важна автоматизация прогноза.

---

### 7. DOSS Operations Cloud

**Тип:** AI-native modular ERP  
**Сайт:** [doss.com](https://www.doss.com/)  
**Финансирование:** $55M (март 2026, TechCrunch)

**UX-фишки:**
- **Composable architecture:** модульная система — слоишь Procurement, Inventory, Order Management поверх единого master data. Нет жёстких шаблонов — система адаптируется к процессам компании.
- **Real-time contribution margin:** видимость маржи на уровне SKU в реальном времени.
- **AI-automated PO creation:** AI автоматически создаёт PO, сокращая ручные процессы.
- **Cross-location inventory unification:** единый взгляд на инвентарь из 3PL, Co-Man, Retail, Supplier.
- **Automated purchasing workflows:** предотвращение stockouts через автоматические триггеры.
- **Fast deployment:** 12–16 недель вместо 12–18 месяцев для традиционных ERP.

**Специфика витаминов/БАД:** Не специализирован, но composable architecture позволяет добавлять специфические модули. Ориентирован на физические продуктовые компании.

---

### 8. QuickBooks Commerce (бывший TradeGecko)

**Тип:** Inventory management, интегрированный с QuickBooks  
**Статус:** Функциональность оригинального TradeGecko существенно урезана при переходе в QuickBooks Commerce. По данным сообщества Intuit, платформа может не вернуться в полном объёме.

**UX-фишки (остаточные):**
- Создание PO, backorders, stock adjustments.
- Supplier information и lead times для оптимизации procurement.
- PO-отчёты в составе общей отчётности.
- Централизованная обработка заказов из нескольких источников.

**Слабые места UX:** Производительность — зависания, медленная загрузка. Урезанная функциональность по сравнению с оригинальным TradeGecko. Нет мобильного приложения.

**Рекомендация:** Не рассматривать как целевой эталон. Лучше смотреть на Cin7 или Unleashed.

---

### 9. Acctivate (бонус)

**Тип:** Inventory software для QuickBooks users, специализируется на regulated industries  
**Сайт:** [acctivate.com](https://acctivate.com/)

**UX-фишки для витаминов/БАД:**
- **Expiration date database:** комплексная БД продуктов с датами истечения. Даты вводятся при приёмке или производстве.
- **Automatic expiry notifications:** система уведомляет когда продукт приближается к истечению срока.
- **FIFO/FEFO management:** приоритизация продаж старого инвентаря через visibility дат поступления.
- **Lot/batch number tracking:** полная идентификация и локация конкретных партий внутри инвентаря.
- **Product recall support:** быстрое выявление затронутых партий.
- **Low stock alerts:** уведомления при достижении минимума.

**Специфика:** Построен для QuickBooks + regulated industries. Lot number + graph tracking — отмечается пользователями как "perfect for supplement industry".

---

## Общие UX-паттерны — что повторяется у всех

### Как показывают дефицит (shortage indicators)
- **Красный/оранжевый бейдж** "Low Stock" или "Below Reorder Point" — наиболее распространённый паттерн
- **Цветовая шкала:** зелёный (норма) → оранжевый (приближается к min) → красный (ниже min/ROP)
- **В POS и eCommerce:** бейдж с текстом "Low Inventory" имеет приоритет над другими бейджами (Sale, Bestseller) — urgency выше
- **Dashboard summary:** KPI-блок "X позиций ниже порога" + список с сортировкой по срочности
- **Odoo-паттерн:** list view + kanban view с декоративным CSS-классом для строк ниже порога

### Как устроен список SKU
- **Основной паттерн:** таблица с плотным отображением данных (density важнее красоты)
- **Переключатель Grid/List:** встречается у большинства платформ как опция
- **Kanban для PO:** Unleashed ввёл kanban для статусов заказов, но не для самих SKU
- **Фильтры и сортировка:** extensible filtering — стандарт; кастомные view — у Streamline ограничены
- **Inline status:** статус SKU (active/inactive, seasonal, reorder needed) прямо в строке таблицы

### Как показывают прогноз спроса
- **Графики:** основной формат — линейный график исторических продаж + projected forecast
- **RELEX-паттерн:** многоуровневые графики с декомпозицией факторов (seasonality, promotions, trend)
- **AI Summary:** DOSS и Streamline дают числа + текстовые рекомендации ("заказать X единиц к [дате]")
- **AIM-паттерн Unleashed:** числовые min/max диапазоны + графический healthy range indicator
- **Exception management:** лучшие системы (RELEX, Streamline) показывают только отклонения — байер не перебирает всё вручную

### Как работает создание заказа (PO)
- **Auto-generate from reorder suggestions:** нажать кнопку "Create PO" прямо из списка предложений — самый распространённый fast-track
- **Wizard/форма:** Supplier → Products → Quantities → Price → Delivery date → Submit. Стандартный паттерн для ручного создания.
- **IDR (Cin7):** загрузка PDF → автоматическое заполнение — наиболее продвинутый паттерн
- **Kanban workflow (Unleashed):** drag-and-drop между статусами PO
- **Conditional buttons:** кнопки действий заблокированы пока не выполнены все условия (approval workflow)
- **Inline editing:** минимально распространён — большинство систем требуют открыть отдельный экран редактирования

### Alerts — каналы уведомлений
- **In-app notifications:** стандарт у всех
- **Email:** стандарт у всех
- **WhatsApp:** не встречается ни у одного из исследованных продуктов — рыночный gap
- **SMS:** не упоминается явно
- **Настраиваемые пороги:** у всех — можно задать собственный reorder point по каждому SKU

---

## Специфика рынка витаминов и БАД

### Регуляторные требования

**FDA cGMP (21 CFR Part 111) — для США:**
- Обязательный lot tracking для каждой партии
- Хранение reserve samples из каждого lot
- Документация по country of origin для всех ингредиентов (Bioterrorism Law)
- Доступ FDA ко всем производственным записям при инспекции
- Manufacturing date + lot number — обязательная связь для batch tracking

**GMP compliance в инвентаре означает:**
- Certificate of Analysis (CoA) к каждому входящему lot
- Forward/backward traceability (от сырья до клиента и обратно)
- Recall report — генерация за минуты
- Digital batch records

**FEFO vs FIFO:**
- Витамины/БАД требуют FEFO (First Expired, First Out), а не стандартного FIFO
- Это нативная фича в Brahmin Solutions и Acctivate
- В универсальных системах (Cin7, Unleashed) — требует дополнительной настройки

### Типичные lead times от поставщиков

Данные из нескольких источников:
- **Локальные (US domestic) производители:** 4–8 недель стандартно, 2–4 недели для стандартных формул
- **Международные поставщики (Китай, Индия — крупнейшие источники ингредиентов):** 8–16 недель включая shipping
- **Рекомендация индустрии:** начинать планирование минимум за 6 месяцев до пикового сезона
- **Rolling 90-day forecast** — стандартная практика с ежемесячным пересмотром

### Сезонность — что и когда

| Сезон | Пиковые продукты | Изменение спроса |
|-------|-----------------|-----------------|
| Зима (Oct–Mar) | Vitamin C, Zinc, Elderberry, Sleep aids (Melatonin, Magnesium), Adaptogens | +200–300% для иммунной группы |
| Весна (Mar–May) | Аллергические добавки (Quercetin, Vit C), Пробиотики, Детокс | +25–35% для аллергических |
| Лето (Jun–Aug) | Электролиты, BCAAs, Pre-workout, Skin health, Travel wellness | x2–x3 для электролитов |
| Осень (Sep–Oct) | Omega-3 (mood), Мультивитамины (back-to-school), Ранний иммунитет | Early immune surge |

**Круглогодичные позиции:** мультивитамины, пробиотики для кишечника, Vitamin D.

**Ключевой вывод для планирования:** Сезонные колебания 30–40% между пиком и провалом для сезонных позиций. Бренды рекомендуют 2–3 года исторических данных для точного моделирования.

### Ценовая нестабильность сырья
- Seasonality влияет не только на спрос, но и на доступность/стоимость сырья
- Temperature, humidity, light exposure деградируют продукты при хранении — важна температурная цепочка
- Single-supplier риск критичен для ключевых ингредиентов — рекомендуется диверсификация

---

## Рекомендации для Procurement Radar

На основе исследования — что стоит взять:

### Мастхэв функции (есть у всех лидеров)

1. **Reorder Point автоматизация** — автоматический расчёт ROP на основе lead time + sales velocity. Без этого байер делает всё вручную.

2. **Дефицит-индикаторы:** красный/оранжевый цвет в списке SKU + числовой бейдж "X позиций требуют заказа" на главном экране. Приоритизация по срочности.

3. **One-click PO от предложений:** список suggested orders → чекбокс нужных → "Create PO" — должно работать за 3 клика.

4. **Kanban для PO-воркфлоу** (паттерн Unleashed) — драг-н-дроп статусов: Draft → Sent → Confirmed → In Transit → Received. Визуально снимает вопрос "где мой заказ".

### Дифференциаторы (редко встречаются вместе)

5. **WhatsApp alerts** — ни один из исследованных продуктов не имеет WhatsApp-уведомлений. Для израильского рынка это критично — WhatsApp является основным рабочим каналом.

6. **FEFO нативно** — большинство систем делают FIFO. Для витаминов/БАД нужен FEFO из коробки с визуальным отображением "ближайших к истечению" позиций.

7. **Expiry date dashboard** — отдельный экран "Скоро истекает" с сортировкой по дате + количеству единиц + рекомендацией действия (снизить цену / переместить / вернуть поставщику).

8. **Сезонный прогноз по категориям** — в отличие от универсальных систем, витаминный байер должен видеть "Зимний пик через 8 недель — Vitamin C в риске stockout исходя из lead time 6 нед." как готовую рекомендацию.

### Специфические для Israeli market

9. **Иврит-интерфейс или хотя бы RTL-совместимость** — ни один из рассмотренных продуктов не имеет иврита. Рыночный gap.

10. **Поставщик-карточки с документами** — CoA, спецификации, сертификаты кошерности, санитарные требования Минздрава Израиля. Brahmin Solutions делает это для FDA — адаптация под Israeli MoH requirements создаст конкурентное преимущество.

### UX-паттерн для главного экрана Procurement Radar

Рекомендуемая структура (на основе best practices рынка):

```
[Header] Procurement Radar — Витамины и БАД
[KPI bar] Требуют заказа: 12 SKU | Истекают < 30 дней: 4 SKU | Открытые PO: 7
[Alert strip] СРОЧНО: Vitamin C 500mg — сток на 3 дня (ROP нарушен)
[SKU Table] — плотная таблица с цветовым кодированием строк:
  - Красный: ниже ROP
  - Оранжевый: < 2x от ROP
  - Жёлтый: сезонный риск (пик через N недель)
  - Зелёный: норма
[PO Kanban] — боковая колонка или отдельный таб со статусами открытых заказов
[Forecast chart] — 12-недельный график спроса с маркерами сезонных пиков
```

---

## Ключевые цитаты

> "The Vitamin Shoppe adopted an integrated supply chain strategy, first improving the accuracy of demand forecasts, then using those forecasts to optimize store and distribution center replenishment and allocations." — [RELEX Solutions](https://www.relexsolutions.com/news/relex-announces-that-the-vitamin-shoppe-has-chosen-its-integrated-supply-chain-solutions/)

> "Every ingredient received in Brahmin gets a lot number, an expiration date, and a supplier record." — [Brahmin Solutions](https://www.brahmin-solutions.com/industry/health-and-supplements)

> "Vitamin C, zinc, elderberry see 200-300% sales increases during cold and flu season." — [Crescent Edge Consulting](https://www.crescentedgeconsulting.com/blog/seasonal-demand-patterns-for-supplements-inventory-plans)

> "Electrolyte products potentially see sales double or triple compared to winter months." — [Crescent Edge Consulting](https://www.crescentedgeconsulting.com/blog/seasonal-demand-patterns-for-supplements-inventory-plans)

> "Modern buyers expect consumer-grade experiences in B2B environments." — [ProcureDesk](https://www.procuredesk.com/purchasing-management-software/)

---

## Источники

- [Cin7 — Supplier Management & Purchase Order Software](https://www.cin7.com/features/inventory/purchasing/)
- [Unleashed — Purchase Order Management](https://www.unleashedsoftware.com/product/purchase-order-software/)
- [Finale Inventory — Nutritional Supplements](https://www.finaleinventory.com/industries/nutritional-supplements-inventory-management/)
- [RELEX — The Vitamin Shoppe Case](https://www.relexsolutions.com/news/relex-announces-that-the-vitamin-shoppe-has-chosen-its-integrated-supply-chain-solutions/)
- [Brahmin Solutions — Health & Supplements](https://www.brahmin-solutions.com/industry/health-and-supplements)
- [GMDH Streamline Reviews 2026 — G2](https://www.g2.com/products/gmdh-streamline/reviews)
- [DOSS — $55M Raise, TechCrunch 2026](https://techcrunch.com/2026/03/24/doss-raises-55m-for-ai-inventory-management-that-plugs-into-erp/)
- [Acctivate — Supplement Inventory Management](https://acctivate.com/supplement-inventory-management-software/)
- [UITOP — UX for Inventory Systems](https://uitop.design/blog/designing-order-management-and-inventory-systems/)
- [Crescent Edge — Seasonal Demand Patterns for Supplements](https://www.crescentedgeconsulting.com/blog/seasonal-demand-patterns-for-supplements-inventory-plans)
- [Vitakem — Nutraceutical Supply Chain Challenges](https://vitakem.com/nutraceutical-supply-chain-challenges-and-solutions/)
- [FDA — cGMP for Dietary Supplements](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/small-entity-compliance-guide-current-good-manufacturing-practice-manufacturing-packaging-labeling)
- [Fulfyld — Supplement Seasonality Management](https://www.fulfyld.com/blog/how-is-seasonality-managed-for-supplement-fulfillment/)
