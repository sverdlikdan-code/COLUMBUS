---
title: pbi-to-pptx-automation
date: 2026-06-08
status: research-done
tags: [power-bi, pptx, automation, node.js, xmla, rest-api, dax]
---

# Power BI → Node.js PPTX: Автоматизация без ручных скриншотов

## Контекст
Текущий workflow: ручные скриншоты из PBI Desktop → вставка в pptxgenjs.  
Файлы: `MMD.pbix` (5.1 MB) и `FORMULA DASHBORD.pbix` (181.7 MB).  
Оба PBIX содержат `RemoteArtifacts` — значит опубликованы в Power BI Service.  
DatasetId: MMD = `77f218a5-cb23-4ad4-a6e4-e515e7eda1b9`  
DatasetId: FORMULA = `457ddbf6-86f3-4d1f-8505-f4fd6ee0fb84`

## Установленные компоненты
- Power BI Desktop 2.154.1260.0 (Microsoft Store)
- msmdsrv.exe — SSAS Analysis Services движок внутри PBI
- MSOLAP 14.0 OLE DB Provider — зарегистрирован в реестре
- node-adodb (npm) v5.0.3 — доступен для установки
- mssql (npm) v12.5.5 — доступен для установки
- ODBC Driver 17 for SQL Server — установлен

## Рекомендованный подход: XMLA + DAX (Направление 2/6 комбинация)

Самый быстрый путь для существующего Node.js workflow.

## Исследование по 6 направлениям

### 1. Power BI REST API — только Service
- Desktop-only .pbix БЕЗ публикации → REST API недоступен
- Оба наших PBIX опубликованы → DatasetId есть → API работает
- Endpoint: `POST https://api.powerbi.com/v1.0/myorg/datasets/{datasetId}/executeQueries`
- Нужно: Azure AD App Registration + OAuth2 token (@azure/msal-node)
- npm: `@azure/msal-node`, `axios`

### 2. XMLA / Analysis Services — лучший локальный путь
- Когда PBI Desktop открыт с .pbix — msmdsrv.exe запускает локальный SSAS
- Порт: случайный, найти через реестр или Process Explorer
- Строка подключения: `Provider=MSOLAP.8;Data Source=localhost:PORT;...`
- node-adodb умеет делать ADODB запросы через Windows COM — работает!
- MSOLAP.8 зарегистрирован, DLL: `msolap.dll` в PBI bin папке
- Ограничение: PBI Desktop должен быть открыт с файлом

### 3. Export Visuals API — Service + Premium/PPU
- `POST .../reports/{reportId}/ExportTo` — экспорт визуала как PNG/PDF
- Требует: опубликованный отчёт + Premium Per User или Premium capacity
- Для Pro лицензии — недоступен (ограничение Microsoft)
- Асинхронный polling: запрос → jobId → polling → download
- npm: axios + @azure/msal-node

### 4. DAX Studio CLI — рабочий локальный инструмент
- DAX Studio НЕ установлен (нет в PATH, нет в Program Files)
- Установить: https://daxstudio.org/ — бесплатно
- CLI режим: `daxstudio.exe -s "localhost:PORT" -q "EVALUATE ..." -o output.csv`
- Tabular Editor 3 CLI тоже умеет DAX queries
- После установки: Node.js → spawn(daxstudio) → CSV → parse → pptxgenjs

### 5. Puppeteer — рабочий но хрупкий
- Power BI Service (app.powerbi.com) требует login — Puppeteer может автоматизировать
- Проблема: 2FA, селекторы меняются при обновлении PBI UI
- BIZNES-AI/ уже имеет puppeteer установленный (node_modules)
- Использовать как fallback, не как основной путь
- Для локального .pbix — НЕ применимо

### 6. Прямой доступ к данным — лучший долгосрочный путь
- SQL Server с ODBC Driver 17 установлен
- mssql npm пакет работает с SQL Server напрямую
- Обойти PBI полностью: Node.js → mssql → SQL → расчёт в JS → pptxgenjs
- Уже реализовано частично (DATA_COMPANIES массив в generate-mmd-report-v4.js)
- Расширить: подключить к тому же SQL Server что PBI использует

## Итоговая рекомендация

**Краткосрочно (быстро внедрить):**  
Вариант 6 — прямой SQL → уже частично есть в коде.  
`npm install mssql` → подключиться к SQL Server → заменить hardcoded массивы DATA_COMPANIES на live SELECT запросы.

**Среднесрочно (полная автоматизация):**  
Вариант 1+2 — Power BI REST API + XMLA:
1. Опубликовать PBIX (уже сделано, DatasetId есть)
2. `npm install @azure/msal-node axios`
3. Azure AD App Registration (бесплатно)
4. `POST /datasets/{id}/executeQueries` с DAX → JSON с данными
5. Данные → pptxgenjs → .pptx без единого скриншота

**Скриншоты оставить только для визуализаций** (графики, диаграммы) где это оправдано, числа всегда брать через API/SQL.
