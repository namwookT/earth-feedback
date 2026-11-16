// 서버(Supabase RPC) 호출 공통 함수. 모든 인증 판단은 서버 함수에서 이뤄집니다.
(function () {
  const cfg = window.FEEDBACK_CONFIG || {};
  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY
        },
        body: JSON.stringify(args || {})
      });
    } catch (e) {
      throw new Error("서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.");
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) {
      const msg = (body && (body.message || body.hint)) || "";
      if (msg.includes("AUTH_REQUIRED")) { const err = new Error("로그인이 만료되었습니다. 다시 로그인해 주세요."); err.auth = true; throw err; }
      throw new Error("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    return body;
  }
  // 토큰은 탭을 닫으면 사라지는 sessionStorage에만 보관(공용 PC 대비)
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { } }
  };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  window.FB = { rpc, store, esc, cfg };
})();
