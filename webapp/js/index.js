
      /* 主页脚本：只负责落地页动效编排与「自适应绕过闭环」演示，
         不含任何探测逻辑，不发起网络请求。 */

      const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const $ = (s) => document.querySelector(s);
      const $$ = (s) => Array.from(document.querySelectorAll(s));

      /* 首屏入场：hero 接受 .in 后错峰上浮 */
      const hero = $(".hero");
      if (hero) hero.classList.add("in");

      /* 滚动到区块时，导航高亮对应项 */
      if ("IntersectionObserver" in window) {
        const navObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((e) => {
              if (!e.isIntersecting) return;
              $$(".nav-item").forEach((a) =>
                a.classList.toggle(
                  "is-current",
                  a.getAttribute("href") === "#" + e.target.id,
                ),
              );
            });
          },
          { rootMargin: "-40% 0px -55% 0px" },
        );
        ["hero", "loop"].forEach((id) => {
          const el = $("#" + id);
          if (el) navObserver.observe(el);
        });
      }

      /* 圆形自定义光标（仅精细指针设备，且无动效偏好时） */
      const cursor = $("#cursor");
      const cursorText = $("#cursorText");
      if (
        cursor &&
        cursorText &&
        !RM &&
        window.matchMedia("(pointer:fine)").matches
      ) {
        window.addEventListener(
          "mousemove",
          (e) => {
            cursor.classList.add("is-live");
            cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%)`;
          },
          { passive: true },
        );
        $$("a,button").forEach((el) => {
          el.addEventListener("mouseenter", () => (cursorText.textContent = "CONNECT"));
          el.addEventListener("mouseleave", () => (cursorText.textContent = "RELEASE"));
        });
      }

      /* 自适应绕过闭环：节点逐轮点亮 + 探针流 + 轮次计数（纯演示，零请求） */
      (function initLoop() {
        const nodes = $$("#loopTrack .loop__node");
        const roundEl = $("#loopRound");
        const barEl = $("#loopBar");
        if (!nodes.length || !roundEl || !barEl) return;

        /* 降级：静态展示，不做循环动画 */
        if (RM) {
          nodes.forEach((n) => n.classList.add("is-active", "is-done"));
          roundEl.textContent = "8";
          barEl.style.width = "100%";
          return;
        }

        let cycle = 0;
        const total = nodes.length;
        const tick = () => {
          const step = cycle % total;
          nodes.forEach((n, i) => {
            n.classList.toggle("is-active", i === step);
            n.classList.toggle("is-done", i < step);
          });
          /* 每跑完一轮（5 阶段）轮次 +1，到 8 归零，与控制台演示上限同源 */
          const round = (Math.floor(cycle / total) % 8) + 1;
          roundEl.textContent = String(round);
          barEl.style.width = (round / 8) * 100 + "%";
          cycle++;
        };
        tick();
        setInterval(tick, 1200);
      })();
    
