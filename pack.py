# -*- coding: utf-8 -*-
"""
打包两个 zip：

  分享版   给人「用 + 看源码」，含完整源码目录
  使用者版 只给人「用」，只有单文件 + 使用说明（微信直接发这个）

用法：
    python build.py     # 先构建
    python pack.py      # 再打包

产物都在 分享版/ 目录下，文件名带日期。

两个包都会排除私人数据：data/*.json（我的真实数据）、*.xlsx（原始表格）、
node_modules、测试截图、.git、.claude。
"""
import io
import os
import shutil
import sys
import datetime
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(ROOT, "分享版")
APP_HTML = u"考公练习追踪看板.html"
USER_DOC = u"使用说明.txt"

# 源码包里的内容（打开「源码/」子目录）
SRC_ITEMS = [
    u"src", u"vendor", u"devtest", u"feishu",
    u"build.py", u"pack.py", u"README.md", u"DEPLOY.md", u".gitignore",
]

SKIP_DIRS = {"node_modules", "shots", "dist", "__pycache__", ".git", ".vscode", ".idea", ".claude"}
SKIP_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}
SKIP_SUFFIX = (".pyc",)

PACKAGES = [
    {
        "zip_prefix": u"考公练习追踪看板-分享版",
        "top": u"考公练习追踪看板-分享版",
        "with_source": True,
        "desc": u"使用者 + 开发者",
    },
    {
        "zip_prefix": u"考公练习追踪看板-使用者版",
        "top": u"考公练习追踪看板",
        "with_source": False,
        "desc": u"只给使用者",
    },
]


def ignored(dirpath, names):
    out = []
    for n in names:
        if n in SKIP_DIRS or n in SKIP_FILES or n.endswith(SKIP_SUFFIX):
            out.append(n)
        elif n == "kaogong_data.json" or n.endswith(".xlsx"):
            out.append(n)   # 私人数据，绝不打包
    return out


def copy_tree(src, dst):
    shutil.copytree(src, dst, ignore=ignored)


def write_text_with_bom(src, dst):
    """文本说明加 UTF-8 BOM：Windows 记事本 / 旧版编辑器能正确识别中文，
    否则可能显示乱码。只对 .txt 这样做。"""
    with io.open(src, "r", encoding="utf-8") as f:
        text = f.read()
    with io.open(dst, "w", encoding="utf-8-sig", newline="\r\n") as f:
        f.write(text)


def build_package(pkg, stamp):
    base = os.path.join(OUTDIR, pkg["top"])
    os.makedirs(base)

    html_src = os.path.join(ROOT, APP_HTML)
    if not os.path.isfile(html_src):
        raise IOError(u"找不到 %s，请先运行 python build.py" % APP_HTML)
    shutil.copy2(html_src, os.path.join(base, APP_HTML))

    doc_src = os.path.join(ROOT, USER_DOC)
    if not os.path.isfile(doc_src):
        raise IOError(u"找不到 %s" % USER_DOC)
    write_text_with_bom(doc_src, os.path.join(base, USER_DOC))

    if pkg["with_source"]:
        src_dir = os.path.join(base, u"源码")
        os.makedirs(src_dir)
        for rel in SRC_ITEMS:
            s = os.path.join(ROOT, rel)
            d = os.path.join(src_dir, rel)
            if os.path.isdir(s):
                copy_tree(s, d)
            elif os.path.isfile(s):
                shutil.copy2(s, d)
            else:
                sys.stderr.write(u"警告: 缺少 %s（已跳过）\n" % rel)

    zip_name = u"%s-%s.zip" % (pkg["zip_prefix"], stamp)
    zip_path = os.path.join(OUTDIR, zip_name)

    n = 0
    raw = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in sorted(filenames):
                if fn in SKIP_FILES or fn.endswith(SKIP_SUFFIX):
                    continue
                full = os.path.join(dirpath, fn)
                arc = os.path.join(pkg["top"], os.path.relpath(full, base)).replace(os.sep, "/")
                z.write(full, arc)
                n += 1
                raw += os.path.getsize(full)

    return {
        "name": zip_name,
        "files": n,
        "zip_mb": os.path.getsize(zip_path) / 1024.0 / 1024.0,
        "raw_mb": raw / 1024.0 / 1024.0,
        "desc": pkg["desc"],
    }


def main():
    if os.path.isdir(OUTDIR):
        shutil.rmtree(OUTDIR)
    os.makedirs(OUTDIR)

    stamp = datetime.datetime.now().strftime("%Y-%m-%d")
    results = []
    try:
        for pkg in PACKAGES:
            results.append(build_package(pkg, stamp))
    except IOError as e:
        sys.stderr.write(u"%s\n" % e)
        return 1

    sys.stdout.write(u"打包完成（目录: 分享版\\）\n\n")
    for r in results:
        sys.stdout.write(u"  %s\n" % r["name"])
        sys.stdout.write(u"     %d 个文件，压缩包 %.1f MB（解压后 %.1f MB）· %s\n"
                         % (r["files"], r["zip_mb"], r["raw_mb"], r["desc"]))
    sys.stdout.write(u"\n  两个包都已排除: 我的考试数据 / 原始表格 / node_modules / 截图 / git\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
