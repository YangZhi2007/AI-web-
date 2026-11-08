const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = 'D:/AIBBBG/Version1/webapp';
const files = ['index.html', 'console.html'];

for (const f of files) {
  const p = path.join(dir, f);
  const html = fs.readFileSync(p, 'utf8');
  console.log('\n========== ' + f + ' (' + html.length + ' bytes) ==========');

  // 1) 外部 <script src>
  const extSrc = [];
  const extRe = /<script[^>]*\bsrc=["']([^"']+)["']/gi;
  let m;
  while ((m = extRe.exec(html))) extSrc.push(m[1]);
  console.log('[依赖] 外部 <script src>:', extSrc.length ? extSrc : '无');

  // 2) 任意外部 URL（http/https）
  const urls = new Set();
  const urlRe = /https?:\/\/[^"'\s<>)]+/gi;
  let u;
  while ((u = urlRe.exec(html))) urls.add(u[1]);
  console.log('[依赖] 外部 URL 列表:', urls.size ? [...urls] : '无');

  // 3) 内联脚本语法编译检查（vm.Script 仅编译，不执行，不触碰 DOM）
  const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let i = 0;
  while ((m = scriptRe.exec(html))) {
    i++;
    const code = m[1];
    let syntax = 'OK';
    try {
      new vm.Script(code, { filename: f + '#inline' + i });
    } catch (e) {
      syntax = 'SYNTAX ERROR: ' + e.message;
    }
    console.log(`[冒烟] 内联脚本#${i}: 长度=${code.length} 语法=${syntax}`);
  }
  console.log('[冒烟] 内联脚本总数:', i);
}
