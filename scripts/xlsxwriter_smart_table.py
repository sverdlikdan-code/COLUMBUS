# -*- coding: utf-8 -*-
"""
Переиспользуемый хелпер для "умных" Excel-таблиц через xlsxwriter (см. excel-smart-reports skill).

Почему xlsxwriter, а не openpyxl: на книге с >10 Excel Table на разных листах и тысячами
строк openpyxl надёжно ломает styles.xml/tables — Excel открывает файл с "We found a
problem with some content...". Проверено эмпирически (build-sadran-analysis.py,
2026-07-21): тот же объём данных через xlsxwriter открывается чисто. openpyxl остаётся
пригоден для ЧТЕНИЯ существующих файлов (data_only=True, read_only=True).

Formula-injection защита: НЕ используй ws.write_string() для этого — в xlsxwriter 3.2.9
write_string() ломает файл на масштабе >10 Table (подтверждено эмпирически 2026-07-22,
несвязанный баг с той же сигнатурой "problem with some content"). Вместо этого создавай
Workbook с {"strings_to_formulas": False} — это отключает автодетект "=..." как формулы
на уровне всей книги, используя обычный ws.write(), который на масштабе безопасен.

Использование:
    import xlsxwriter
    from xlsxwriter_smart_table import make_formats, write_table

    wb = xlsxwriter.Workbook("out.xlsx", {"strings_to_formulas": False})
    fmt = make_formats(wb)
    ws = wb.add_worksheet("Sheet1")
    ws.right_to_left()
    write_table(ws, fmt, start_row0=0, headers=[...], rows=[[...], ...],
                pct_col_idx=3, money_cols={1, 2}, table_name="Tbl1")
    wb.close()
"""

NAVY = "#1F4E78"
GROWTH_BG, GROWTH_FG = "#C6EFCE", "#006100"
DECLINE_BG, DECLINE_FG = "#FFC7CE", "#9C0006"


def make_formats(wb):
    """Один набор форматов на книгу — переиспользуй между листами, не создавай заново на каждый write_table."""
    return {
        "header": wb.add_format({"bold": True, "bg_color": NAVY, "font_color": "white", "align": "center", "valign": "vcenter"}),
        "bold": wb.add_format({"bold": True}),
        "title": wb.add_format({"bold": True, "font_size": 14}),
        "money": wb.add_format({"num_format": "#,##0"}),
        "pct": wb.add_format({"num_format": "0.0%"}),
        "pct_growth": wb.add_format({"num_format": "0.0%", "bg_color": GROWTH_BG, "font_color": GROWTH_FG}),
        "pct_decline": wb.add_format({"num_format": "0.0%", "bg_color": DECLINE_BG, "font_color": DECLINE_FG}),
        "note": wb.add_format({"italic": True, "font_size": 10, "font_color": "#808080", "text_wrap": True}),
    }


def _pct_fmt(fmt, val):
    if val is None:
        return fmt["pct"]
    return fmt["pct_growth"] if val > 0 else (fmt["pct_decline"] if val < 0 else fmt["pct"])


def write_table(ws, fmt, start_row0, headers, rows, pct_col_idx=None, money_cols=None, table_name=None,
                 style="Table Style Medium 2"):
    """start_row0 = 0-indexed строка заголовка. pct_col_idx/money_cols — 1-indexed номера колонок.
    Возвращает следующую свободную 0-indexed строку.

    Заголовок пишет xlsxwriter сам через add_table(columns=...) — НЕ пиши его вручную поверх,
    получится дублирование/конфликт форматов.
    """
    money_cols = set(money_cols or [])
    ncols = len(headers)
    r = start_row0 + 1
    for row in rows:
        for i, val in enumerate(row):
            col_1based = i + 1
            if val is None:
                continue
            if pct_col_idx and col_1based == pct_col_idx and isinstance(val, (int, float)):
                ws.write_number(r, i, val, _pct_fmt(fmt, val))
            elif col_1based in money_cols and isinstance(val, (int, float)):
                ws.write_number(r, i, val, fmt["money"])
            else:
                # Formula-injection защита — на уровне Workbook({"strings_to_formulas": False}),
                # не здесь (write_string() ломает файл на масштабе, см. докстринг модуля).
                ws.write(r, i, val)
        r += 1
    last_row = r - 1
    if rows:
        ws.add_table(start_row0, 0, last_row, ncols - 1, {
            "columns": [{"header": h} for h in headers],
            "style": style,
            "autofilter": True,
            "name": table_name,
        })
    for i, h in enumerate(headers):
        maxlen = max([len(str(h))] + [len(str(row[i])) for row in rows if row[i] is not None]) if rows else len(str(h))
        ws.set_column(i, i, min(max(maxlen + 2, 10), 45))
    ws.freeze_panes(start_row0 + 1, 0)
    return last_row + 1


def add_bar_chart(wb, ws, title, sheet_name, cat_col0, val_col0, first_row0, last_row0, anchor="H1"):
    chart = wb.add_chart({"type": "bar"})
    chart.add_series({
        "name": title,
        "categories": [sheet_name, first_row0, cat_col0, last_row0, cat_col0],
        "values": [sheet_name, first_row0, val_col0, last_row0, val_col0],
    })
    chart.set_title({"name": title})
    chart.set_legend({"none": True})
    ws.insert_chart(anchor, chart, {"x_scale": 1.6, "y_scale": 1.6})
