(function () {
  const { rpc, store, esc, cfg } = window.FB;
  const $ = id => document.getElementById(id);
  const TOKEN = "fb_teacher_token";
  let DATA = { students: [], settings: {} };
  let selected = new Set();
  let current = null;            // student being edited
  const issuedPw = {};           // 이 세션에서 발급한 임의 비밀번호(화면 표시용, 서버에는 해시만)
  const SITE_URL = location.href.replace(/admin\.html.*$/, "");

  const LISTS = [
    { key: "strengths", label: "① 잘한 점", q: true },
    { key: "improvements", label: "② 보완할 점", q: true },
    { key: "directions", label: "③ 개선 방향", ex: true }
  ];

  function token() { return store.get(TOKEN); }
  async function call(fn, args) {
    try { return await rpc(fn, Object.assign({ p_token: token() }, args || {})); }
    catch (e) { if (e.auth) { logoutView(e.message); } throw e; }
  }
  function logoutView(msg) {
    store.del(TOKEN);
    $("viewAdmin").classList.add("hidden"); $("topActions").classList.add("hidden");
    $("viewLogin").classList.remove("hidden"); $("loginMsg").textContent = msg || "";
    DATA = { students: [], settings: {} }; $("rows").innerHTML = "";
  }


  // ---------- 마스터키 ----------
  async function mkStatus() {
    const r = await call("admin_master_status");
    $("mkStatus").textContent = r.active ? `현재 마스터키 사용 중 (발급: ${new Date(r.set_at).toLocaleString("ko-KR")})` : "현재 발급된 마스터키가 없어요.";
    $("mkRevoke").disabled = !r.active;
  }
  $("btnMaster").addEventListener("click", async () => { $("mkKey").classList.add("hidden"); $("mkKey").textContent = ""; $("mkModal").classList.remove("hidden"); await mkStatus(); });
  $("mkClose").addEventListener("click", () => { $("mkModal").classList.add("hidden"); $("mkKey").textContent = ""; });
  $("mkIssue").addEventListener("click", async () => {
    if (!confirm("새 마스터키를 발급할까요? 이전 키는 즉시 무효가 됩니다.")) return;
    const r = await call("admin_issue_master_key");
    if (r.ok) { $("mkKey").textContent = r.key; $("mkKey").classList.remove("hidden"); await mkStatus(); }
  });
  $("mkRevoke").addEventListener("click", async () => {
    if (!confirm("마스터키를 폐기할까요?")) return;
    await call("admin_revoke_master_key"); $("mkKey").classList.add("hidden"); $("mkKey").textContent = ""; await mkStatus();
  });

  // ---------- 목록 ----------
  async function load() {
    const r = await call("admin_list");
    DATA = r;
    $("viewLogin").classList.add("hidden"); $("viewAdmin").classList.remove("hidden"); $("topActions").classList.remove("hidden");
    $("setOpen").checked = String(r.settings.site_open) !== "false";
    $("setScores").checked = String(r.settings.show_scores) === "true";
    $("setScans").checked = String(r.settings.show_scans) !== "false";
    const classes = [...new Set(r.students.map(s => s.class_room).filter(Boolean))].sort();
    const fc = $("fClass"), keep = fc.value;
    fc.innerHTML = '<option value="">전체 수업반</option>' + classes.map(c => `<option>${esc(c)}</option>`).join("");
    fc.value = classes.includes(keep) ? keep : "";
    selected = new Set([...selected].filter(id => r.students.some(s => s.student_id === id)));
    renderStats(); renderRows();
  }

  function hasFb(s) { return s.summary || (s.strengths && s.strengths.length); }
  function renderStats() {
    const S = DATA.students;
    const byClass = {};
    S.forEach(s => { byClass[s.class_room] = (byClass[s.class_room] || 0) + 1; });
    const cells = [
      ["전체 학생", S.length], ["피드백 등록", S.filter(hasFb).length], ["공개", S.filter(s => s.published).length],
      ["비밀번호 설정", S.filter(s => s.has_password).length], ["학생이 변경", S.filter(s => s.pw_changed_by_student).length],
      ["로그인 잠김", S.filter(s => s.locked).length]
    ].concat(Object.keys(byClass).sort().map(c => ["수업반 " + c, byClass[c]]));
    $("stats").innerHTML = cells.map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`).join("");
  }

  function filtered() {
    const q = $("q").value.trim().toLowerCase(), c = $("fClass").value, st = $("fStatus").value;
    return DATA.students.filter(s =>
      (!q || s.student_id.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q)) &&
      (!c || s.class_room === c) &&
      (!st || (st === "pub" && s.published) || (st === "unpub" && !s.published && hasFb(s)) || (st === "nofb" && !hasFb(s)) ||
        (st === "nopw" && !s.has_password) || (st === "locked" && s.locked)));
  }

  function pwBadge(s) {
    if (s.locked) return '<span class="badge lock">잠김</span>';
    if (!s.has_password) return '<span class="badge warn">없음</span>';
    return s.pw_changed_by_student ? '<span class="badge on">학생 변경</span>' : '<span class="badge off">초기</span>';
  }

  function renderRows() {
    const list = filtered();
    $("rows").innerHTML = list.map(s => `<tr>
      <td><input type="checkbox" class="chk" data-id="${esc(s.student_id)}" ${selected.has(s.student_id) ? "checked" : ""} aria-label="${esc(s.name)} 선택"></td>
      <td>${esc(s.class_room)}</td><td>${esc(s.student_id)}</td><td>${esc(s.name)}</td>
      <td>${s.total != null ? esc(s.total) + "/25" : "-"}</td>
      <td>${hasFb(s) ? (s.published ? '<span class="badge on">공개</span>' : '<span class="badge off">비공개</span>') : '<span class="badge warn">없음</span>'}</td>
      <td>${pwBadge(s)}</td><td>${s.scan_count ? esc(s.scan_count) + "쪽" : '<span class="muted">-</span>'}</td>
      <td class="muted small">${s.updated_at ? esc(new Date(s.updated_at).toLocaleString("ko-KR")) : ""}</td>
      <td><button class="btn small ed" data-id="${esc(s.student_id)}" type="button">편집</button></td></tr>`).join("");
    $("listHint").textContent = `${list.length}명 표시 / 전체 ${DATA.students.length}명`;
    $("selCount").textContent = `${selected.size}명 선택`;
    $("chkAll").checked = list.length > 0 && list.every(s => selected.has(s.student_id));
  }

  $("rows").addEventListener("change", e => {
    if (!e.target.classList.contains("chk")) return;
    const id = e.target.dataset.id; e.target.checked ? selected.add(id) : selected.delete(id);
    $("selCount").textContent = `${selected.size}명 선택`;
  });
  $("rows").addEventListener("click", e => { if (e.target.classList.contains("ed")) openEditor(e.target.dataset.id); });
  $("chkAll").addEventListener("change", e => { filtered().forEach(s => e.target.checked ? selected.add(s.student_id) : selected.delete(s.student_id)); renderRows(); });
  ["q", "fClass", "fStatus"].forEach(id => $(id).addEventListener("input", renderRows));

  async function bulkPublish(pub) {
    if (!selected.size) return alert("학생을 먼저 선택하세요.");
    const ids = [...selected].filter(id => hasFb(DATA.students.find(s => s.student_id === id)));
    if (!ids.length) return alert("선택한 학생 중 피드백이 등록된 학생이 없습니다.");
    if (!confirm(`${ids.length}명의 피드백을 ${pub ? "공개" : "비공개"}로 바꿀까요?`)) return;
    await call("admin_set_published", { p_student_ids: ids, p_published: pub });
    await load();
  }
  $("btnPub").addEventListener("click", () => bulkPublish(true));
  $("btnUnpub").addEventListener("click", () => bulkPublish(false));

  $("setOpen").addEventListener("change", async e => { await call("admin_set_setting", { p_key: "site_open", p_value: e.target.checked }); });
  $("setScores").addEventListener("change", async e => { await call("admin_set_setting", { p_key: "show_scores", p_value: e.target.checked }); });
  $("setScans").addEventListener("change", async e => { await call("admin_set_setting", { p_key: "show_scans", p_value: e.target.checked }); });

  // ---------- 편집 ----------
  function itemHtml(L, x) {
    return `<div class="it">
      <textarea rows="3" class="pt">${esc(x.point || "")}</textarea>
      <div class="meta">${L.q ? `<input class="qs" placeholder="관련 문항 (쉼표로 구분, 예: 3-(2), 4-(1))" value="${esc((x.questions || []).join(", "))}">` : ""}
      ${L.ex ? `<input class="ex" placeholder="고쳐 쓴 예시 (선택)" value="${esc(x.example || "")}">` : ""}
      <button class="btn small rm" type="button">삭제</button></div></div>`;
  }
  function openEditor(id) {
    current = DATA.students.find(s => s.student_id === id);
    if (!current) return;
    $("edTitle").textContent = `${current.student_id} ${current.name} (${current.class_room})`;
    $("edTitleInput").value = current.title || "";
    $("edSummary").value = current.summary || "";
    $("edPublished").checked = !!current.published;
    $("edLists").innerHTML = LISTS.map(L => `<div class="lst" data-key="${L.key}"><h3>${L.label}<span class="grow"></span><button class="btn small add" type="button">항목 추가</button></h3>
      <div class="items">${(current[L.key] || []).map(x => itemHtml(L, x)).join("")}</div></div>`).join("");
    $("edPw").value = ""; $("edPwMsg").textContent = ""; $("edMsg").textContent = "";
    $("edPwState").textContent = current.locked ? "· 로그인 잠김" : current.has_password ? (current.pw_changed_by_student ? "· 학생이 직접 변경함" : "· 초기 비밀번호 설정됨") : "· 비밀번호 없음";
    $("edModal").classList.remove("hidden");
  }
  $("edLists").addEventListener("click", e => {
    const box = e.target.closest(".lst"); if (!box) return;
    const L = LISTS.find(l => l.key === box.dataset.key);
    if (e.target.classList.contains("add")) box.querySelector(".items").insertAdjacentHTML("beforeend", itemHtml(L, {}));
    if (e.target.classList.contains("rm")) e.target.closest(".it").remove();
  });
  function collect() {
    const out = { title: $("edTitleInput").value.trim(), summary: $("edSummary").value.trim() };
    LISTS.forEach(L => {
      out[L.key] = [...document.querySelectorAll(`.lst[data-key="${L.key}"] .it`)].map(it => {
        const o = { point: it.querySelector(".pt").value.trim() };
        if (L.q) o.questions = it.querySelector(".qs").value.split(",").map(s => s.trim()).filter(Boolean);
        if (L.ex) o.example = it.querySelector(".ex").value.trim();
        return o;
      }).filter(o => o.point);
    });
    return out;
  }
  $("edSave").addEventListener("click", async () => {
    const m = $("edMsg"); m.className = "msg";
    try {
      const r = await call("admin_update_feedback", { p_student_id: current.student_id, p_data: collect() });
      if (!r.ok) { m.className = "msg err"; m.textContent = r.error; return; }
      if ($("edPublished").checked !== !!current.published)
        await call("admin_set_published", { p_student_ids: [current.student_id], p_published: $("edPublished").checked });
      m.className = "msg ok"; m.textContent = "저장했습니다.";
      const id = current.student_id; await load(); current = DATA.students.find(s => s.student_id === id);
    } catch (e) { m.className = "msg err"; m.textContent = e.message; }
  });
  $("edClose").addEventListener("click", () => $("edModal").classList.add("hidden"));

  $("edPwSet").addEventListener("click", async () => {
    const pw = $("edPw").value.trim(), m = $("edPwMsg");
    if (pw.length < 4) { m.className = "msg err"; m.textContent = "4자 이상 입력하세요."; return; }
    if (!confirm(`${current.name} 학생의 비밀번호를 입력한 번호로 바꿀까요? (학생이 바꾼 비밀번호도 초기화됩니다)`)) return;
    const r = await call("admin_set_password", { p_student_id: current.student_id, p_password: pw });
    m.className = r.ok ? "msg ok" : "msg err"; m.textContent = r.ok ? "설정했습니다. 학생에게 개별로 알려 주세요." : r.error;
    $("edPw").value = ""; delete issuedPw[current.student_id]; await load();
  });
  $("edPwRand").addEventListener("click", async () => {
    if (!confirm(`${current.name} 학생에게 임의 6자리 비밀번호를 새로 발급할까요?`)) return;
    const r = await call("admin_reset_password_random", { p_student_id: current.student_id });
    const m = $("edPwMsg");
    if (!r.ok) { m.className = "msg err"; m.textContent = r.error; return; }
    issuedPw[current.student_id] = r.password;
    m.className = "msg ok"; m.innerHTML = `새 비밀번호: <b class="pwshow">${esc(r.password)}</b> — 이 화면을 닫으면 다시 볼 수 없습니다(안내문 인쇄는 가능).`;
    await load();
  });
  $("edUnlock").addEventListener("click", async () => {
    await call("admin_unlock", { p_student_id: current.student_id });
    $("edPwMsg").className = "msg ok"; $("edPwMsg").textContent = "잠금을 해제했습니다."; await load();
  });

  // ---------- 가져오기 ----------
  let importRows = null;
  $("btnImport").addEventListener("click", () => { importRows = null; $("imFile").value = ""; $("imPreview").textContent = ""; $("imMsg").textContent = ""; $("imGo").disabled = true; $("imModal").classList.remove("hidden"); });
  $("imClose").addEventListener("click", () => $("imModal").classList.add("hidden"));
  $("imFile").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      importRows = Array.isArray(j) ? j : j.rows;
      if (!Array.isArray(importRows)) throw new Error();
      const nPw = importRows.filter(r => r.initial_password).length, nFb = importRows.filter(r => r.feedback).length;
      const nSc = importRows.reduce((a, r) => a + (r.scans || []).length, 0);
      const cls = [...new Set(importRows.map(r => r.class_room))].join(", ");
      $("imPreview").textContent = `학생 ${importRows.length}명 (수업반: ${cls}) · 피드백 ${nFb}건 · 초기 비밀번호 ${nPw}건 · 답안지 ${nSc}쪽`;
      $("imGo").disabled = false;
    } catch (err) { $("imPreview").textContent = "파일 형식이 올바르지 않습니다."; importRows = null; $("imGo").disabled = true; }
  });
  $("imGo").addEventListener("click", async () => {
    if (!importRows) return;
    const m = $("imMsg");
    try {
      $("imGo").disabled = true;
      const rows = importRows.map(r => { const o = Object.assign({}, r); delete o.scans; return o; });
      const r = await call("admin_import", { p_rows: rows, p_overwrite_pw: $("imOverwrite").checked });
      if (!r.ok) { m.className = "msg err"; m.textContent = r.error; return; }
      const scans = importRows.flatMap(x => (x.scans || []).map(s => [x.student_id, s]));
      let done = 0, fail = 0;
      for (const [sid, s] of scans) {
        m.className = "msg"; m.textContent = `답안지 올리는 중… ${done + fail + 1}/${scans.length}`;
        const u = await call("admin_upload_scan", { p_student_id: sid, p_page: s.page, p_label: s.label || "", p_mime: s.mime || "image/jpeg", p_base64: s.base64 });
        u.ok ? done++ : fail++;
      }
      m.className = "msg"; m.textContent = "목록을 새로 불러오는 중…";
      await load();
      m.className = fail ? "msg err" : "msg ok";
      m.textContent = `완료: 학생 ${r.students}명, 피드백 ${r.feedback}건, 비밀번호 ${r.passwords}건, 답안지 ${done}쪽` + (fail ? `(실패 ${fail}쪽)` : "") +
        ". 피드백은 비공개 상태입니다. 가져온 파일은 PC에서 삭제하세요.";
    } catch (e) { m.className = "msg err"; m.textContent = e.message; }
  });

  // ---------- 내보내기 ----------
  function flat(list) { return (list || []).map((x, i) => `${i + 1}. ${x.point}${x.example ? " [예시] " + x.example : ""}`).join("\n"); }
  function exportRows() {
    return DATA.students.map(s => {
      const row = { "수업반": s.class_room, "학번": s.student_id, "이름": s.name, "공개": s.published ? "공개" : "비공개",
        "총점(25)": s.total, "획득(15)": s.earned, "수행평가명": s.title || "",
        "답안지(쪽)": s.scan_count || 0, "잘한 점": flat(s.strengths), "보완할 점": flat(s.improvements), "개선 방향": flat(s.directions), "종합 피드백": s.summary || "" };
      (s.items || []).forEach(i => { row[i.q] = i.score === 1 ? 1 : i.score === 0 ? 0 : ""; });
      return row;
    });
  }
  function stamp() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
  function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  $("btnCsv").addEventListener("click", () => {
    const rows = exportRows(); if (!rows.length) return;
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const csv = "﻿" + [cols.map(q).join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\r\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `수행평가_피드백_${stamp()}.csv`);
  });
  $("btnXlsx").addEventListener("click", () => {
    const rows = exportRows(); if (!rows.length || !window.XLSX) return;
    const ws = XLSX.utils.json_to_sheet(rows); ws["!cols"] = Object.keys(rows[0]).map(k => ({ wch: /피드백|점|방향/.test(k) ? 50 : 10 }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "피드백");
    XLSX.writeFile(wb, `수행평가_피드백_${stamp()}.xlsx`);
  });

  // ---------- 로그인 안내문 ----------
  $("btnSlips").addEventListener("click", () => {
    const list = DATA.students.filter(s => selected.has(s.student_id));
    if (!list.length) return alert("학생을 먼저 선택하세요.");
    $("slips").innerHTML = list.map(s => `<div class="slip"><div class="nm">${esc(s.name)} <span class="muted small">${esc(s.class_room)}</span></div>
      <div>학번(아이디): <b>${esc(s.student_id)}</b></div>
      <div>비밀번호: ${issuedPw[s.student_id] ? `<span class="pw">${esc(issuedPw[s.student_id])}</span>` : "선생님께 받은 번호(본인 전화번호 뒷 4자리)"}</div>
      <div class="url">접속: ${esc(SITE_URL)}</div>
      <div class="muted small">로그인 후 '비밀번호 변경'으로 바꿀 수 있어요. 다른 친구에게 알려 주지 마세요.</div></div>`).join("");
    $("slipModal").classList.remove("hidden");
  });
  $("slipClose").addEventListener("click", () => $("slipModal").classList.add("hidden"));
  $("slipPrint").addEventListener("click", () => window.print());

  // ---------- 로그인 ----------
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault(); $("loginMsg").textContent = "";
    try {
      const r = await rpc("teacher_login", { p_password: $("tpw").value });
      if (!r.ok) { $("loginMsg").textContent = r.error; return; }
      store.set(TOKEN, r.token); $("tpw").value = ""; await load();
    } catch (err) { $("loginMsg").textContent = err.message; }
  });
  $("btnLogout").addEventListener("click", async () => { try { await rpc("logout", { p_token: token() }); } catch (e) { } logoutView("로그아웃했습니다."); });
  $("btnRefresh").addEventListener("click", load);

  if (token()) load().catch(() => {}); else logoutView();
})();
