
      (function () {
        const RM = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const html = document.documentElement;
        const overlay = document.getElementById("pt");
        const cover = html.classList.contains("pt-cover");
        /* 目标页：已在覆盖态 → 反向揭开 */
        if (cover && overlay) {
          requestAnimationFrame(() => {
            overlay.classList.add("leave");
            setTimeout(() => {
              html.classList.remove("pt-cover");
              overlay.classList.remove("leave");
              try {
                sessionStorage.removeItem("pt-nav");
              } catch (e) {}
            }, 520);
          });
        }
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
    