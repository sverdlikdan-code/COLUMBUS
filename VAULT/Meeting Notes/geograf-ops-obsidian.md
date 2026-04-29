---
title: Geograf Ops Obsidian
tags:
  - geograf
  - routing
  - israel
  - ops
aliases:
  - Geograf Daily Routing
---

# Geograf Ops Obsidian

> [!info]
> Рабочая заметка для ежедневного построения `סדר ביקור` по агенту и дате.

## Daily Input

- `agent_id`: 
- `visit_date`:
- `start_city`:
- `sql_source`: SQL Server

## Mandatory Gate

> [!warning]
> Не строить маршрут, пока не заполнен `start_city`.

## Routing Checklist (Israel)

- [ ] Загружены клиенты из SQL по `agent_id + visit_date`
- [ ] Проверены/дозаполнены `latitude`/`longitude`
- [ ] Нормализованы иврит-адреса
- [ ] Учтены дорожные ограничения и перекрытия (если есть feed)
- [ ] Сформирован детерминированный `visit_order / סדר ביקור`
- [ ] Зафиксированы warnings для проблемных адресов

## Output Template

| client_id | address_original | address_normalized | latitude | longitude | סדר ביקור | warning |
|---|---|---|---:|---:|---:|---|
|  |  |  |  |  |  |  |

## Related

- [[agent-geograf]]
- [[skill-geograf-israel-routing]]
- [[ceo-agent-prd]]

