
      (function () {
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
    