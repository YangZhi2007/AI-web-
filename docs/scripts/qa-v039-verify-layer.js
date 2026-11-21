/**
 * qa-v039 —— 洞鉴「身 · 客观验证层」验收（3 号机交付）
 *
 * 验证 verify.py（文档第 4.2 节契约）：
 *   ① 四类 vuln_type 分发到正确验证器；
 *   ② 裁决只来自靶机响应，reason/confidence 不参与（改模型字段不改裁决）；
 *   ③ SQL 注入用 # 注释、绝不出现 -- 截断（防假阴性）；
 *   ④ 统一输出四字段结构、verdict 仅三态；
 *   ⑤ 未知类型/缺 verify_method 落 error 而非 confirmed；
 *   ⑥ 真靶机异常落 error；
 *   ⑦ CLI：DEMO 模式标注、逐行日志、退出码 0、evidence.json 落盘；
 *   ⑧ 零外联（DEMO 模式不发起任何真实网络请求）。
 *
 * 依赖：本机 python3（无第三方包）。
 */

'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PY = process.env.PY_BIN || 'python3';
const VERIFY = path.resolve(__dirname, '../../ai_pentest/verify.py');
const EVIDENCE = path.resolve(__dirname, '../../ai_pentest/evidence.json');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? '  → ' + detail : '')); }
}

/** 通过给 verify.py 注入的探针脚本，批量取回验证器函数在给定假靶机下的裁决。 */
function probe(cases) {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.dirname(VERIFY))})
import verify as V

# 可编程假靶机：按 label 返回指定响应
def http_factory(behavior):
    def f(method, params, target):
        if behavior == 'raise':
            raise RuntimeError('模拟网络故障')
        if behavior == 'xss_escaped':
            return V.HttpResponse(200, 'ESCAPED &lt;img', 0.05)
        if behavior == 'no_diff':
            return V.HttpResponse(200, 'LOGIN_FAIL invalid', 0.05)
        if behavior == 'normal':
            return V.HttpResponse(200, 'OK', 0.05)
        return V.HttpResponse(200, 'OK', 0.05)
    return f

out = {}
for c in json.loads(sys.stdin.read()):
    h = c['hypothesis']
    fn = V.DISPATCH.get(V.normalize_kind(h.get('vuln_type','')), None) if h.get('verify_method') else None
    if fn is None:
        res = V.err_result(h.get('id','?'), '无', '探针：无分发')
    else:
        res = fn(h, http_factory(c.get('behavior','normal')))
    out[c['label']] = res
