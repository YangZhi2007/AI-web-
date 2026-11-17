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

  /* ---------- 04 证据库管理：真值库 → 可注入证据条目 ---------- */
  function bootEvidence() {
    var all = H.TRAIN_POOL.concat(H.VALID_POOL);
    var stats = $('#hfEvStats');
    if (stats) {
      stats.innerHTML = '';
      [['证据条目', all.length + ' 条', '每条含结论 + 关键事实'],
       ['来源', '2 池', '训练池 ' + H.TRAIN_POOL.length + ' · 验证池 ' + H.VALID_POOL.length],
       ['注入方式', 'RAG', '推理时拼入提示词'],
       ['版本', H.CONFIG.VERSION, '标注集 ' + H.CONFIG.LABEL_SET]].forEach(function (s) {
        var d = el('div');
        d.appendChild(el('span', 'lbl', s[0]));
        d.appendChild(el('b', null, s[1]));
        d.appendChild(el('small', null, s[2]));
        stats.appendChild(d);
      });
    }
    var list = $('#hfEvList');
    var preview = $('#hfEvPreview');
    if (!list) return;
    list.innerHTML = '';
    var meta = $('#hfEvMeta');
    if (meta) meta.textContent = all.length + ' 条 · 点击预览';
    var first = null;
    all.forEach(function (q, i) {
      var b = el('button', 'hf-ev-item');
      b.type = 'button';
      b.appendChild(el('span', 'mono hf-ev-item__id', q.id));
      b.appendChild(el('span', 'hf-ev-item__concl', q.conclusion));
      b.appendChild(causeTag(q.cat));
      b.addEventListener('click', function () {
        $$('.hf-ev-item').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        renderEvidencePreview(q, preview);
      });
      if (i === 0) first = b;
      list.appendChild(b);
    });
    if (first) first.classList.add('is-active');
    if (first && preview) renderEvidencePreview(H.TRAIN_POOL[0], preview);
  }

  function renderEvidencePreview(q, preview) {
    if (!preview) return;
    preview.innerHTML = '';
    var head = el('div', 'hf-ev-prev__head');
    head.appendChild(el('span', 'mono', q.id));
    head.appendChild(causeTag(q.cat));
    preview.appendChild(head);
    preview.appendChild(el('h3', 'hf-ev-prev__q', q.q));
    var factBox = el('div', 'hf-ev-prev__facts');
    factBox.appendChild(el('span', 'lbl', '关键事实点 · ' + q.facts.length));
    var chips = el('div', 'hf-ev-prev__chips');
    q.facts.forEach(function (f) { chips.appendChild(el('span', 'hf-chip', f)); });
    factBox.appendChild(chips);
    preview.appendChild(factBox);
    preview.appendChild(el('div', 'hf-ev-prev__lbl', '生成的注入证据（buildEvidence）'));
    var pre = el('pre', 'hf-ev-prev__code', H.buildEvidence(q));
    preview.appendChild(pre);
    preview.appendChild(el('div', 'hf-ev-prev__lbl', '完整提示词条件（makePrompt · 含证据）'));
    var pre2 = el('pre', 'hf-ev-prev__code', H.makePrompt(q, true));
    preview.appendChild(pre2);
    preview.appendChild(el('p', 'boundary-card__foot',
      '来源：' + (q.id.indexOf('T-') === 0 ? '训练池' : '验证池') + ' · 该证据在 base 条件不注入，在 RAG 条件注入；判定不读证据命中以外的任何模型信号。'));
  }

  /* ---------- 05 修复记录：逐题判定轨迹 + 证据命中（不虚构耗时） ---------- */
  function bootRepair() {
    var res = H.Store.get();
    if (!res) { emptyResult('#hfRepairHost', 'hf-probe.html'); return; }
    var host = $('#hfRepairHost');
    if (!host) return;
    host.innerHTML = '';
    var stats = el('div', 'hf-stats');
    [['推理条件', '2 种', 'base 无证据 / RAG 有证据'],
     ['已完成判定', (res.total * 2) + ' 次', '逐题双条件'],
     ['修复样本', res.fixed + ' 条', 'base 幻觉 → RAG 一致'],
     ['耗时读数', '未采集', res.mode === 'mock' ? 'mock 演示 · 不虚构毫秒' : '本地推理 · 未记录耗时']].forEach(function (s) {
      var d = el('div');
      d.appendChild(el('span', 'lbl', s[0]));
      d.appendChild(el('b', null, s[1]));
      d.appendChild(el('small', null, s[2]));
      stats.appendChild(d);
    });
    host.appendChild(stats);

    var card = el('section', 'card');
    card.appendChild(el('h2', 'card-title', '逐题修复轨迹'));
    var legend = el('div', 'hf-legend');
    var l1 = el('span'); l1.appendChild(el('i', 'k-base')); l1.appendChild(document.createTextNode('BASE 判定'));
    var l2 = el('span'); l2.appendChild(el('i', 'k-rag')); l2.appendChild(document.createTextNode('RAG 判定'));
    legend.appendChild(l1); legend.appendChild(l2);
    legend.appendChild(el('span', 'hf-legend__note', '命中 = 事实点命中数 / 总数'));
    card.appendChild(legend);

    var scroll = el('div', 'tbl-scroll');
    var table = el('table', 'hf-pool hf-repair');
    var thead = el('thead');
    thead.innerHTML = '<tr><th>题号</th><th>场景</th><th>BASE 判定</th><th>命中</th><th>RAG 判定</th><th>命中</th><th>结果</th></tr>';
    table.appendChild(thead);
    var tbody = el('tbody');
    res.rows.forEach(function (r) {
      var tr = el('tr');
      var fixed = r.base.judge.verdict === 'HALLUCINATION' && r.rag.judge.verdict === 'CONSISTENT';
      if (fixed) tr.className = 'is-hit';
      var cells = [
        [r.id, 'mono'], [H.CAUSE_CN[r.cat] || r.cat, '']
      ];
      cells.forEach(function (c) {
        var td = el('td', c[1]); td.textContent = c[0]; tr.appendChild(td);
      });
      // BASE 判定 + 命中
      tr.appendChild(judgeCell(r.base.judge));
      tr.appendChild(hitCell(r.base.judge));
      // RAG 判定 + 命中
      tr.appendChild(judgeCell(r.rag.judge));
      tr.appendChild(hitCell(r.rag.judge));
      // 结果
      var tdR = el('td');
      var tag = el('span', 'hf-repair__result',
        fixed ? '已修复' : (r.base.judge.verdict === 'CONSISTENT' ? '原本一致' : '未修复'));
      tag.setAttribute('data-r', fixed ? 'fixed' : (r.base.judge.verdict === 'CONSISTENT' ? 'ok' : 'no'));
      tdR.appendChild(tag);
      tr.appendChild(tdR);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    card.appendChild(scroll);
    card.appendChild(el('p', 'boundary-card__foot',
      '命中为确定性事实点比对结果（' + H.CONFIG.COVERAGE_THRESHOLD * 100 + '% 覆盖率阈值）；耗时与显存读数仅在真实本地推理并采集后才有意义，演示态如实留空。'));
    host.appendChild(card);
  }

  function judgeCell(j) {
    var td = el('td');
    td.appendChild(verdictBadge(j.verdict, true));
    return td;
  }
  function hitCell(j) {
    var td = el('td', 'mono hf-repair__hit');
    td.textContent = j.factHits.length + '/' + j.facts.length;
    return td;
  }

  /* ---------- 06 版本对比：base / RAG 提示词条件真实 diff ---------- */
  function bootVersion() {
    var sel = $('#hfVQ');
    var host = $('#hfVersionHost');
    if (!sel || !host) return;
    var all = H.TRAIN_POOL.concat(H.VALID_POOL);
    sel.innerHTML = '';
    all.forEach(function (q) {
      var o = el('option', null, q.id + ' · ' + q.q);
      o.value = q.id;
      sel.appendChild(o);
    });
    sel.value = H.VALID_POOL[0].id;
    function render(id) {
      var q = all.filter(function (x) { return x.id === id; })[0] || all[0];
      host.innerHTML = '';
      var grid = el('div', 'grid-2 hf-ver-grid');
      var specs = [
        { k:'base', t:'BASE 条件', desc:'无证据 · 仅题面', prompt:H.makePrompt(q, false),
          meta:['证据注入', '关闭', '模型权重', '零改动'] },
        { k:'rag', t:'RAG 条件', desc:'推理时注入真值证据', prompt:H.makePrompt(q, true),
          meta:['证据注入', '开启', '模型权重', '零改动'] }
      ];
      specs.forEach(function (s) {
        var card = el('section', 'card hf-ver-card hf-ver-card--' + s.k);
        var h = el('h2', 'card-title', s.t);
        card.appendChild(h);
        card.appendChild(el('p', 'hf-ver-card__desc', s.desc));
        var kv = el('div', 'hf-ver-kv');
        for (var i = 0; i < s.meta.length; i += 2) {
          var row = el('div', 'hf-ver-kv__row');
          row.appendChild(el('span', null, s.meta[i]));
          row.appendChild(el('b', null, s.meta[i + 1]));
          kv.appendChild(row);
        }
        card.appendChild(kv);
        card.appendChild(el('div', 'hf-ev-prev__lbl', '实际提示词'));
        var pre = el('pre', 'hf-ev-prev__code hf-ver-prompt', s.prompt);
        if (s.k === 'rag') {
          // 证据段加高亮标记
          var evLine = H.buildEvidence(q);
          pre.textContent = '';
          s.prompt.split('\n').forEach(function (line) {
            var p = el('span', line.indexOf('【真值证据】') === 0 ? 'hf-ver-evidence' : '');
            p.textContent = line;
            pre.appendChild(p);
            pre.appendChild(document.createTextNode('\n'));
          });
        }
        card.appendChild(pre);
        grid.appendChild(card);
      });
      host.appendChild(grid);
      host.appendChild(el('p', 'boundary-card__foot',
        '两版本模型与权重完全相同，唯一差异是 RAG 条件在提示词前拼入一段真值证据（上方高亮行）。无训练、无 LoRA、无权重版本。'));
    }
    sel.addEventListener('change', function () { render(sel.value); });
    render(sel.value);
  }

  /* ---------- 08 报告导出：基于评测生成可复制/下载的 Markdown ---------- */
  function buildReportMd(res) {
    var L = [];
    L.push('# 幻觉溯源自愈系统 · 分析报告');
    L.push('');
    L.push('- 标注集：' + res.label_set);
    L.push('- 引擎版本：' + res.version);
    L.push('- 推理模式：' + (res.mode === 'mock' ? 'Mock（契约桩预置，零外部请求）' : '本地 Ollama（无训练）'));
    L.push('- 题目池：' + (res.poolName === 'valid' ? '验证池' : '训练池') + ' · ' + res.total + ' 题');
    L.push('- 生成时间：' + new Date(res.time).toISOString());
    L.push('');
    L.push('## 一、总体指标');
    L.push('');
    L.push('| 指标 | 数值 |');
    L.push('| --- | --- |');
    L.push('| BASE 幻觉率 | ' + res.baseRate + '% |');
    L.push('| RAG 幻觉率 | ' + res.ragRate + '% |');
    L.push('| 幻觉率下降 | ' + res.drop + ' pp |');
    L.push('| 修复样本 | ' + res.fixed + ' / ' + res.total + ' |');
    L.push('');
    L.push('## 二、四类场景分组');
    L.push('');
    L.push('| 场景 | 题数 | BASE 幻觉率 | RAG 幻觉率 |');
    L.push('| --- | --- | --- | --- |');
    ['knowledge','logic','prompt','context'].forEach(function (c) {
      var b = res.byCat[c];
      if (!b || !b.total) return;
      L.push('| ' + (H.CAUSE_CN[c] || c) + ' | ' + b.total + ' | ' + b.baseRate + '% | ' + b.ragRate + '% |');
    });
    L.push('');
    L.push('## 三、逐题判定');
    L.push('');
    L.push('| 题号 | 场景 | BASE | RAG | 结果 |');
    L.push('| --- | --- | --- | --- | --- |');
    res.rows.forEach(function (r) {
      var fixed = r.base.judge.verdict === 'HALLUCINATION' && r.rag.judge.verdict === 'CONSISTENT';
      var bv = r.base.judge.verdict === 'CONSISTENT' ? '一致' : '幻觉';
      var rv = r.rag.judge.verdict === 'CONSISTENT' ? '一致' : '幻觉';
      L.push('| ' + r.id + ' | ' + (H.CAUSE_CN[r.cat] || r.cat) + ' | ' + bv + ' | ' + rv +
        ' | ' + (fixed ? '已修复' : (bv === '一致' ? '原本一致' : '未修复')) + ' |');
    });
    L.push('');
    L.push('## 四、判定口径与诚实边界');
    L.push('');
    L.push('- 判定由独立真值库确定性比对完成（结论锚点 + 事实点覆盖率 ' +
      (H.CONFIG.COVERAGE_THRESHOLD * 100) + '%），零模型投票、不读模型置信度。');
    L.push('- 修复采用 RAG 真值证据注入替代 LoRA 微调，全程不训练模型、无权重变更。');
    L.push('- RAG 仅对知识盲区类有效；推理逻辑、提示词、上下文类不由证据注入修复。');
    L.push('- ' + res.note);
    L.push('');
    return L.join('\n');
  }

  function bootReport() {
    var res = H.Store.get();
    var host = $('#hfReportHost');
    var bar = $('#hfReportBar');
    if (bar) bar.classList.toggle('hidden', !res);
    if (!res) { emptyResult('#hfReportHost', 'hf-probe.html'); return; }
    if (!host) return;
    var md = buildReportMd(res);
    host.innerHTML = '';
    var card = el('section', 'card hf-report-paper');
    var seal = el('div', 'hf-report-seal');
    seal.appendChild(el('span', 'lbl', 'HF / LAB · 签发'));
    seal.appendChild(el('b', null, res.label_set + ' · ' + res.version));
    card.appendChild(seal);
    var pre = el('pre', 'hf-report-md', md);
    card.appendChild(pre);
    host.appendChild(card);

    var copy = $('#hfRepCopy');
    var dl = $('#hfRepDl');
    var msg = $('#hfRepMsg');
    function say(t, ok) { if (msg) { msg.textContent = t; msg.className = 'hf-rcbar__msg' + (ok ? ' ok' : ''); } }
    if (copy) copy.addEventListener('click', function () {
      // file:// 下优先 textarea + execCommand，避免 Clipboard API 的安全上下文限制
      var ta = el('textarea');
      ta.value = md;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      say(ok ? '已复制到剪贴板' : '复制未获授权，请手动选择报告文本', ok);
    });
    if (dl) dl.addEventListener('click', function () {
      try {
        var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = el('a');
        a.href = url;
        a.download = 'HF报告-' + res.label_set + '-' + new Date(res.time).toISOString().slice(0,10) + '.md';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        say('已生成 Markdown 文件', true);
      } catch (e) { say('浏览器拒绝了本地下载，请复制文本', false); }
    });
  }

  function init() {
    markNav();
    if (page === 'probe') bootProbe();
    if (page === 'sample') bootSample();
    if (page === 'eval') bootEval();
    if (page === 'truth') bootTruth();
    if (page === 'evidence') bootEvidence();
    if (page === 'repair') bootRepair();
    if (page === 'version') bootVersion();
    if (page === 'report') bootReport();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
