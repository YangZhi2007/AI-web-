
      (function () {
        /* 系统切换壳：在品牌之后注入「自适应绕过 / 幻觉修复」分段控件。
           覆盖所有加载 core.js 的页面（功能页 .topbar、落地页 .site-head），
           各页 HTML 零改动；注入早于下方 data-nav 绑定，故新链接同享跨页过渡。 */
        (function injectSysSwitch() {
          var host =
            document.querySelector('.topbar') ||
            document.querySelector('.site-head');
          if (!host || host.querySelector('.sys-switch')) return;
          var isHF =
            document.body &&
            document.body.getAttribute &&
            document.body.getAttribute('data-page') === 'hf';
          var nav = document.createElement('nav');
          nav.className = 'sys-switch';
          nav.setAttribute('aria-label', '功能区切换');
          [
            { sys: 'waf', href: 'index.html', label: '自适应绕过', on: !isHF },
            { sys: 'hf', href: 'hf.html', label: '幻觉修复', on: isHF },
          ].forEach(function (it) {
            var a = document.createElement('a');
            a.href = it.href;
            a.setAttribute('data-sys', it.sys);
            a.setAttribute('data-nav', '');
            a.setAttribute('data-ripple', '');
            if (it.on) a.setAttribute('aria-current', 'page');
            var dot = document.createElement('span');
            dot.className = 'sys-switch__dot';
            dot.setAttribute('aria-hidden', 'true');
            a.appendChild(dot);
            a.appendChild(document.createTextNode(it.label));
            nav.appendChild(a);
          });
          var brand = host.querySelector('.brand');
          if (brand && brand.parentNode === host)
            host.insertBefore(nav, brand.nextSibling);
          else host.insertBefore(nav, host.firstChild);
        })();

        const RM = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const html = document.documentElement;
        const overlay = document.getElementById("pt");

        /* 复位遮罩：清掉展开/收拢类与首帧覆盖态，并抹掉跨页导航标记 */
        function resetOverlay() {
          if (!overlay) return;
          overlay.classList.remove("show", "leave");
          html.classList.remove("pt-cover");
          try {
            sessionStorage.removeItem("pt-nav");
          } catch (e) {}
        }

        /* 目标页：首帧处于覆盖态 → 圆形收拢揭开 */
        if (overlay && html.classList.contains("pt-cover")) {
          requestAnimationFrame(() => {
            overlay.classList.add("leave");
            setTimeout(resetOverlay, 520);
          });
          /* 兜底：若上述链条没走完（rAF 被挂起 / 计时器被节流），1.6s 后强制揭开 */
          setTimeout(() => {
            if (html.classList.contains("pt-cover")) resetOverlay();
          }, 1600);
        }

        /* bfcache 兜底：浏览器「后退」回本页时脚本不会重跑，
           离开前加上的 .show（整屏不透明 + pointer-events:all）会被原样还原，
           页面就会永远卡在遮罩下 —— 缓存恢复时强制复位 */
        addEventListener("pageshow", (e) => {
          if (e.persisted) resetOverlay();
        });

        if (RM) return; /* 降级：原生跳转，不做覆盖动画 */
        function go(href) {
          if (!overlay) {
            location.href = href;
            return;
          }
          overlay.classList.add("show");
          setTimeout(() => {
            try {
              sessionStorage.setItem("pt-nav", "1");
            } catch (e) {}
            location.href = href;
          }, 480);
        }
        document.querySelectorAll("a[data-nav]").forEach((a) => {
          a.addEventListener("click", (e) => {
            const href = a.getAttribute("href");
            if (!href || href.charAt(0) === "#") return;
            e.preventDefault();
            go(href);
          });
        });
        document.querySelectorAll("[data-ripple]").forEach((btn) => {
          btn.addEventListener("pointerdown", (e) => {
            const r = btn.getBoundingClientRect(),
              size = Math.max(r.width, r.height);
            const s = document.createElement("span");
            s.className = "ripple";
            s.style.width = s.style.height = size + "px";
            s.style.left = e.clientX - r.left - size / 2 + "px";
            s.style.top = e.clientY - r.top - size / 2 + "px";
            btn.appendChild(s);
            setTimeout(() => s.remove(), 620);
          });
        });
      })();
    