print(json.dumps(out, ensure_ascii=False))
`;
  const r = spawnSync(PY, ['-c', script], {
    input: JSON.stringify(cases), encoding: 'utf-8', timeout: 30000,
  });
  if (r.status !== 0) throw new Error('探针执行失败: ' + r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

console.log('=== qa-v039 客观验证层验收 ===\n');

// ---------- ① ④ 分发 + 统一结构 ----------
const base = [
  { label: 'sqli',        hypothesis: { id: 'H1', vuln_type: 'SQL 注入',    verify_method: '布尔盲注' }, behavior: 'sqli' },
  { label: 'xss',         hypothesis: { id: 'H2', vuln_type: '存储型 XSS', verify_method: '标记回显' }, behavior: 'xss_hit' },
  { label: 'price',       hypothesis: { id: 'H3', vuln_type: '改价逻辑',   verify_method: '改价' },     behavior: 'price_hit' },
  { label: 'idor',        hypothesis: { id: 'H4', vuln_type: '越权（IDOR）', verify_method: '越权' },   behavior: 'idor_hit' },
];
// 让探针的假靶机识别各验证器特征（按 request 内容返回命中响应）。
const script2 = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.dirname(VERIFY))})
import verify as V
def f(method, params, target):
    body = params.get('form',{}).get('username','')+params.get('form',{}).get('comment','')
    path = params.get('path','')
    q = params.get('query','')
    if 'sqli_true' in body: return V.HttpResponse(200, 'LOGIN_OK welcome', 0.1)
    if 'sqli_false' in body: return V.HttpResponse(200, 'LOGIN_FAIL', 0.1)
    if 'xss_marker' in body: return V.HttpResponse(200, 'saved', 0.1)
    if 'product' in path and 'xss_marker' in q:
        mk = q.split('xss_marker=',1)[1].split('&')[0]
        return V.HttpResponse(200, '<img src=x> '+mk, 0.1)
    if 'cart' in path and 'price' in params.get('form',{}): return V.HttpResponse(200, 'TOTAL=1', 0.1)
    if 'order.php' in path and 'uid' in q: return V.HttpResponse(200, 'ORDER_OF_OTHER_USER', 0.1)
    return V.HttpResponse(200, 'OK', 0.1)
cases = json.loads(sys.stdin.read())
out = {}
for c in cases:
    h=c['hypothesis']
    fn=V.DISPATCH.get(V.normalize_kind(h.get('vuln_type','')),None) if h.get('verify_method') else None
    out[c['label']] = (fn(h,f) if fn else V.err_result(h['id'],'无','无分发'))
print(json.dumps(out,ensure_ascii=False))
`;
function runScript2(cases) {
  const r = spawnSync(PY, ['-c', script2], { input: JSON.stringify(cases), encoding: 'utf-8', timeout: 30000 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

try {
  const res = runScript2(base);
  check('四类漏洞分发后均 confirmed（假靶机命中）',
    ['sqli','xss','price','idor'].every(k => res[k] && res[k].verdict === 'confirmed'),
    JSON.stringify(Object.fromEntries(Object.entries(res).map(([k,v])=>[k,v.verdict]))));
  for (const k of ['sqli','xss','price','idor']) {
    const r = res[k];
    check(k + ' 输出为四字段统一结构',
      r && ['hypothesis_id','verdict','evidence','verified_at'].every(f => Object.prototype.hasOwnProperty.call(r, f)) &&
      ['request','response','diff','elapsed'].every(f => Object.prototype.hasOwnProperty.call(r.evidence, f)),
      JSON.stringify(r && Object.keys(r)));
  }
} catch (e) { check('四类分发探针可执行', false, e.message); }

// ---------- ③ SQL 用 # 不用 -- ----------
try {
  const sql = runScript2([base[0]]).sqli;
  check('SQL 载荷使用 # 注释闭合', /#/.test(sql.evidence.request), sql.evidence.request);
  check('SQL 载荷不含 -- 截断注释', !/--/.test(sql.evidence.request), sql.evidence.request);
} catch (e) { check('SQL 注释探针可执行', false, e.message); }

// ---------- ② 裁决不读 reason/confidence ----------
try {
  const script3 = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.dirname(VERIFY))})
import verify as V
def f(method, params, target):
    b=params.get('form',{}).get('username','')
    if 'sqli_true' in b: return V.HttpResponse(200,'LOGIN_OK',0.1)
    if 'sqli_false' in b: return V.HttpResponse(200,'LOGIN_FAIL',0.1)
    return V.HttpResponse(200,'OK',0.1)
h1={'id':'A','vuln_type':'SQL 注入','verify_method':'x','reason':'','confidence':'低'}
h2=dict(h1); h2['id']='B'; h2['reason']='看起来百分百是真的'; h2['confidence']='极高'
r1=V.verify_sqli(h1,f); r2=V.verify_sqli(h2,f)
print(json.dumps([r1['verdict'],r2['verdict']]))
`;
  const r = spawnSync(PY, ['-c', script3], { encoding: 'utf-8', timeout: 30000 });
  if (r.status !== 0) throw new Error(r.stderr);
  const verdicts = JSON.parse(r.stdout.trim().split('\n').pop());
  check('改 reason/confidence 不改变裁决（不读模型自证）',
    verdicts[0] === verdicts[1], JSON.stringify(verdicts));
} catch (e) { check('独立性探针可执行', false, e.message); }

// ---------- ⑤ 未知类型 / 缺字段落 error ----------
try {
  const edge = probe([
    { label: 'unknown', hypothesis: { id: 'U', vuln_type: '零日未知洞', verify_method: 'x' }, behavior: 'normal' },
    { label: 'missing', hypothesis: { id: 'M', vuln_type: 'SQL 注入' }, behavior: 'normal' },
  ]);
  check('未知漏洞类型落 error（不猜 confirmed）', edge.unknown && edge.unknown.verdict === 'error', JSON.stringify(edge.unknown));
  check('缺 verify_method 落 error（文档「缺失即丢弃」）', edge.missing && edge.missing.verdict === 'error', JSON.stringify(edge.missing));
} catch (e) { check('边界探针可执行', false, e.message); }

// ---------- ⑥ 真靶机异常落 error ----------
try {
  const ex = probe([{ label: 'net', hypothesis: { id: 'N', vuln_type: 'SQL 注入', verify_method: 'x' }, behavior: 'raise' }]);
  check('网络异常落 error（不猜结论）', ex.net && ex.net.verdict === 'error', JSON.stringify(ex.net));
} catch (e) { check('异常探针可执行', false, e.message); }

// ---------- ⑦ CLI DEMO 模式 ----------
{
  const env = Object.assign({}, process.env, { DJ_MOCK: '1', TARGET_URL: '' });
  delete env.PY_BIN;
  const r = spawnSync(PY, ['-u', VERIFY], { env, encoding: 'utf-8', timeout: 30000 });
  check('CLI 退出码 0', r.status === 0, 'status=' + r.status + ' stderr=' + r.stderr);
  check('CLI 逐行日志含「完成第 N/M 条」', /完成第 \d+\/\d+ 条/.test(r.stdout), r.stdout.slice(0, 200));
  check('CLI 标注 DEMO 非真实裁决', /DEMO/.test(r.stdout) && /非真实裁决/.test(r.stdout), r.stdout.slice(0, 200));
  check('evidence.json 已落盘', fs.existsSync(EVIDENCE));
  if (fs.existsSync(EVIDENCE)) {
    const d = JSON.parse(fs.readFileSync(EVIDENCE, 'utf-8'));
    check('产物 demo 标记为 true', d.demo === true, 'demo=' + d.demo);
    check('产物 summary 三态计数齐全',
      d.summary && typeof d.summary.total === 'number' &&
      typeof d.summary.confirmed === 'number' && typeof d.summary.rejected === 'number' &&
      typeof d.summary.error === 'number', JSON.stringify(d.summary));
    check('产物 findings 全部为四字段结构',
      Array.isArray(d.findings) && d.findings.length > 0 &&
      d.findings.every(f => ['hypothesis_id','verdict','evidence','verified_at'].every(k => Object.prototype.hasOwnProperty.call(f, k))));
  }
}

// ---------- ⑧ 零外联：DEMO 模式源码路径检查 ----------
try {
  const src = fs.readFileSync(VERIFY, 'utf-8');
  check('DEMO 分支使用 demo_http_factory 而非 real_http',
    /demo\s*=\s*mock\s+or\s+demo_from_file/.test(src) &&
    /demo_http_factory\(TARGET\)\s*if\s*demo\s*else\s*real_http/.test(src));
  check('脚本不依赖 requests 第三方包', !/import requests/.test(src));
} catch (e) { check('源码检查可执行', false, e.message); }

console.log('\n合计: ' + pass + '/' + (pass + fail) + ' PASS');
if (fail > 0) process.exit(1);
