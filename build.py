# -*- coding: utf-8 -*-
"""
把 src/ 下的多文件源码内联成单文件 考公练习追踪看板.html。

用法：
    python build.py

规则：
  <link rel="stylesheet" href="css/x.css">  ->  <style> ... </style>
  <script src="js/x.js"></script>          ->  <script> ... </script>
  <!-- vendor-libs -->                     ->  内联 vendor/ 下的 ECharts / SheetJS

vendor/ 下若缺少库文件，则跳过内联（页面回退到 CDN 加载，见 index.html 里的 KGLoadLibs）。
内联后的库被 <!-- VENDOR-LIB-BEGIN --> / <!-- VENDOR-LIB-END --> 包住，
测试脚本据此剥离它们以注入受控替身（jsdom 没有 canvas，跑不了真的 ECharts）。

JS 内容中的 </script> 会被转义，避免提前闭合脚本标签。
"""
import io
import os
import re
import sys
import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
ENTRY = os.path.join(SRC, "index.html")
OUTPUT = os.path.join(ROOT, "考公练习追踪看板.html")
# GitHub Pages 只支持「根目录」或「/docs」两种来源，用 docs/ 把产物和源码分开
DIST = os.path.join(ROOT, "docs")

# 内联顺序即执行顺序
VENDOR_FILES = [
    ("vendor/echarts.min.js", "ECharts"),
    ("vendor/xlsx.full.min.js", "SheetJS"),
]
VENDOR_PLACEHOLDER = "<!-- vendor-libs -->"
VENDOR_BEGIN = "<!-- VENDOR-LIB-BEGIN -->"
VENDOR_END = "<!-- VENDOR-LIB-END -->"

LINK_RE = re.compile(r'[ \t]*<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>\s*')
SCRIPT_RE = re.compile(r'[ \t]*<script\s+src="([^"]+)"></script>\s*')


def read_text(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return f.read()


def safe_js(code):
    return code.replace("</script>", "<\\/script>")


def inline_local(html):
    """内联 css / js"""
    missing = []

    def css_repl(m):
        rel = m.group(1)
        path = os.path.join(SRC, rel.replace("/", os.sep))
        if not os.path.isfile(path):
            missing.append(rel)
            return m.group(0)
        return u"<style>\n/* ===== %s ===== */\n%s\n</style>\n" % (rel, read_text(path))

    def js_repl(m):
        rel = m.group(1)
        path = os.path.join(SRC, rel.replace("/", os.sep))
        if not os.path.isfile(path):
            missing.append(rel)
            return m.group(0)
        return u"<script>\n/* ===== %s ===== */\n%s\n</script>\n" % (rel, safe_js(read_text(path)))

    html = LINK_RE.sub(css_repl, html)
    html = SCRIPT_RE.sub(js_repl, html)
    return html, missing


def inline_vendor(html):
    """把 ECharts / SheetJS 内联进去，返回 (html, 已内联的库名列表, 缺失的库文件列表)"""
    present, absent = [], []
    for rel, name in VENDOR_FILES:
        path = os.path.join(ROOT, rel.replace("/", os.sep))
        if os.path.isfile(path):
            present.append((path, rel, name))
        else:
            absent.append(rel)

    if not present:
        return html.replace(VENDOR_PLACEHOLDER, u"<!-- 未找到 vendor/ 下的库文件，运行时回退到 CDN 加载 -->"), [], absent

    blocks = [VENDOR_BEGIN]
    for path, rel, name in present:
        blocks.append(u"<script>\n/* ===== %s（%s，内联） ===== */\n%s\n</script>" % (name, rel, safe_js(read_text(path))))
    blocks.append(VENDOR_END)
    html = html.replace(VENDOR_PLACEHOLDER, u"\n".join(blocks))
    return html, [n for _, _, n in present], absent


def write(path, text):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def main():
    if not os.path.isfile(ENTRY):
        sys.stderr.write(u"找不到入口文件: %s\n" % ENTRY)
        return 1

    html = read_text(ENTRY)
    html, missing = inline_local(html)
    if missing:
        sys.stderr.write(u"以下本地资源未找到，未内联: %s\n" % ", ".join(missing))
        return 1

    if re.search(r'<link\s+rel="stylesheet"', html) or re.search(r'<script\s+src="(?!http)', html):
        sys.stderr.write(u"仍存在未内联的本地资源，构建中止。\n")
        return 1

    html, inlined, absent = inline_vendor(html)

    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    mode = (u"已内联 " + " + ".join(inlined)) if inlined else u"未内联，运行时回退 CDN"
    banner = (
        u"<!--\n"
        u"  考公练习追踪看板（单文件版）· © 2026 CZY 保留所有权利\n"
        u"  未经作者授权，禁止转售、禁止商业使用、禁止去除本声明。\n"
        u"  由 build.py 自动生成，请勿直接修改本文件；改动请修改 src/ 后重新构建。\n"
        u"  构建时间：%s\n"
        u"  第三方库：%s\n"
        u"  数据来源：仅使用「套卷复盘」XLSX 的第一个 Sheet（粉笔模考）。\n"
        u"  用户数据保存在各自浏览器的 localStorage；绑定数据文件夹后另存为本地 JSON。\n"
        u"-->\n" % (stamp, mode)
    )
    html = banner + html

    write(OUTPUT, html)
    # GitHub Pages 等静态托管需要入口文件名为 index.html，顺手出一份
    write(os.path.join(DIST, "index.html"), html)
    # 关掉 GitHub Pages 的 Jekyll 处理：内联的库里有大量花括号，
    # 一旦出现 {{ }} 会被 Jekyll 当模板变量吃掉，把 JS 改坏。
    write(os.path.join(DIST, ".nojekyll"), u"")

    size = os.path.getsize(OUTPUT) / 1024.0
    gz = 0
    try:
        import gzip
        gz = len(gzip.compress(html.encode("utf-8"))) / 1024.0
    except Exception:
        pass
    sys.stdout.write(u"已生成: %s (%.1f KB，gzip 后约 %.0f KB)\n" % (os.path.basename(OUTPUT), size, gz))
    sys.stdout.write(u"已生成: docs/index.html（GitHub Pages 部署用，Pages 来源选 main /docs）\n")
    sys.stdout.write(u"第三方库: %s\n" % mode)
    if absent:
        sys.stdout.write(u"注意：以下库文件缺失，未内联 -> %s\n" % ", ".join(absent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
