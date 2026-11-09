
      /* 主页脚本：只负责落地页动效编排，不含任何探测逻辑，不发起网络请求 */
      const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const $ = (s) => document.querySelector(s);
      const $$ = (s) => Array.from(document.querySelectorAll(s));

      /* 预设强调色板（长按切换全局 --accent；统一配色下仍保留「换肤」彩蛋） */
      const PALETTE = [
        { hex: "#c8f560", name: "#C8F560" },
        { hex: "#4fe3d0", name: "#4FE3D0" },
        { hex: "#7ad0ff", name: "#7AD0FF" },
        { hex: "#f5c451", name: "#F5C451" },
        { hex: "#ff8fb0", name: "#FF8FB0" },
      ];
      let paletteIndex = 0;
      function applyPalette(i) {
        paletteIndex = ((i % PALETTE.length) + PALETTE.length) % PALETTE.length;
        const p = PALETTE[paletteIndex];
        document.documentElement.style.setProperty("--accent", p.hex);
        $("#accentName").textContent = p.name;
      }

      /* 编排入场 */
      $(".hero").classList.add("in");
      $(".stages").classList.add("in");
      if (RM) {
        $$("[data-reveal],.stages").forEach((el) => el.classList.add("in"));
      } else if ("IntersectionObserver" in window) {
        const revealObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((e) => {
              if (e.isIntersecting) {
                e.target.classList.add("in");
                revealObserver.unobserve(e.target);
              }
            });
          },
          { threshold: 0.14 },
        );
        $$("[data-reveal]").forEach((el) => revealObserver.observe(el));
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
        ["hero", "chains", "brands", "access"].forEach((id) => {
          const el = $("#" + id);
          if (el) navObserver.observe(el);
        });
      } else {
        $$("[data-reveal],.stages").forEach((el) => el.classList.add("in"));
      }
      if (!RM) {
        let ticking = false;
        window.addEventListener(
          "scroll",
          () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
              const halo = $("#halo");
              if (halo)
                halo.style.setProperty(
                  "--par",
                  Math.min(window.scrollY * 0.06, 60) + "px",
                );
              ticking = false;
            });
          },
          { passive: true },
        );
      }

      /* 圆形自定义光标 */
      const cursor = $("#cursor"),
        cursorText = $("#cursorText");
      if (!RM && window.matchMedia("(pointer:fine)").matches) {
        window.addEventListener(
          "mousemove",
          (e) => {
            cursor.classList.add("is-live");
            cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%)`;
          },
          { passive: true },
        );
        $$("a,button").forEach((el) => {
          el.addEventListener("mouseenter", () => {
            cursorText.textContent = "CONNECT";
          });
          el.addEventListener("mouseleave", () => {
            cursorText.textContent = "RELEASE";
          });
        });
      }

      /* 声音开关 */
      const soundBtn = $("#soundBtn");
      soundBtn.addEventListener("click", () => {
        const on = soundBtn.getAttribute("aria-checked") !== "true";
        soundBtn.setAttribute("aria-checked", String(on));
        soundBtn.textContent = on ? "ON" : "OFF";
        soundBtn.title = on ? "声音状态仅作视觉演示，无音频输出" : "";
      });

      /* 长按改变外观 */
      const holdBtn = $("#holdBtn");
      let holdTimer = null,
        cycleTimer = null;
      function setHoldText(state) {
        cursorText.textContent = state;
        holdBtn.textContent =
          state === "HOLD" ? "正在切换外观…" : "按住改变外观";
      }
      function startHold() {
        if (holdTimer || cycleTimer) return;
        holdBtn.classList.add("is-holding");
        if (RM) {
          applyPalette(paletteIndex + 1);
          setHoldText("RELEASE");
          return;
        }
        setHoldText("HOLD");
        holdTimer = setTimeout(() => {
          applyPalette(paletteIndex + 1);
          cycleTimer = setInterval(() => applyPalette(paletteIndex + 1), 900);
        }, 600);
      }
      function stopHold() {
        clearTimeout(holdTimer);
        clearInterval(cycleTimer);
        holdTimer = null;
        cycleTimer = null;
        holdBtn.classList.remove("is-holding");
        setHoldText("RELEASE");
      }
      holdBtn.addEventListener("pointerdown", startHold);
      ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
        holdBtn.addEventListener(ev, stopHold),
      );
      holdBtn.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          startHold();
        }
      });
      holdBtn.addEventListener("keyup", (e) => {
        if (e.key === " " || e.key === "Enter") stopHold();
      });

      /* Early Access */
      $("#codeBtn").addEventListener("click", () => {
        const v = $("#codeInput").value.trim();
        $("#codeFeedback").textContent = v
          ? "已记录「" +
            v.slice(0, 40) +
            "」· 本地演示，未提交、未联网、未存储。"
          : "请输入邀请码后再确认（本地演示）。";
      });
      $("#codeInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") $("#codeBtn").click();
      });
    