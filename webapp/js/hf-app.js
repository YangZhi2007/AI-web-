/* =============================================================================
 * hf-app.js · 幻觉修复功能区编排层（无训练 RAG 版）
 * 依赖 window.HF（hf.js）。职责：
 *   ① 二级导航高亮（按 body[data-hf-page]）；
 *   ② 探测面板：选择池/模式、运行评测（mock 零外联 / ollama 本地推理）、写 Store 跨页；
 *   ③ 样本溯源：从 Store 恢复，展示 base 幻觉样本 + 成因标签 + 理由；
 *   ④ 评测对比：从 Store 恢复，展示 base vs RAG 幻觉率、四类分组、题目级差异；
 *   ⑤ 真值库：展示训练池/验证池与交集自检。
 * 零外部请求（mock 模式）；用户输入一律 textContent 写入，避免注入。
 * ========================================================================== */
(function () {
  'use strict';
  var H = window.HF;
  if (!H) return;
  var page = document.body.getAttribute('data-hf-page') || 'overview';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function markNav() {
    $$('.hfnav a').forEach(function (a) {
      if (a.getAttribute('data-hf-page') === page) {
        a.classList.add('is-current');
        a.setAttribute('aria-current', 'page');
      }
    });
  }

  /* 结果空态：无评测数据时统一提示去探测面板 */
  function emptyResult(hostSel, goto) {
    var host = $(hostSel);
    if (!host) return false;
    host.innerHTML = '';
    var box = el('div', 'hf-empty');
    box.appendChild(el('b', null, '尚无评测结果'));
    box.appendChild(el('span', null, '先在探测面板运行一次（默认 mock 模式，零外部请求）。'));
    var a = el('a', null, '前往探测面板 →');
    a.href = goto || 'hf-probe.html';
    a.setAttribute('data-nav', '');
    box.appendChild(a);
    host.appendChild(box);
    return true;
  }

  function verdictBadge(v, compact) {
    var s = el('span', compact ? 'hf-dual__v' : 'hf-v', v === 'CONSISTENT' ? '一致' : '幻觉');
    s.setAttribute('data-v', v);
    return s;
  }
  function causeTag(cause) {
    var s = el('span', 'hf-cause', H.CAUSE_CN[cause] || cause);
    s.setAttribute('data-c', cause);
    return s;
  }

  /* ---------- 探测面板 ---------- */
  function bootProbe() {
    var sel = $('#hfPool');
    var run = $('#hfRun');
    var msg = $('#hfRunMsg');
    var wrap = $('#hfProbeResult');
    if (!run) return;
    var mode = 'mock';
    var modeBtns = $$('.hf-mode button');
    modeBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-mode');
        modeBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        var endpointRow = $('#hfEndpointRow');
        var modelRow = $('#hfModelRow');
        if (endpointRow) endpointRow.classList.toggle('hidden', mode !== 'ollama');
        if (modelRow) modelRow.classList.toggle('hidden', mode !== 'ollama');
        if (msg) { msg.textContent = ''; msg.className = 'hf-control__msg'; }
      });
    });
    function say(t, k) { if (msg) { msg.textContent = t || ''; msg.className = 'hf-control__msg' + (k ? ' ' + k : ''); } }
    run.addEventListener('click', function () {
      var pool = (sel && sel.value === 'train') ? H.TRAIN_POOL : H.VALID_POOL;
      if (mode === 'ollama') {
        var ep = $('#hfEndpoint');
        var md = $('#hfModel');
        H.CONFIG.OLLAMA_ENDPOINT = (ep && ep.value.trim()) || H.CONFIG.OLLAMA_ENDPOINT;
        H.CONFIG.MODEL = (md && md.value.trim()) || H.CONFIG.MODEL;
      }
      run.disabled = true;
      say(mode === 'ollama' ? '本地推理进行中，请稍候…' : '批量推理与判定中…');
      H.evaluate(pool, mode).then(function (res) {
        H.Store.set(res);
        renderProbe(res, wrap);
        say('完成 · base 幻觉 ' + res.baseHallu + ' → RAG 幻觉 ' + res.ragHallu, 'ok');
        run.disabled = false;
      }).catch(function (e) {
        say(e && e.message ? e.message : '运行失败', 'err');
        run.disabled = false;
      });
    });
    /* 已有结果则只读回显，否则给明确空态 */
    var cached = H.Store.get();
    if (cached && wrap) renderProbe(cached, wrap);
    else if (wrap) {
      var box = el('div', 'hf-empty');
      box.appendChild(el('b', null, '尚未运行探测'));
      var steps = el('div', 'hf-empty__steps');
      [['01', '选题目池', '验证池 10 题或训练池 12 题'],
       ['02', '定推理模式', 'Mock 零外联，或本地 Ollama'],
       ['03', '开始探测', '双条件逐题判定在此展开']].forEach(function (s) {
        var row = el('div', 'hf-empty__step');
        row.appendChild(el('span', 'mono', s[0]));
        row.appendChild(el('b', null, s[1]));
        row.appendChild(el('span', null, s[2]));
        steps.appendChild(row);
      });
      box.appendChild(steps);
      wrap.appendChild(box);
    }
  }

  function renderProbe(res, host) {
    if (!host) return;
    host.innerHTML = '';
    var head = el('div', 'hf-pool__head');
    head.appendChild(el('h3', null, '逐题判定 · ' + (res.poolName === 'valid' ? '验证池' : '训练池')));
    head.appendChild(el('span', 'hf-pool__meta',
      res.mode === 'mock' ? 'MOCK · 零外部请求' : 'OLLAMA · 本地推理'));
    host.appendChild(head);
    var scroll = el('div', 'tbl-scroll');
    var table = el('table', 'hf-pool');
    var thead = el('thead');
    thead.innerHTML = '<tr><th>题号</th><th>场景</th><th>标准结论</th>' +
      '<th>base 判定</th><th>覆盖率</th><th>RAG 判定</th><th>覆盖率</th></tr>';
    table.appendChild(thead);
    var tbody = el('tbody');
    res.rows.forEach(function (r) {
      var tr = el('tr');
      if (r.base.judge.verdict !== r.rag.judge.verdict) tr.className = 'is-hit';
      [[r.id, 'mono'], [H.CAUSE_CN[r.cat] || r.cat, ''],
       [r.conclusion, ''], ['', 'b'], [r.base.judge.coverage * 100 + '%', 'mono'],
       ['', 'r'], [r.rag.judge.coverage * 100 + '%', 'mono']].forEach(function (c, i) {
        var td = el('td', c[1] === 'mono' ? 'mono' : '');
        if (i === 3) td.appendChild(verdictBadge(r.base.judge.verdict));
        else if (i === 5) td.appendChild(verdictBadge(r.rag.judge.verdict));
        else td.textContent = c[0];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    host.appendChild(scroll);
    var note = el('p', 'boundary-card__foot', res.note);
    host.appendChild(note);
  }

  /* ---------- 样本溯源 ---------- */
  function bootSample() {
    var res = H.Store.get();
    if (!res) { emptyResult('#hfSampleHost', 'hf-probe.html'); return; }
    var host = $('#hfSampleHost');
    if (!host) return;
    host.innerHTML = '';
    var hallu = res.rows.filter(function (r) { return r.base.judge.verdict === 'HALLUCINATION'; });
    if (!hallu.length) {
      host.appendChild(el('p', 'boundary-card__foot', '本次没有 base 幻觉样本。'));
      return;
    }
    /* 按成因分组：10 行不再是一模一样的墙，同类成因聚成一个可读块 */
    var order = ['knowledge', 'logic', 'prompt', 'context'];
    var groupNo = 0;
    order.forEach(function (cause) {
      var group = hallu.filter(function (r) {
        return (r.base.attribution && r.base.attribution.cause) === cause;
      });
      if (!group.length) return;
      groupNo += 1;
      var head = el('div', 'hf-group');
      head.appendChild(el('span', 'hf-group__no', ('0' + groupNo).slice(-2)));
      head.appendChild(el('span', null, H.CAUSE_CN[cause]));
      head.appendChild(el('span', 'hf-group__n', group.length + ' 条'));
      host.appendChild(head);

      group.forEach(function (r) {
        var a = r.base.attribution || { cause: 'knowledge', reason: '—' };
        var d = el('details', 'hf-diff');
        var sum = el('summary');
        sum.appendChild(el('span', 'mono', r.id));
        sum.appendChild(el('span', 'hf-diff__q', r.q));
        /* 双轨 signature：收起态就能看到 base → RAG 的成对结论 */
        var dual = el('span', 'hf-dual');
        dual.appendChild(verdictBadge(r.base.judge.verdict, true));
        dual.appendChild(el('span', 'hf-dual__arrow', '→'));
        dual.appendChild(verdictBadge(r.rag.judge.verdict, true));
        sum.appendChild(dual);
        sum.appendChild(causeTag(a.cause));
        d.appendChild(sum);
        var body = el('div', 'hf-diff__body');
        var pair = el('div', 'hf-diff__pair');
        ['base', 'rag'].forEach(function (k) {
          var col = el('div', 'hf-diff__col');
          col.appendChild(el('h4', null, k === 'base' ? 'BASE 原始输出（无证据）' : 'RAG 输出（注入真值证据）'));
          col.appendChild(el('pre', null, r[k].output));
          col.appendChild(verdictBadge(r[k].judge.verdict));
          pair.appendChild(col);
        });
        body.appendChild(pair);
        var ev = el('p', 'hf-diff__reason', '真值证据：' + H.buildEvidence(r));
        body.appendChild(ev);
        var rs = el('p', 'hf-diff__reason', '归因：' + a.reason);
        body.appendChild(rs);
        d.appendChild(body);
        host.appendChild(d);
      });
    });
  }

  /* ---------- 评测对比 ---------- */
  function bootEval() {
    var res = H.Store.get();
    if (!res) { emptyResult('#hfEvalHost', 'hf-probe.html'); return; }
    var host = $('#hfEvalHost');
    if (!host) return;
    host.innerHTML = '';
    var stats = el('div', 'hf-stats');
    [
      ['BASE 幻觉率', res.baseRate + '%', '无证据 · 契约桩输出'],
      ['RAG 幻觉率', res.ragRate + '%', '注入真值证据 · 无训练'],
      ['下降', res.drop + ' pp', '真实确定性判定算出'],
      ['修复样本', res.fixed + ' / ' + res.total, 'base 幻觉→RAG 一致']
    ].forEach(function (s, i) {
      var d = el('div');
      d.appendChild(el('span', 'lbl', s[0]));
      var b = el('b', i === 2 ? 'is-good' : '', s[1]);
      d.appendChild(b);
      d.appendChild(el('small', null, s[2]));
      stats.appendChild(d);
    });
    host.appendChild(stats);

    var grid = el('div', 'grid-2');
    var cardBars = el('section', 'card');
    cardBars.appendChild(el('h2', 'card-title', '四类场景 · 幻觉率对比'));
    /* 图例：替代每行重复的 BASE / RAG 标签（unslop: 图例一次说清） */
    var legend = el('div', 'hf-legend');
    var l1 = el('span'); l1.appendChild(el('i', 'k-base')); l1.appendChild(document.createTextNode('BASE 无证据'));
    var l2 = el('span'); l2.appendChild(el('i', 'k-rag')); l2.appendChild(document.createTextNode('RAG 注入证据'));
    legend.appendChild(l1); legend.appendChild(l2);
    legend.appendChild(el('span', 'hf-legend__note', '幻觉率 · 越低越好'));
    cardBars.appendChild(legend);
    var bars = el('div', 'hf-bars');
    ['knowledge', 'logic', 'prompt', 'context'].forEach(function (c) {
      var b = res.byCat[c];
      if (!b || !b.total) return;
      var row = el('div', 'hf-bar');
      var head = el('div', 'hf-bar__head');
      head.appendChild(el('b', null, H.CAUSE_CN[c]));
      var meta = el('span', null, 'n=' + b.total + ' · base ' + b.baseRate + '% → rag ' + b.ragRate + '%');
      /* 0% 且基数非零：加「修复」正向文字，避免空轨被误读成没数据 */
      if (b.baseRate > 0 && b.ragRate === 0) {
        meta.appendChild(document.createTextNode(' '));
        var fixed = el('i', 'is-fixed', '已修复');
        fixed.style.fontStyle = 'normal';
        meta.appendChild(fixed);
      }
      head.appendChild(meta);
      row.appendChild(head);
      [['BASE', b.baseRate, 'base'], ['RAG', b.ragRate, 'rag']].forEach(function (seg) {
        var t = el('div', 'hf-bar__track');
        t.appendChild(el('span', 'lbl', seg[0]));
        var rail = el('div', 'hf-bar__rail');
        var fill = el('i', 'hf-bar__fill hf-bar__fill--' + seg[2]);
        fill.style.width = seg[1] + '%';
        rail.appendChild(fill);
        t.appendChild(rail);
        t.appendChild(el('span', 'hf-bar__num', seg[1] + '%'));
        row.appendChild(t);
      });
      bars.appendChild(row);
    });
    cardBars.appendChild(bars);
    grid.appendChild(cardBars);

    var cardScope = el('section', 'card');
    cardScope.appendChild(el('h2', 'card-title', '口径 · 无训练说明'));
    var ul = el('ul', 'hf-scope');
    [
      '全程不训练模型：第 6 环 LoRA 微调由 RAG 真值证据注入替代，模型权重零改动。',
      '判定为独立确定性算法（结论锚点 + 事实点覆盖率），不读模型置信度、不采信模型自证。',
      res.mode === 'mock'
        ? '本次为 MOCK 演示：输出是契约桩预置，判定与下降计算为真实算法，零外部请求。'
        : '本次为本地 Ollama 推理：无训练，base/RAG 两种提示词条件真实调用同一模型。',
      '训练池 ' + H.TRAIN_POOL.length + ' / 验证池 ' + H.VALID_POOL.length +
        ' 物理隔离、编号独立、交集为空；本页用验证池评测。'
    ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
    cardScope.appendChild(ul);
    cardScope.appendChild(el('p', 'hf-scope__foot',
      '标注集 ' + res.label_set + ' · ' + res.version + ' · ' + res.note));
    grid.appendChild(cardScope);
    host.appendChild(grid);
  }

  /* ---------- 真值库 ---------- */
  function bootTruth() {
    var ck = H.checkPools();
    var stats = $('#hfTruthStats');
    if (stats) {
      stats.innerHTML = '';
      [['训练池', ck.train + ' 题', 'T-xx'], ['验证池', ck.valid + ' 题', 'V-xx'],
       ['交集', ck.overlap.length + ' 项', ck.ok ? '物理隔离通过' : '隔离失败'],
       ['标注集', ck.label_set, ck.version]].forEach(function (s) {
        var d = el('div');
        d.appendChild(el('span', 'lbl', s[0]));
        d.appendChild(el('b', null, s[1]));
        d.appendChild(el('small', null, s[2]));
        stats.appendChild(d);
      });
    }
    [['#hfTruthTrain', H.TRAIN_POOL], ['#hfTruthValid', H.VALID_POOL]].forEach(function (pair) {
      var host = $(pair[0]);
      if (!host) return;
      host.innerHTML = '';
      var scroll = el('div', 'tbl-scroll');
      var table = el('table', 'hf-pool');
      var thead = el('thead');
      thead.innerHTML = '<tr><th>编号</th><th>场景</th><th>题面</th><th>标准结论</th><th>关键事实点</th></tr>';
      table.appendChild(thead);
      var tbody = el('tbody');
      pair[1].forEach(function (q) {
        var tr = el('tr');
        [[q.id, 'mono'], [H.CAUSE_CN[q.cat] || q.cat, ''], [q.q, ''],
         [q.conclusion, ''], [q.facts.join(' · '), 'mono']].forEach(function (c) {
          var td = el('td', c[1] === 'mono' ? 'mono' : '');
          td.textContent = c[0];
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      scroll.appendChild(table);
      host.appendChild(scroll);
    });
  }

  function init() {
    markNav();
    if (page === 'probe') bootProbe();
    if (page === 'sample') bootSample();
    if (page === 'eval') bootEval();
    if (page === 'truth') bootTruth();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
