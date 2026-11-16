(function () {
  const { rpc, store, esc, cfg } = window.FB;
  const $ = id => document.getElementById(id);
  const TOKEN = "fb_student_token";
  if (cfg.SCHOOL_LABEL) $("brand").innerHTML = "<b>" + esc(cfg.SCHOOL_LABEL) + "</b> 수행평가 피드백";

  let D = null;                 // 현재 학생 데이터 (서버 응답)
  const imgCache = {};          // page -> {url, w, h, el}
  let curPage = 1, selQ = null, selQuote = null;
  const PLACEHOLDER = '<div class="placeholder">답안지에서 테두리나 형광 표시를 누르면<br>그 부분의 피드백을 여기에서 볼 수 있어요.</div>';

  function showLogin(msg, neutral) {
    store.del(TOKEN);
    Object.values(imgCache).forEach(x => URL.revokeObjectURL(x.url));
    for (const k in imgCache) delete imgCache[k];
    D = null; document.body.classList.remove("wide");
    $("viewFeedback").classList.add("hidden"); $("viewFeedback").innerHTML = "";
    $("topActions").classList.add("hidden"); $("viewLogin").classList.remove("hidden");
    $("loginMsg").textContent = msg || ""; $("loginMsg").className = neutral ? "msg" : "msg err";
    $("pw").value = "";
  }

  // ---------- 공통 ----------
  const mark = s => s === 1 ? ["○", "o"] : s === 0 ? ["×", "x"] : ["확인 중", "u"];
  const itemOf = q => ((D.scores && D.scores.items) || []).find(i => i.q === q);
  const areaOf = q => D.annotations.find(a => a.kind === "area" && a.q === q);
  const quotesOf = q => D.annotations.filter(a => a.kind === "quote" && a.q === q);
  const hasScans = () => D.scan_pages.length > 0;
  const toneOf = a => (a.tone === "fix" || a.tone === "improve") ? a.tone : "good";
  const TONE = { good: ["잘한 점", "rgba(70,140,255,.30)", "rgba(40,100,210,.9)"], fix: ["보완할 점", "rgba(255,85,85,.28)", "rgba(200,40,40,.9)"],
                 improve: ["개선할 점", "rgba(60,200,110,.30)", "rgba(25,140,70,.9)"] };

  function chips(qs) {
    qs = (qs || []).filter(Boolean);
    if (!qs.length) return "";
    return '<div class="chips">' + qs.map(q => hasScans() && areaOf(q)
      ? `<button type="button" class="chip link" data-goq="${esc(q)}">${esc(q)}번 답안 보기</button>`
      : `<span class="chip">${esc(q)}번</span>`).join("") + "</div>";
  }
  function list(items, withExample) {
    if (!items || !items.length) return '<p class="empty">해당 내용이 없어요.</p>';
    return '<ul class="pts">' + items.map(x => "<li>" + esc(x.point) + chips(x.questions) +
      (withExample && x.example ? '<div class="example"><b>이렇게 고쳐 써 볼 수 있어요</b>' + esc(x.example) + "</div>" : "") + "</li>").join("") + "</ul>";
  }
  function section(cls, icon, title, body, count) {
    return `<section class="card ${cls}"><div class="sec-h"><div class="ic" aria-hidden="true">${icon}</div><h2>${title}</h2>` +
      (count != null ? `<span class="cnt">${count}개</span>` : "") + "</div>" + body + "</section>";
  }

  // ---------- 탭 1: 피드백 ----------
  function viewFeedback() {
    return section("good", "✓", "잘한 점", list(D.strengths), (D.strengths || []).length) +
      section("warn", "!", "보완할 점", list(D.improvements), (D.improvements || []).length) +
      section("dir", "→", "개선 방향", list(D.directions, true), (D.directions || []).length) +
      section("sum", "✎", "종합 피드백", '<p class="summary-text">' + esc(D.summary) + "</p>");
  }

  // ---------- 탭 2: 문항별 정오표 ----------
  function viewGrades() {
    const S = D.scores, items = S.items || [];
    const rows = items.map(i => {
      const [m, c] = mark(i.score);
      const go = hasScans() && areaOf(i.q) ? '<span class="go">답안지에서 보기 ›</span>' : "";
      return `<div class="grow-row" data-goq="${esc(i.q)}" role="button" tabindex="0"><div class="qn">${esc(i.q)}</div>` +
        `<div class="mk ${c}" aria-label="${c === "o" ? "정답" : c === "x" ? "오답" : "확인 중"}">${m}</div><div class="fb">${esc(i.feedback)}${go}</div></div>`;
    }).join("");
    const n1 = items.filter(i => i.score === 1).length;
    return `<section class="card"><div class="gtop"><span class="big">${esc(S.total)}점</span><span class="muted">25점 만점 (기본점수 10점 + 문항 ${n1}/${items.length}개 정답)</span></div>` +
      (hasScans() ? '<p class="muted small">문항을 누르면 내 답안지의 해당 부분과 피드백을 함께 볼 수 있어요.</p>' : "") + rows + "</section>";
  }

  // ---------- 탭 3: 내 답안지 ----------
  function viewScans() {
    const pages = D.scan_pages.map(p => `<button type="button" class="pg" data-page="${p.page}" aria-pressed="${p.page === curPage}">${esc(p.label || p.page + "쪽")}</button>`).join("");
    return `<section class="card"><div class="pages">${pages}</div>
      <div class="legend"><span><i class="lg-good"></i>잘한 점</span><span><i class="lg-fix"></i>보완할 점</span><span><i class="lg-improve"></i>개선할 점</span><span class="muted">· 형광펜을 누르면 피드백이 보여요</span></div>
      <div class="scan-layout"><div><div class="sheetbox" id="sheet"><div class="loading">답안지를 불러오는 중…</div></div></div>
      <aside class="card detail" id="detail">${PLACEHOLDER}</aside></div></section>`;
  }

  async function getImage(page) {
    if (imgCache[page]) return imgCache[page];
    const r = await rpc("student_get_scan", { p_token: store.get(TOKEN), p_page: page });
    if (!r.ok) throw new Error(r.error);
    const bin = atob(r.data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8], { type: r.mime }));
    const img = new Image(); img.src = url; await img.decode();
    return (imgCache[page] = { url, w: img.naturalWidth, h: img.naturalHeight, el: img });
  }

  function quoteNumbers(page) {        // 쪽 안에서 인용 표시 번호(1, 2, …)
    const m = {}; let n = 0;
    D.annotations.forEach((a, i) => { if (a.kind === "quote" && a.page === page) m[i] = ++n; });
    return m;
  }

  async function drawPage() {
    const box = $("sheet"); if (!box) return;
    document.querySelectorAll(".pg").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.page === curPage)));
    box.innerHTML = '<div class="loading">답안지를 불러오는 중…</div>';
    let im;
    try { im = await getImage(curPage); }
    catch (e) { if (e.auth) return showLogin(e.message); box.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
    box.innerHTML = "";
    const img = document.createElement("img"); img.src = im.url; img.alt = `내 답안지 ${curPage}쪽`; box.appendChild(img);
    const nums = quoteNumbers(curPage);
    D.annotations.forEach((a, i) => {
      if (a.page !== curPage) return;
      const [x0, y0, x1, y1] = a.box, el = document.createElement("div");
      // CSP(style-src 'self') 때문에 style 속성 대신 CSSOM으로 위치 지정
      el.style.left = (x0 * 100) + "%"; el.style.top = (y0 * 100) + "%";
      el.style.width = ((x1 - x0) * 100) + "%"; el.style.height = ((y1 - y0) * 100) + "%";
      el.dataset.q = a.q; el.tabIndex = 0; el.setAttribute("role", "button");
      if (a.kind === "area") {
        const [m, c] = mark(a.score);
        el.className = `ov area ${c}`; el.setAttribute("aria-label", `${a.q}번 ${m}`);
      } else {
        el.className = "ov quote " + toneOf(a); el.dataset.qi = i;
        el.setAttribute("aria-label", `${a.q}번 인용 ${nums[i]}`);
      }
      box.appendChild(el);
    });
    markSelected();
  }

  function markSelected() {
    document.querySelectorAll(".ov").forEach(o => o.classList.toggle("sel",
      selQuote != null ? +o.dataset.qi === selQuote : (!!selQ && o.classList.contains("area") && o.dataset.q === selQ)));
  }

  function cropUrl(page, b) {
    const im = imgCache[page]; if (!im) return null;
    const pad = 0.012, x0 = Math.max(0, b[0] - pad), y0 = Math.max(0, b[1] - pad), x1 = Math.min(1, b[2] + pad), y1 = Math.min(1, b[3] + pad);
    const sw = (x1 - x0) * im.w, sh = (y1 - y0) * im.h, scale = Math.min(2, 900 / sw);
    const c = document.createElement("canvas"); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const g = c.getContext("2d"); g.drawImage(im.el, x0 * im.w, y0 * im.h, sw, sh, 0, 0, c.width, c.height);
    quotesOf(selQ).filter(a => a.page === page).forEach(a => {   // 확대 이미지 위에도 인용 위치 표시
      const id = D.annotations.indexOf(a);
      const rx = (a.box[0] - x0) / (x1 - x0) * c.width, ry = (a.box[1] - y0) / (y1 - y0) * c.height;
      const rw = (a.box[2] - a.box[0]) / (x1 - x0) * c.width, rh = (a.box[3] - a.box[1]) / (y1 - y0) * c.height;
      const T = TONE[toneOf(a)];
      g.globalCompositeOperation = "multiply"; g.fillStyle = T[1]; g.fillRect(rx, ry, rw, rh);
      if (id === selQuote) g.fillRect(rx, ry, rw, rh);   // 선택한 형광펜은 한 번 더 칠해 진하게
      g.globalCompositeOperation = "source-over";
    });
    return c.toDataURL("image/jpeg", 0.9);
  }

  function showDetail() {
    const el = $("detail"); if (!el || !selQ) return;
    const it = itemOf(selQ), area = areaOf(selQ), qs = quotesOf(selQ), nums = quoteNumbers(curPage);
    const [m, c] = mark(it ? it.score : (area || {}).score);
    const src = area && area.page === curPage ? cropUrl(curPage, area.box) : null;
    el.innerHTML = `<h3><span>${esc(selQ)}번</span><span class="mk ${c}">${m}</span></h3>` +
      (src ? `<img class="zoom" src="${src}" alt="${esc(selQ)}번 답안 확대">` : "") +
      (it && it.feedback ? `<p class="fbtext">${esc(it.feedback)}</p>` : "") +
      (qs.length ? '<ul class="qlist">' + qs.map(a => {
        const id = D.annotations.indexOf(a);
        return `<li class="${toneOf(a)}${id === selQuote ? " sel" : ""}" data-qi="${id}"><span class="qq"><span class="tag">${TONE[toneOf(a)][0]}</span><b>“${esc(a.quote)}”</b></span>${esc(a.note)}</li>`;
      }).join("") + "</ul>" : "");
    if (window.innerWidth < 900) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function select(q, quoteId) {
    selQ = q; selQuote = quoteId == null ? null : quoteId;
    const a = selQuote != null ? D.annotations[selQuote] : areaOf(q);
    if (a && a.page !== curPage) { curPage = a.page; await drawPage(); } else markSelected();
    showDetail();
  }

  async function goQuestion(q) {
    if (!hasScans() || !areaOf(q)) return;
    selQ = q; selQuote = null; curPage = areaOf(q).page;
    setTab("scan");
  }

  // ---------- 화면 구성 ----------
  function setTab(t) {
    document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    document.body.classList.toggle("wide", t === "scan");
    $("tabBody").innerHTML = t === "fb" ? viewFeedback() : t === "grades" ? viewGrades() : viewScans();
    if (t === "scan") drawPage().then(() => {
      if (!selQ) return;
      showDetail();
      const ov = document.querySelector(`.ov.area[data-q="${CSS.escape(selQ)}"]`);
      if (ov && window.innerWidth < 900) ov.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function render() {
    const hero = `<section class="card hero"><div class="who">${esc(D.name)}<small>${esc(D.student_id)}</small></div>` +
      `<div class="title">${esc(D.title || "")}</div>` +
      (D.updated_at ? `<span class="tag">피드백 업데이트 ${esc(new Date(D.updated_at).toLocaleDateString("ko-KR"))}</span>` : "") + "</section>";
    if (!D.published) {
      $("viewFeedback").innerHTML = hero + '<section class="card notice"><div class="big" aria-hidden="true">⏳</div>' +
        "<p>아직 피드백이 공개되지 않았어요.<br>선생님이 검토를 마치면 이곳에서 확인할 수 있어요.</p></section>";
      return;
    }
    const tabs = [];
    if (D.scores) tabs.push(["grades", "문항별 정오표"]);
    if (hasScans()) tabs.push(["scan", "내 답안지"]);
    tabs.push(["fb", "자세한 피드백"]);
    $("viewFeedback").innerHTML = hero +
      (tabs.length > 1 ? '<nav class="tabs" role="tablist">' + tabs.map(([k, l]) => `<button type="button" class="tab" role="tab" data-tab="${k}">${l}</button>`).join("") + "</nav>" : "") +
      '<div id="tabBody"></div>';
    curPage = (D.scan_pages[0] || {}).page || 1; selQ = null; selQuote = null;
    setTab(tabs[0][0]);   // 맨 왼쪽 탭(정오표)부터
  }

  $("viewFeedback").addEventListener("click", e => {
    const t = e.target.closest("[data-tab]"); if (t) return setTab(t.dataset.tab);
    const g = e.target.closest("[data-goq]"); if (g) return goQuestion(g.dataset.goq);
    const p = e.target.closest(".pg"); if (p) { curPage = +p.dataset.page; selQ = null; selQuote = null; drawPage(); $("detail").innerHTML = PLACEHOLDER; return; }
    const o = e.target.closest(".ov"); if (o) return select(o.dataset.q, o.dataset.qi != null ? +o.dataset.qi : null);
    const li = e.target.closest(".qlist li"); if (li) return select(selQ, +li.dataset.qi);
  });
  $("viewFeedback").addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".ov,.grow-row")) { e.preventDefault(); e.target.click(); }
  });

  async function load() {
    const t = store.get(TOKEN);
    if (!t) return showLogin();
    try {
      D = await rpc("student_get_feedback", { p_token: t });
      D.scan_pages = D.scan_pages || []; D.annotations = D.annotations || [];
      $("viewLogin").classList.add("hidden"); $("topActions").classList.remove("hidden"); $("viewFeedback").classList.remove("hidden");
      render(); window.scrollTo(0, 0);
    } catch (e) { showLogin(e.message); }
  }

  $("loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const btn = $("btnLogin"); btn.disabled = true; $("loginMsg").textContent = "";
    try {
      const r = await rpc("student_login", { p_student_id: $("sid").value.trim(), p_password: $("pw").value });
      if (!r.ok) { $("loginMsg").className = "msg err"; $("loginMsg").textContent = r.error; return; }
      store.set(TOKEN, r.token); $("pw").value = ""; await load();
    } catch (e) { $("loginMsg").className = "msg err"; $("loginMsg").textContent = e.message; }
    finally { btn.disabled = false; }
  });
  $("btnLogout").addEventListener("click", async () => {
    const t = store.get(TOKEN);
    try { if (t) await rpc("logout", { p_token: t }); } catch (e) { }
    showLogin("로그아웃했어요.", true);
  });

  const modal = $("pwModal");
  $("btnPw").addEventListener("click", () => { $("pwForm").reset(); $("pwMsg").textContent = ""; modal.classList.remove("hidden"); $("pwOld").focus(); });
  $("pwCancel").addEventListener("click", () => modal.classList.add("hidden"));
  $("pwForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const m = $("pwMsg"); m.className = "msg err";
    if ($("pwNew").value !== $("pwNew2").value) { m.textContent = "새 비밀번호가 서로 달라요."; return; }
    try {
      const r = await rpc("student_change_password", { p_token: store.get(TOKEN), p_old: $("pwOld").value, p_new: $("pwNew").value });
      if (!r.ok) { m.textContent = r.error; return; }
      m.className = "msg ok"; m.textContent = "비밀번호를 바꿨어요. 다음부터 새 비밀번호로 로그인하세요.";
      setTimeout(() => modal.classList.add("hidden"), 1400);
    } catch (e) { if (e.auth) { modal.classList.add("hidden"); showLogin(e.message); } else m.textContent = e.message; }
  });

  load();
})();
