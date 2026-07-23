# -*- coding: utf-8 -*-
"""
GAP-анализ по SKU: для топ-70% Pareto клиентов FORMULA/INTER/ICE MISH — какие SKU из
реального ассортимента их сети (תאור סוג לקוח, по факту продаж в сети за 6 мес) клиент
НИ РАЗУ не купил за последние 6 месяцев. Группировка по שם סוכן — именно агент должен
продать то, что не продал (сдаран сюда не относится, см. project_sadran_role память).

Источники: gap_final.json (посчитан build-sadran-analysis.py пайплайном/ad-hoc DAX запросами
из server/ через FORMULA PBI dataset — таблицы ALL_PARTS, KARTIS PARIT, ADIFUT).
Запись — xlsxwriter (см. excel-smart-reports skill: openpyxl ломает файлы на этом масштабе).
"""
import json
import xlsxwriter

with open(r"C:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS\gap_final.json", encoding="utf-8") as f:
    data = json.load(f)
gap_rows = data["gap"]
dormant_rows = data["dormant"]

OUT = r"C:\Users\d.sverdlik\Desktop\GAP_ANALYSIS.xlsx"
wb = xlsxwriter.Workbook(OUT, {"strings_to_formulas": False})

NAVY = "#1F4E78"
header_fmt = wb.add_format({"bold": True, "bg_color": NAVY, "font_color": "white", "align": "center", "valign": "vcenter"})
note_fmt = wb.add_format({"italic": True, "font_size": 10, "font_color": "#808080", "text_wrap": True})
subtitle_fmt = wb.add_format({"bold": True, "font_size": 13, "font_color": NAVY})
money_fmt = wb.add_format({"num_format": "#,##0"})

_tbl_seq = [0]
def next_table_name():
    _tbl_seq[0] += 1
    return f"GapTbl{_tbl_seq[0]}"

def write_table(ws, start_row0, headers, rows, table_name=None):
    for i, h in enumerate(headers):
        pass  # заголовок пишет add_table через columns
    r = start_row0 + 1
    for row in rows:
        for i, val in enumerate(row):
            if val is None:
                continue
            # Formula-injection защита — Workbook({"strings_to_formulas": False}) ниже,
            # НЕ write_string() (ломает файл на масштабе, см. excel-smart-reports skill).
            ws.write(r, i, val)
        r += 1
    last_row = r - 1
    if rows:
        ws.add_table(start_row0, 0, last_row, len(headers) - 1, {
            "columns": [{"header": h} for h in headers],
            "style": "Table Style Medium 2",
            "autofilter": True,
            "name": table_name,
        })
    for i, h in enumerate(headers):
        maxlen = max([len(str(h))] + [len(str(row[i])) for row in rows if row[i] is not None]) if rows else len(str(h))
        ws.set_column(i, i, min(max(maxlen + 2, 10), 45))
    ws.freeze_panes(start_row0 + 1, 0)
    return last_row + 1

# ---------- Sheet: Обзор ----------
ws0 = wb.add_worksheet("Обзор")
ws0.right_to_left()
ws0.write(1, 1, "GAP-анализ по SKU — FORMULA / INTER / ICE MISH", subtitle_fmt)
ws0.write(3, 1, "Методика:", None)
lines = [
    "1. Топ-70% клиентов по выручке (Pareto) в каждой компании — 62 FORMULA + 44 INTER + 80 ICE MISH = 186.",
    "2. 'Ассортимент сети' (universe) = SKU, которые купила хотя бы одна точка того же תאור סוג לקוח (сети) за последние 6 мес — не весь каталог, а то, что реально доступно/утверждено для этого типа сети.",
    "3. Gap = SKU из ассортимента сети МИНУС SKU, которые купил именно этот клиент за последние 6 мес.",
    "4. Группировка — по שם סוכן (агент оформляет заказ), сдаран указан справочно (он не продаёт, только выкладка).",
    f"5. Найдено {len(gap_rows)} строк gap по {len(set(r['custno'] for r in gap_rows))} клиентам.",
]
for i, line in enumerate(lines):
    ws0.write(4 + i, 1, line, note_fmt)
ws0.set_column(1, 1, 110)

# ---------- Sheet: Gap — по агенту ----------
ws1 = wb.add_worksheet("Gap по агенту")
ws1.right_to_left()
gap_sorted = sorted(gap_rows, key=lambda r: (r["agent"] or "", r["company"], r["custname"], r["dept"]))
write_table(
    ws1, 0,
    ["Агент (שם סוכן)", "Компания", "Клиент", "№ клиента", "Сдаран (справочно)", "Тип сети (סוג לקוח)",
     "Департамент", "SKU (מק\"ט)", "Название товара"],
    [[r["agent"], r["company"], r["custname"], r["custno"], r["sadran"], r["custtype"],
      r["dept"], r["makat"], r["sku_name"]] for r in gap_sorted],
    table_name=next_table_name(),
)

# ---------- Sheet: Сводка по агенту x департамент ----------
ws2 = wb.add_worksheet("Сводка агент x департамент")
ws2.right_to_left()
from collections import defaultdict
summary = defaultdict(lambda: {"skus": set(), "custs": set()})
for r in gap_rows:
    k = (r["agent"], r["dept"])
    summary[k]["skus"].add(r["makat"])
    summary[k]["custs"].add(r["custno"])
summary_rows = sorted(
    [[k[0], k[1], len(v["skus"]), len(v["custs"])] for k, v in summary.items()],
    key=lambda x: -x[2],
)
write_table(
    ws2, 0,
    ["Агент (שם סוכן)", "Департамент", "# уникальных SKU в gap", "# клиентов затронуто"],
    summary_rows, table_name=next_table_name(),
)

# ---------- Sheet: Полностью потухшие (0 продаж 6 мес) ----------
ws3 = wb.add_worksheet("Потухшие клиенты")
ws3.right_to_left()
write_table(
    ws3, 0,
    ["№ клиента", "Клиент", "Компания", "Сдаран", "Тип сети", "Сумма в SADRAN (текущий период, ₪)"],
    dormant_rows, table_name=next_table_name(),
)
ws3.write(0, 6, "Клиенты из топ-70% Pareto (SADRAN.xlsx), у которых 0 продаж по ВСЕМ SKU за последние 6 месяцев в PBI.", note_fmt)
ws3.set_column(6, 6, 55)
for r in range(1, len(dormant_rows) + 1):
    ws3.write_number(r, 5, dormant_rows[r-1][5] if dormant_rows[r-1][5] is not None else 0, money_fmt)

wb.close()
print("SAVED:", OUT)
print("gap rows:", len(gap_rows), "dormant:", len(dormant_rows))
