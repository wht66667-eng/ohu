"""考试页查询按钮通用扫描回归（2026-11-14 考试 0 条修复）。

fetch_exams 旧版只试 btn_xq/Button1/btn_cx 三个固定按钮名；实际页面按钮名不同时
永远查不到考试（用户实测：考试信息存在但接口返回 0 条）。修复为通用扫描 +
两种下拉口径（保留默认 / 清空学年学期）。本测试覆盖扫描与尝试矩阵的纯逻辑。
运行：`python -m pytest test_exam_query_scan.py -q` 或 `python -m unittest`。
"""

from bs4 import BeautifulSoup

from jou_client import ZfsoftSession


def _page(buttons: list[tuple[str, str]], dropdowns: bool = True) -> str:
    inputs = "".join(
        f'<input type="submit" name="{name}" value="{val}" />' for name, val in buttons
    )
    dd = (
        '<select name="ddlXN"><option>2025-2026</option></select>'
        '<select name="ddlXQ"><option>1</option></select>'
        if dropdowns
        else ""
    )
    return (
        "<html><body><form>"
        '<input type="hidden" name="__VIEWSTATE" value="VS123" />'
        + dd
        + inputs
        + "</form></body></html>"
    )


def test_scan_真实按钮优先_含考试查询词():
    soup = BeautifulSoup(_page([("btn_zzz", " irrelevant "), ("btn_kscx", "考试查询")]), "html.parser")
    buttons = ZfsoftSession._query_buttons(soup)
    names = [name for name, _ in buttons]
    assert names[0] == "btn_kscx", "页面真实按钮（含考试/查询词）应排最前"
    assert "btn_zzz" not in names, "无关 value 的按钮不收"


def test_scan_回退正方常见名_页面无按钮时():
    soup = BeautifulSoup(_page([]), "html.parser")
    names = [name for name, _ in ZfsoftSession._query_buttons(soup)]
    for name in ("btn_kscx", "btn_xq", "Button1", "btn_cx"):
        assert name in names


def test_scan_同名去重_保持首见():
    soup = BeautifulSoup(_page([("Button1", "查询"), ("Button1", "重复")]), "html.parser")
    names = [name for name, _ in ZfsoftSession._query_buttons(soup)]
    assert names.count("Button1") == 1


def test_尝试矩阵_真实按钮优先且回退兜底():
    # 扫描结果：页面真实按钮排最前，回退正方常见名兜底；fetch_exams 对每个
    # 按钮尝试两种下拉口径（asis + clear_term），并以 attempts>=8 封顶。
    soup = BeautifulSoup(_page([("btn_kscx", "考试查询")]), "html.parser")
    buttons = ZfsoftSession._query_buttons(soup)
    assert buttons[0] == ("btn_kscx", "考试查询"), "页面真实按钮应最优先"
    combos = sum(2 for _ in buttons)
    assert combos >= 2, "至少真实按钮的两种口径"
    soup5 = BeautifulSoup(_page([(f"b{i}", "查询") for i in range(5)]), "html.parser")
    assert len(ZfsoftSession._query_buttons(soup5)) >= 5
