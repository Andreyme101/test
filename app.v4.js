console.log("APP JS LOADED (SwapMap v4 - WALLET FIX + PUPSI)");

const BUILD = "20260322_walletfix_1";

const tg = window.Telegram?.WebApp || null;
const isTg = !!tg;

let currentUser = null;

let map = null;
let zonesLayer = null;
let selectedZoneId = null;

let tonui = null;
let tonConnected = false;
let tonAddress = null;

let tokenInfoCache = null;
let walletBtnBound = false;
let walletActionInFlight = false;

function $(id) {
  return document.getElementById(id);
}

function shortAddr(a) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-6);
}

function setHint(text) {
  const el = $("pHint");
  if (el) el.textContent = text || "";
}

function setZoneBuyHint(text) {
  const el = $("zoneBuyHint");
  if (el) el.textContent = text || "";
}

function setWalletMeta(text) {
  const el = $("walletMeta");
  if (el) el.textContent = text || "";
  console.log("[walletMeta]", text);
}

function setAvatarFromName(fullName) {
  const el = $("pAvatar");
  if (!el) return;
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] || "S").toUpperCase();
  const b = (parts[1]?.[0] || "M").toUpperCase();
  el.textContent = a + b;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function saveAuth(user) {
  localStorage.setItem("auth_user", JSON.stringify(user));
}

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem("auth_user") || "null");
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showTab(tab) {
  document.querySelectorAll(".tabBtn").forEach(btn => {
    btn.classList.toggle("isActive", btn.dataset.tab === tab);
  });

  document.querySelectorAll(".page").forEach(p => p.style.display = "none");
  const page = document.getElementById("page_" + tab);
  if (page) page.style.display = "block";

  if (tab === "map" && map) {
    setTimeout(() => map.invalidateSize(true), 120);
  }

  if (tab === "myzones") {
    refreshMyZones().catch(console.error);
  }

  if (tab === "profile") {
    refreshProfileProgress().catch(console.error);
    refreshTokenInfo().catch(console.error);
    refreshDailyStatus().catch(console.error);
    refreshWalletUI();
    forceClickableProfile();
  }
}

function initTabs() {
  const root = $("tabs");
  if (!root) return;

  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".tabBtn");
    if (!btn) return;
    showTab(btn.dataset.tab);
  });

  showTab("map");
}

function initMap() {
  map = L.map("map").setView([40.7580, -73.9855], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
}

function zoneStyle(feature) {
  const p = feature.properties || {};
  const base = p.color || "#4b7bec";
  const selected = (p.zone_id === selectedZoneId);

  return {
    color: base,
    fillColor: base,
    weight: selected ? 4 : 2,
    opacity: 1,
    fillOpacity: 0.35
  };
}

function refreshZonesStyle() {
  if (!zonesLayer) return;
  zonesLayer.setStyle(zoneStyle);
}

async function loadZones() {
  const res = await fetch(`/zones.geojson?v=${BUILD}`, { cache: "no-store" });
  if (!res.ok) throw new Error("zones.geojson not found: " + res.status);

  const geo = await res.json();

  zonesLayer = L.geoJSON(geo, {
    style: zoneStyle,
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      layer.on("click", () => onZoneClick(feature));
      layer.bindTooltip(`${p.name || "Zone"} (#${p.zone_id})`, { sticky: true });
    }
  }).addTo(map);
}

