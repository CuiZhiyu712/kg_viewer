# 部署到 GitHub Pages

## 你的仓库

| | |
| --- | --- |
| 仓库 | `git@github.com:CuiZhiyu712/kg_viewer.git`（**公开**） |
| 站点地址 | https://cuizhiyu712.github.io/kg_viewer/ |
| Pages 来源 | `main` 分支 / `docs` 文件夹 |
| 部署产物 | `docs/index.html`（由 `python build.py` 生成，已内联 ECharts + SheetJS） |

## 一次性配置

1. 推到 GitHub 后，打开仓库 **Settings → Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，文件夹选 **`/docs`**，点 **Save**
4. 等 1~2 分钟，访问 https://cuizhiyu712.github.io/kg_viewer/

## 日常更新

```bash
python build.py          # 改完 src/ 后重新生成 docs/index.html
git add -A
git commit -m "更新看板"
git push
```

Pages 会自动重建（约 1 分钟）。浏览器可能缓存旧版本，用 **Ctrl+F5** 强刷。

## 上线前必须定下来的三件事

**1. 域名 / 协议 / 端口就是用户数据的身份，定了就别改。**
localStorage 按「协议 + 域名 + 端口」隔离，**跟路径无关**：

| 变化 | 用户数据 |
| --- | --- |
| 同域名换新版本、加子目录 | 保留 |
| http → https | **全部丢失** |
| 绑自定义域名（`kaogong.xxx.com`）、换端口 | **全部丢失** |

所以：**想绑自定义域名，请在让用户开始用之前绑好。** 事后换 = 所有人的数据从零开始。

**2. HTTPS 是「绑定数据文件夹」的前提。**
实测（`devtest/test-deploy.js`）：纯 `http://` 下浏览器**根本不提供** `showDirectoryPicker`，
该功能会消失，卡片提示"当前页面不是 https"；其余功能（记录 / 图表 / 导出 / localStorage）不受影响。
GitHub Pages 默认就是 https，所以没问题。

**3. 免费账号的私有仓库不能开 Pages**（需要 Pro / Team）。
你的是公开仓库，没问题——但这也意味着**页面和里面的初始数据对所有人可见**（见下）。

## 数据可见性

仓库公开 → 以下内容公开可见：

- `docs/index.html`（网站本身）
- `src/js/seed.js` 里内置的那条初始数据：2026-09-19 第29季 58.5 分及各模块正确率
- 如果提交了 `套卷复盘....xlsx`，那份原始表格也会公开

**用户后续自己录入的数据不会上传**——它们只存在各自浏览器的 localStorage / 本地 JSON 里，
和这个仓库无关。所以仓库里永远只有那一条初始数据。

## 迁移你自己的现有数据

你现在这份数据在 `file://` 这个 origin 下，和新站点是**两套互不相通**的存储：

1. 双击本地 `考公练习追踪看板.html` → 点「数据备份」，导出 JSON
2. 打开 `https://cuizhiyu712.github.io/kg_viewer/` → 点「数据恢复」，选那个 JSON

## 上线后自检

- [ ] 页面顶部**没有**黄色告警条（说明内联的库都正常）
- [ ] 「模块二 / 三 / 四」的图表都画得出来
- [ ] 新增一条记录 → 刷新 → 还在
- [ ] 「导出 XLSX」能下载，用 Excel 打开结构正常
- [ ] 在 https 下点「绑定数据文件夹」能呼出系统选择框

## 可以直接转给用户的话

> 在线版地址（手机用这个，微信里点开即可）：
> **https://cuizhiyu712.github.io/kg_viewer/**
>
> - 数据**只存在你自己这台设备的这个浏览器里**，服务器不存任何数据，我们也看不到。
> - 换设备 / 换浏览器 / 清理浏览数据 → 数据就看不到了。请定期用「数据备份」导出 JSON 保存。
> - 建议第一次打开就点「绑定数据文件夹」，选中一个固定目录（比如新建一个 `考公数据` 文件夹），
>   之后每次改动都会自动写成 JSON 文件，方便备份。
>   （这个功能需要 Chrome 或 Edge；安卓手机需要 Chrome 132 以上；iPhone 上的浏览器都不支持，
>   只能用「数据备份」。）
> - 同一台设备上如果多人共用同一个浏览器，会互相看到并覆盖对方的数据。
> - 跨设备同步做不到——数据不经过服务器，这是隐私换来的代价。
> - **iPhone 用户注意**：如果连续 7 天没有打开过这个页面，Safari 可能会清掉本地数据。
>   请把页面「添加到主屏幕」当 App 用（这样不受限制），或者定期用「数据备份」。

## 备选托管

同一份 `docs/index.html` 可以直接搬到其他静态托管，无需改动：

- **Cloudflare Pages / Vercel / Netlify**：拖拽上传，自动 HTTPS，国内访问通常比 github.io 稳
- **阿里云 OSS / 腾讯云 COS**：开静态网站托管 + 绑自定义域名 + 传证书才能拿到 https
- **自己的服务器 nginx**：丢进目录 + certbot 签证书

⚠️ **换托管 = 换域名 = 换 origin**，老用户的本地数据不会跟过去。所以托管选型也要一次定好。
