/* 读取构建产物，并按标记剥离内联的第三方库。
 *
 * 为什么需要：ECharts 内联进单文件后，jsdom 会真的执行它，而 jsdom 没有 canvas，
 * 一旦 app 调用 echarts.init() 就会抛错。jsdom 测试只需要一个受控的假实例
 * （用来校验「配置构造」是否正确），所以把真正的库剥掉再加载。
 * 真实浏览器（test-browser.js）不剥离，跑的就是完整产物。
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '考公练习追踪看板.html');
const VENDOR_RE = /<!-- VENDOR-LIB-BEGIN -->[\s\S]*?<!-- VENDOR-LIB-END -->/;

function loadHtml() {
  const raw = fs.readFileSync(APP, 'utf8');
  const m = raw.match(VENDOR_RE);
  return {
    html: raw.replace(VENDOR_RE, '<!-- 内联库已在 jsdom 测试中剥离 -->'),
    /** 被剥掉的字节数；为 0 说明这次构建没有内联库（CDN 模式） */
    strippedBytes: m ? m[0].length : 0,
    rawBytes: raw.length,
  };
}

module.exports = loadHtml;
module.exports.APP = APP;