async function getTokenInfo() {
  if (tokenInfoCache) return tokenInfoCache;

  const res = await fetch(`/api/token/info`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load /api/token/info");

  tokenInfoCache = await res.json();
  return tokenInfoCache;
}

function openZoneCard(p) {
  const card = $("zoneCard");
  if (!card) return;

  card.style.display = "block";

  $("zoneTitle").textContent = p.name || `Zone #${p.zone_id}`;
  $("zoneMeta").textContent = `zone_id=${p.zone_id}`;

  const pricePupsi = (p.price_pupsi != null) ? Number(p.price_pupsi) : 100;
  const priceEl = $("zonePrice");
  if (priceEl) priceEl.textContent = `${pricePupsi} PUPSI`;

  $("zoneTotalShares").textContent = (p.total_shares != null) ? `${p.total_shares}` : "—";
  $("zoneMine").textContent = "0";

  setZoneBuyHint("Choose shares amount and press Buy (PUPSI).");

  $("zoneClose").onclick = () => {
    card.style.display = "none";
    selectedZoneId = null;
    refreshZonesStyle();
  };

  const buyBtn = $("zoneBuyBtn");
  if (buyBtn) {
    buyBtn.textContent = "Buy (PUPSI)";
    buyBtn.onclick = buyZonePupsi;
  }

  refreshZoneMyShares(p.zone_id).catch(console.error);
}

function onZoneClick(feature) {
  const p = feature.properties || {};
  selectedZoneId = p.zone_id;
  refreshZonesStyle();
  openZoneCard(p);
}

function renderUser(user) {
  currentUser = user;

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if ($("pName")) $("pName").textContent = fullName || "No name";
  if ($("pUser")) $("pUser").textContent = user.username ? `@${user.username}` : "no username";

  setAvatarFromName(fullName || "SwapMap");
  setHint("✅ Authorized. Tap a zone → buy shares with PUPSI.");

  refreshProfileProgress().catch(console.error);
  refreshMyZones().catch(console.error);
  refreshTokenInfo().catch(console.error);
  refreshDailyStatus().catch(console.error);
  refreshWalletUI();
  forceClickableProfile();
}

async function authViaMiniApp() {
  if (!isTg || !tg?.initData) {
    setHint("❌ Open inside Telegram Mini App.");
    return null;
  }

  try {
    tg.ready();
    tg.expand();
  } catch {}

  setHint("Logging in via Telegram Mini App...");

  const res = await fetch("/api/auth/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ init_data: tg.initData })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setHint(`❌ Auth failed: ${data?.detail || "see server logs"}`);
    return null;
  }

  renderUser(data);
  saveAuth(data);
  return data;
}

function forceClickableProfile() {
  const panel = document.querySelector(".panel");
  if (panel) {
    panel.style.pointerEvents = "auto";
    panel.style.zIndex = "9999";
    panel.style.position = "relative";
  }

  const panelInner = document.querySelector(".panelInner");
  if (panelInner) {
    panelInner.style.pointerEvents = "auto";
    panelInner.style.zIndex = "9999";
    panelInner.style.position = "relative";
  }

  const pageProfile = $("page_profile");
  const mapEl = $("map");
  if (!mapEl) return;

  if (pageProfile && pageProfile.style.display !== "none") {
    mapEl.style.pointerEvents = "none";
  } else {
    mapEl.style.pointerEvents = "auto";
  }
}

function installGlobalTouchTracer() {
  document.addEventListener("pointerdown", (e) => {
    try {
      const x = e.clientX, y = e.clientY;
      const topEl = document.elementFromPoint(x, y);
      const id = topEl?.id ? `#${topEl.id}` : "";
      const cls = topEl?.className ? `.${String(topEl.className).split(" ").join(".")}` : "";
      console.log(`[TRACE pointerdown] target=${e.target?.id || e.target?.tagName} top=${topEl?.tagName || "?"}${id}${cls}`);
    } catch {}
  }, true);

  document.addEventListener("click", (e) => {
    try {
      const x = e.clientX, y = e.clientY;
      const topEl = document.elementFromPoint(x, y);
      const id = topEl?.id ? `#${topEl.id}` : "";
      console.log(`[TRACE click] target=${e.target?.id || e.target?.tagName} top=${topEl?.tagName || "?"}${id}`);
    } catch {}
  }, true);
}

function refreshWalletUI() {
  const btn = $("btnConnectWallet");
  if (btn) {
    btn.disabled = false;
    btn.textContent = tonConnected ? "Disconnect" : "Connect Wallet";
  }

  if (tonConnected) {
    setWalletMeta(`Connected: ${shortAddr(tonAddress)}`);
  } else {
    setWalletMeta("Not connected.");
  }
}

async function persistConnectedWallet() {
  if (!currentUser?.tg_id || !tonAddress) return;

  try {
    await fetch(`/api/me/wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_tg_id: currentUser.tg_id,
        wallet_address: tonAddress
      })
    });
  } catch (e) {
    console.error("save wallet failed", e);
  }
}

async function initTonConnect() {
  const btn = $("btnConnectWallet");
  if (!btn) return;

  btn.disabled = false;

  if (!window.TON_CONNECT_UI || !window.TON_CONNECT_UI.TonConnectUI) {
    setWalletMeta("TonConnect SDK missing.");
    return;
  }

  if (!window.TonWeb) {
    setWalletMeta("TonWeb missing.");
    return;
  }

  const manifestUrl = `${location.origin}/tonconnect-manifest.json`;
  setWalletMeta("Checking manifest...");

  const manifestCheck = await probeManifest(manifestUrl);
  if (!manifestCheck.ok) {
    setWalletMeta(`Manifest FAIL: ${manifestCheck.status}`);
    return;
  }

  setWalletMeta("Manifest OK.");

  try {
    tonui = new window.TON_CONNECT_UI.TonConnectUI({
      manifestUrl,
      buttonRootId: "ton-connect-root"
    });
  } catch (e) {
    console.error(e);
    setWalletMeta("TonConnect init failed: " + String(e));
    return;
  }

  tonui.onStatusChange(async (wallet) => {
    tonConnected = !!wallet;
    tonAddress = wallet?.account?.address || null;

    refreshWalletUI();

    if (tonConnected && tonAddress) {
      await persistConnectedWallet();
    }
  });

  btn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      if (!tonui) {
        setWalletMeta("TonConnect not initialized.");
        return;
      }

      if (!tonConnected) {
        setWalletMeta("Opening wallet modal...");
        await tonui.openModal();
      } else {
        setWalletMeta("Disconnecting...");
        await tonui.disconnect();
      }
    } catch (err) {
      console.error(err);
      setWalletMeta("Wallet action error: " + String(err));
    }
  };

  refreshWalletUI();
}

async function probeManifest(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: String(e) };
  }
}

async function handleWalletButtonClick(e) {
  e.preventDefault();
  e.stopPropagation();

  if (walletActionInFlight) {
    setWalletMeta("Wallet action already running...");
    return;
  }

  walletActionInFlight = true;

  try {
    setWalletMeta("Wallet handler started ✅");

    if (!tonui) {
      setWalletMeta("TonConnect UI is not initialized.");
      return;
    }

    if (!tonConnected) {
      setWalletMeta("Opening wallet modal...");
      await tonui.openModal();
      setWalletMeta("Wallet modal opened. Choose wallet.");
    } else {
      setWalletMeta("Disconnecting wallet...");
      await tonui.disconnect();
      setWalletMeta("Disconnected.");
    }
  } catch (e2) {
    console.error("wallet button error", e2);
    setWalletMeta("Wallet action error: " + String(e2));
  } finally {
    walletActionInFlight = false;
  }
}


function renderProgress({ level, title, xp, xp_need }) {
  const pLvl = $("pLvl");
  const xpFill = $("xpFill");
  const xpText = $("xpText");
  const rankText = $("rankText");

  if (pLvl) pLvl.textContent = `Lv ${level || 1}`;
  if (rankText) rankText.textContent = title || "Rookie";

  const need = Math.max(1, Number(xp_need || 100));
  const cur = Math.max(0, Number(xp || 0));
  const pct = Math.max(0, Math.min(100, Math.floor((cur / need) * 100)));

  if (xpFill) xpFill.style.width = `${pct}%`;
  if (xpText) xpText.textContent = `${cur} / ${need} XP`;
}

async function refreshProfileProgress() {
  if (!currentUser?.tg_id) {
    renderProgress({ level: 1, title: "Rookie", xp: 0, xp_need: 100 });
    return;
  }

  const res = await fetch(`/api/me/progress?user_tg_id=${currentUser.tg_id}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    renderProgress({ level: 1, title: "Rookie", xp: 0, xp_need: 100 });
    return;
  }

  renderProgress({
    level: data.level,
    title: data.title,
    xp: data.xp,
    xp_need: data.xp_need
  });
}

async function refreshTokenInfo() {
  const btn = $("btnBuySwap");
  if (!btn) return;

  btn.disabled = true;

  const res = await fetch(`/api/token/info`, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) {
    btn.textContent = "Buy PUPSI (soon)";
    btn.disabled = true;
    return;
  }

  const data = await res.json().catch(() => ({}));
  tokenInfoCache = data;

  const buyUrl = data.buy_url || "";
  const master = data.jetton_master || "—";
  const symbol = data.symbol || "PUPSI";

  if ($("tokenMeta")) $("tokenMeta").textContent = `${symbol} Jetton`;
  if ($("tokenHint")) $("tokenHint").textContent = `Jetton master: ${master}`;

  if (!buyUrl) {
    btn.textContent = `Buy ${symbol} (soon)`;
    btn.disabled = true;
    return;
  }

  btn.textContent = `Buy ${symbol}`;
  btn.disabled = false;
  btn.onclick = () => {
    try {
      if (isTg && tg?.openTelegramLink) tg.openTelegramLink(buyUrl);
      else window.open(buyUrl, "_blank");
    } catch {
      window.open(buyUrl, "_blank");
    }
  };
}

async function refreshDailyStatus() {
  const btn = $("btnClaimDaily");
  if (!btn) return;

  if (!currentUser?.tg_id) {
    if ($("rewardMeta")) $("rewardMeta").textContent = "Login to claim.";
    btn.disabled = true;
    return;
  }

  if ($("rewardMeta")) $("rewardMeta").textContent = "Daily reward available";
  btn.disabled = false;
}

function initDailyClaim() {
  const btn = $("btnClaimDaily");
  if (!btn) return;

  btn.onclick = async () => {
    if (!currentUser?.tg_id) return;

    btn.disabled = true;
    if ($("rewardMeta")) $("rewardMeta").textContent = "Claiming...";

    const res = await fetch(`/api/rewards/claim?user_tg_id=${currentUser.tg_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if ($("rewardMeta")) $("rewardMeta").textContent = `Failed: ${data?.detail || "try later"}`;
      btn.disabled = false;
      return;
    }

    if ($("rewardMeta")) $("rewardMeta").textContent = `Claimed ✅ (+${data.xp_added || 0} XP)`;
    await refreshProfileProgress().catch(console.error);
  };
}

async function createJettonTransferPayload({
  jettonAmount,
  destinationAddress,
  responseAddress,
  forwardTonAmount,
  comment
}) {
  const TonWeb = window.TonWeb;
  const Cell = TonWeb.boc.Cell;
  const cell = new Cell();

  const OP_TRANSFER = 0xf8a7ea5;
  const queryId = 0;

  cell.bits.writeUint(OP_TRANSFER, 32);
  cell.bits.writeUint(queryId, 64);
  cell.bits.writeCoins(jettonAmount);
  cell.bits.writeAddress(new TonWeb.utils.Address(destinationAddress));
  cell.bits.writeAddress(new TonWeb.utils.Address(responseAddress));
  cell.bits.writeBit(false);
  cell.bits.writeCoins(forwardTonAmount);

  if (comment && String(comment).trim()) {
    const forwardPayload = new Cell();
    forwardPayload.bits.writeUint(0, 32);
    forwardPayload.bits.writeString(String(comment));
    cell.bits.writeBit(true);
    cell.refs.push(forwardPayload);
  } else {
    cell.bits.writeBit(false);
  }

  const boc = await cell.toBoc(false);
  return TonWeb.utils.bytesToBase64(boc);
}

async function buyZonePupsi() {
  if (!selectedZoneId) return;

  if (!currentUser?.tg_id) {
    setZoneBuyHint("Auth first.");
    return;
  }

  if (!tonui || !tonConnected || !tonAddress) {
    setZoneBuyHint("Connect wallet first (Profile → Connect).");
    return;
  }

  if (!window.TonWeb) {
    setZoneBuyHint("TonWeb not loaded.");
    return;
  }

  const shares = Math.max(1, parseInt($("zoneShares")?.value || "1", 10));
  setZoneBuyHint("Preparing PUPSI transaction...");

  const res = await fetch(`/api/tx/zones/buy?user_tg_id=${currentUser.tg_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      zone_id: selectedZoneId,
      shares_amount: shares
    })
  });

  const tx = await res.json().catch(() => ({}));
  if (!res.ok) {
    setZoneBuyHint(`❌ Prepare failed: ${tx?.detail || "see server logs"}`);
    return;
  }

  try {
    const payloadBase64 = await createJettonTransferPayload({
      jettonAmount: tx.jetton_amount,
      destinationAddress: tx.merchant_owner_ton_wallet,
      responseAddress: tonAddress,
      forwardTonAmount: tx.forward_ton_amount_nano || "1",
      comment: tx.comment
    });

    const transaction = {
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [
        {
          address: tx.merchant_jetton_wallet,
          amount: String(tx.gas_amount_nano_ton || "100000000"),
          payload: payloadBase64
        }
      ]
    };

    setZoneBuyHint(`Confirm in wallet: ${tx.jetton_amount_display} ${tx.symbol}...`);

    const result = await tonui.sendTransaction(transaction);
    const tx_boc = result?.boc || "";

    setZoneBuyHint("Sent ✅ Syncing...");

    await fetch(`/api/tx/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: tx.order_id,
        tx_boc
      })
    }).catch(() => {});

    await sleep(300);
    await refreshZoneMyShares(selectedZoneId);
    await refreshMyZones();
    await refreshProfileProgress();

    setZoneBuyHint(`✅ Purchased with ${tx.symbol}!`);
  } catch (e) {
    console.error(e);
    setZoneBuyHint(`❌ Cancelled or failed: ${String(e)}`);
  }
}

async function refreshZoneMyShares(zoneId) {
  if (!zoneId) return;
  if (!currentUser?.tg_id) {
    $("zoneMine").textContent = "0";
    return;
  }

  const res = await fetch(`/api/zones/${zoneId}/my?user_tg_id=${currentUser.tg_id}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  $("zoneMine").textContent = String((res.ok ? (data.my_shares ?? 0) : 0));
}

async function refreshMyZones() {
  const el = $("myZonesList");
  if (!el) return;

  if (!currentUser?.tg_id) {
    el.innerHTML = `<div class="muted">Auth to see your zones.</div>`;
    return;
  }

  const res = await fetch(`/api/me/shares?user_tg_id=${currentUser.tg_id}`, { cache: "no-store" });
  const data = await res.json().catch(() => ([]));

  if (!res.ok || !Array.isArray(data) || data.length === 0) {
    el.innerHTML = `<div class="muted">Empty.</div>`;
    return;
  }

  el.innerHTML = data.map(x => `
    <div class="zoneRow">
      <div class="left">
        <div class="title">${escapeHtml(x.zone_name)}</div>
        <div class="meta">Zone #${escapeHtml(x.zone_id)}</div>
      </div>
      <div class="right">
        <div><b>${escapeHtml(x.my_shares)}</b> shares</div>
      </div>
    </div>
  `).join("");
}

(function boot() {
  const buildTag = $("buildTag");
  if (buildTag) buildTag.textContent = `BUILD: ${BUILD}`;

  installGlobalTouchTracer();

  const btnAuth = $("btnAuth");
  if (btnAuth) btnAuth.onclick = authViaMiniApp;

  initTabs();
  initDailyClaim();
  initMap();
  initTonConnect();

  loadZones()
    .then(() => {
      const cached = loadAuth();
      if (cached?.tg_id) renderUser(cached);

      if (isTg && tg?.initData) {
        authViaMiniApp().catch(console.error);
      } else {
        setHint("❌ Open inside Telegram Mini App.");
      }
    })
    .catch((e) => {
      console.error(e);
      setHint("❌ Failed to load /zones.geojson");
    });
})();