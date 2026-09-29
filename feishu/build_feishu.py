# -*- coding: utf-8 -*-
"""
构建「飞书版」——复用原版 src/ 与 vendor/，额外注入 feishu/overlay.js。

设计意图：不改动原版任何文件。原版（本地单文件 / GitHub Pages）与飞书版
共用同一套业务代码，飞书版特有的东西（平表 CSV 导出、WebView 适配）
全部集中在 feishu/overlay.js 里，构建时追加到产物末尾。

用法：
    python feishu/build_feishu.py

产物：
    feishu/dist/考公看板-飞书版.html
"""
import io
import os
import re
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import build as base  # noqa: E402  复用原版的 css/js 内联逻辑

OVERLAY = os.path.join(HERE, "overlay.js")
DIST = os.path.join(HERE, "dist")
OUTPUT = os.path.join(DIST, u"考公看板-飞书版.html")


def main():
    if not os.path.isfile(base.ENTRY):
        sys.stderr.write(u"找不到 %s\n" % base.ENTRY)
        return 1
    if not os.path.isfile(OVERLAY):
        sys.stderr.write(u"找不到 %s\n" % OVERLAY)
        return 1

    html = base.read_text(base.ENTRY)

    html, missing = base.inline_local(html)
    if missing:
        sys.stderr.write(u"以下本地资源未找到，未内联: %s\n" % ", ".join(missing))
        return 1
    if re.search(r'<link\s+rel="stylesheet"', html) or re.search(r'<script\s+src="(?!http)', html):
        sys.stderr.write(u"仍存在未内联的本地资源，构建中止。\n")
        return 1

    html, inlined, absent = base.inline_vendor(html)

    # overlay 必须在原版所有脚本之后执行（此时它才能访问 KG.App / KG.UI）
    #
    # 注意：不能用 replace("</body>", ..., 1)。内联的 ECharts / SheetJS 压缩代码里
    # 含有 "</body>" 字符串（HTML 导出相关），全文件出现 3 次，第一次在库内部——
    # 那样会把 overlay 塞进压缩代码中间，脚本根本不会执行。必须取最后一个。
    overlay_js = base.safe_js(base.read_text(OVERLAY))
    idx = html.rfind(u"</body>")
    if idx < 0:
        sys.stderr.write(u"找不到 </body>，无法注入 overlay。\n")
        return 1
    html = (html[:idx]
            + u"<script>\n/* ===== feishu/overlay.js（飞书版增量） ===== */\n%s\n</script>\n" % overlay_js
            + html[idx:])

    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    mode = (u"已内联 " + " + ".join(inlined)) if inlined else u"未内联，运行时回退 CDN"
    banner = (
        u"<!--\n"
        u"  考公练习追踪看板 · 飞书版（单文件）\n"
        u"  由 feishu/build_feishu.py 自动生成，请勿直接修改；改动请改 src/ 或 feishu/overlay.js。\n"
        u"  构建时间：%s\n"
        u"  第三方库：%s\n"
        u"  相对原版的增量：平表 CSV 导出（供飞书多维表格导入）+ 飞书 WebView 适配。\n"
        u"  原版本身未做任何修改，两者共用同一套业务代码。\n"
        u"-->\n" % (stamp, mode)
    )
    html = banner + html

    if not os.path.isdir(DIST):
        os.makedirs(DIST)
    with io.open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    size = os.path.getsize(OUTPUT) / 1024.0
    gz = 0
    try:
        import gzip
        gz = len(gzip.compress(html.encode("utf-8"))) / 1024.0
    except Exception:
        pass

    sys.stdout.write(u"已生成: %s (%.1f KB，gzip 后约 %.0f KB)\n" % (OUTPUT, size, gz))
    sys.stdout.write(u"第三方库: %s\n" % mode)
    sys.stdout.write(u"已注入: feishu/overlay.js（平表 CSV 导出 + WebView 适配）\n")
    if absent:
        sys.stdout.write(u"注意：以下库文件缺失，未内联 -> %s\n" % ", ".join(absent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
