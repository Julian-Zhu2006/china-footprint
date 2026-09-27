const MAP = window.MAP;
const STORE = "china-footprint-v1";
const DIM_STORE = "china-footprint-dim";
const byId = Object.fromEntries(MAP.cities.map((city) => [city.adcode, city]));
const SVGNS = "http://www.w3.org/2000/svg";

const visited = loadVisited();
let filter = "all";
let query = "";
let hotId = "";

const svg = document.getElementById("map");
const inset = document.getElementById("inset");
const listEl = document.getElementById("list");
const statsEl = document.getElementById("stats");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const capName = document.getElementById("cap-name");
const capSub = document.getElementById("cap-sub");

const base = {
  x: MAP.viewBox[0],
  y: MAP.viewBox[1],
  w: MAP.viewBox[2],
  h: MAP.viewBox[3],
};
let view = { ...base };

function loadVisited() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "[]");
    return new Set(raw.filter((id) => byId[id]));
  } catch {
    return new Set();
  }
}

function saveVisited() {
  localStorage.setItem(STORE, JSON.stringify([...visited]));
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

function drawMap(target, space) {
  const box = space === "inset" ? MAP.insetViewBox : MAP.viewBox;
  target.setAttribute("viewBox", box.join(" "));
  const ocean = document.createElementNS(SVGNS, "rect");
  ocean.setAttribute("class", "ocean");
  ocean.setAttribute("x", box[0]);
  ocean.setAttribute("y", box[1]);
  ocean.setAttribute("width", box[2]);
  ocean.setAttribute("height", box[3]);
  target.appendChild(ocean);

  if (space === "inset" && MAP.nineDash) {
    const line = document.createElementNS(SVGNS, "path");
    line.setAttribute("class", "nine");
    line.setAttribute("d", MAP.nineDash);
    target.appendChild(line);
  }

  for (const city of MAP.cities) {
    if (city.space !== space) continue;
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("class", "city");
    path.setAttribute("d", city.path);
    path.dataset.adcode = city.adcode;
    const title = document.createElementNS(SVGNS, "title");
    title.textContent = `${city.name} · ${city.province}`;
    path.appendChild(title);
    target.appendChild(path);
  }
}

function paint() {
  document.querySelectorAll("path.city").forEach((path) => {
    path.classList.toggle("on", visited.has(path.dataset.adcode));
  });
}

function renderStats() {
  const provinces = new Set([...visited].map((id) => byId[id].provinceAdcode));
  statsEl.innerHTML = `<b>${visited.size}</b><span>座已去过<br>${provinces.size} 个省级区域 · 共 ${MAP.cities.length} 处可点</span>`;
}

function matches(city) {
  const on = visited.has(city.adcode);
  if (filter === "been" && !on) return false;
  if (filter === "not" && on) return false;
  if (!query) return true;
  return city.name.includes(query) || city.province.includes(query);
}

function renderList() {
  const chunks = [];
  let shown = 0;
  for (const province of MAP.provinces) {
    const cities = province.cities.map((id) => byId[id]).filter(matches);
    if (!cities.length) continue;
    shown += cities.length;
    const been = province.cities.filter((id) => visited.has(id)).length;
    const allOn = been === province.cities.length;
    const rows = cities.map((city) => {
      const badge = city.kind === "direct" ? "<em>省直辖</em>" : "";
      const hot = city.adcode === hotId ? " is-hot" : "";
      const on = visited.has(city.adcode) ? " is-on" : "";
      return `<button type="button" class="city-row${on}${hot}" data-adcode="${city.adcode}"><i></i><span>${city.name}</span>${badge}</button>`;
    }).join("");
    chunks.push(`
      <section class="prov">
        <div class="prov-head">
          <button type="button" class="prov-name" data-province="${province.adcode}">${province.name}</button>
          <span class="prov-count">${been}/${province.cities.length}</span>
          <button type="button" class="prov-all" data-province="${province.adcode}" data-mode="${allOn ? "off" : "on"}">${allOn ? "清空" : "全标"}</button>
        </div>
        ${rows}
      </section>`);
  }
  listEl.innerHTML = shown
    ? chunks.join("")
    : `<p class="empty">${query ? "没有叫这个的地方。" : "这一栏还是空的。"}</p>`;
  document.querySelectorAll("path.city").forEach((path) => {
    const city = byId[path.dataset.adcode];
    const hit = query && (city.name.includes(query) || city.province.includes(query));
    path.classList.toggle("hit", Boolean(hit));
  });
}

function setCaption(city) {
  if (!city) {
    capName.textContent = "移到城市上";
    capSub.textContent = "点击记录，再点一次取消";
    return;
  }
  capName.textContent = city.name;
  const state = visited.has(city.adcode) ? "已去过" : "还没记";
  capSub.textContent = `${city.province} · ${state}`;
}

function setHot(adcode) {
  if (hotId === adcode) return;
  document.querySelectorAll("path.city.hot").forEach((path) => path.classList.remove("hot"));
  hotId = adcode || "";
  if (!hotId) {
    setCaption(null);
    document.querySelectorAll(".city-row.is-hot").forEach((row) => row.classList.remove("is-hot"));
    return;
  }
  document.querySelectorAll(`path.city[data-adcode="${hotId}"]`).forEach((path) => path.classList.add("hot"));
  document.querySelectorAll(".city-row").forEach((row) => {
    row.classList.toggle("is-hot", row.dataset.adcode === hotId);
  });
  setCaption(byId[hotId]);
}

function toggle(adcode) {
  if (visited.has(adcode)) visited.delete(adcode);
  else visited.add(adcode);
  saveVisited();
  paint();
  renderStats();
  renderList();
  if (hotId === adcode) setCaption(byId[adcode]);
  setStatus("");
}

function flash(adcode) {
  document.querySelectorAll(`path.city[data-adcode="${adcode}"]`).forEach((path) => {
    path.classList.remove("flash");
    void path.offsetWidth;
    path.classList.add("flash");
  });
}

function applyView() {
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
}

function clampView() {
  const minW = base.w / 28;
  view.w = Math.min(base.w, Math.max(minW, view.w));
  view.h = view.w * (base.h / base.w);
  if (view.w >= base.w - 0.5) {
    view.x = base.x;
    view.y = base.y;
    view.w = base.w;
    view.h = base.h;
    return;
  }
  const marginX = view.w * 0.4;
  const marginY = view.h * 0.4;
  view.x = Math.min(Math.max(view.x, base.x - marginX), base.x + base.w - view.w + marginX);
  view.y = Math.min(Math.max(view.y, base.y - marginY), base.y + base.h - view.h + marginY);
}

function clientToWorld(clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function zoomAt(clientX, clientY, factor) {
  const world = clientToWorld(clientX, clientY);
  const mx = (world.x - view.x) / view.w;
  const my = (world.y - view.y) / view.h;
  view.w /= factor;
  clampView();
  view.x = world.x - mx * view.w;
  view.y = world.y - my * view.h;
  clampView();
  applyView();
}

function fitCities(adcodes) {
  const boxes = adcodes
    .map((id) => byId[id])
    .filter((city) => city && city.space === "main")
    .map((city) => city.box);
  if (!boxes.length) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y, w, h] of boxes) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  const pad = Math.max(18, (x1 - x0) * 0.2, (y1 - y0) * 0.2);
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  let w = Math.max(x1 - x0, 1);
  let h = Math.max(y1 - y0, 1);
  const aspect = base.w / base.h;
  if (w / h > aspect) {
    const nextH = w / aspect;
    y0 -= (nextH - h) / 2;
    h = nextH;
  } else {
    const nextW = h * aspect;
    x0 -= (nextW - w) / 2;
    w = nextW;
  }
  view.x = x0;
  view.y = y0;
  view.w = w;
  clampView();
  applyView();
}

function bindPan(target) {
  let drag = null;
  target.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    target.setPointerCapture(event.pointerId);
    drag = {
      x: event.clientX,
      y: event.clientY,
      view: { ...view },
      moved: false,
      adcode: event.target.dataset.adcode || "",
    };
    if (target === svg) svg.classList.add("is-drag");
  });
  target.addEventListener("pointermove", (event) => {
    const adcode = event.target.dataset.adcode || "";
    if (adcode) setHot(adcode);
    else if (!drag || !drag.moved) setHot("");
    if (!drag || target !== svg) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const matrix = svg.getScreenCTM();
    view.x = drag.view.x - dx / matrix.a;
    view.y = drag.view.y - dy / matrix.d;
    clampView();
    applyView();
  });
  target.addEventListener("pointerup", (event) => {
    if (!drag) return;
    if (!drag.moved && drag.adcode) toggle(drag.adcode);
    drag = null;
    svg.classList.remove("is-drag");
  });
  target.addEventListener("pointerleave", () => setHot(""));
}

svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

document.getElementById("zoom-in").addEventListener("click", () => {
  const rect = svg.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
});
document.getElementById("zoom-out").addEventListener("click", () => {
  const rect = svg.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.25);
});
document.getElementById("zoom-reset").addEventListener("click", () => {
  view = { ...base };
  applyView();
});

searchEl.addEventListener("input", () => {
  query = searchEl.value.trim();
  renderList();
});
searchEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const row = listEl.querySelector(".city-row");
  if (!row) return;
  const city = byId[row.dataset.adcode];
  if (city.space === "main") fitCities([city.adcode]);
  flash(city.adcode);
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    filter = chip.dataset.filter;
    document.querySelectorAll(".chip").forEach((item) => item.classList.toggle("is-active", item === chip));
    renderList();
  });
});

document.getElementById("dim").addEventListener("change", (event) => {
  document.body.classList.toggle("dim-unvisited", event.target.checked);
  localStorage.setItem(DIM_STORE, event.target.checked ? "1" : "0");
});

listEl.addEventListener("click", (event) => {
  const cityBtn = event.target.closest(".city-row");
  if (cityBtn) {
    const city = byId[cityBtn.dataset.adcode];
    toggle(city.adcode);
    if (city.space === "main") fitCities([city.adcode]);
    flash(city.adcode);
    return;
  }
  const nameBtn = event.target.closest(".prov-name");
  if (nameBtn) {
    const province = MAP.provinces.find((item) => item.adcode === nameBtn.dataset.province);
    fitCities(province.cities);
    return;
  }
  const allBtn = event.target.closest(".prov-all");
  if (!allBtn) return;
  const province = MAP.provinces.find((item) => item.adcode === allBtn.dataset.province);
  const turnOn = allBtn.dataset.mode === "on";
  for (const id of province.cities) {
    if (turnOn) visited.add(id);
    else visited.delete(id);
  }
  saveVisited();
  paint();
  renderStats();
  renderList();
});

document.getElementById("export").addEventListener("click", () => {
  const payload = {
    title: "中国足迹",
    updated: new Date().toISOString(),
    visited: [...visited],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "中国足迹.json";
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus(`已导出 ${visited.size} 座。`);
});

document.getElementById("import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const ids = Array.isArray(data) ? data : data.visited;
    if (!Array.isArray(ids)) throw new Error("bad");
    visited.clear();
    let skipped = 0;
    for (const id of ids) {
      const key = String(id);
      if (byId[key]) visited.add(key);
      else skipped += 1;
    }
    saveVisited();
    paint();
    renderStats();
    renderList();
    setStatus(skipped ? `导入了 ${visited.size} 座，另有 ${skipped} 个代号对不上。` : `导入了 ${visited.size} 座。`);
  } catch {
    setStatus("这个文件读不了。");
  }
});

document.getElementById("clear").addEventListener("click", () => {
  if (!visited.size) return;
  if (!confirm("确定清空全部足迹？这只影响这台浏览器里的记录。")) return;
  visited.clear();
  saveVisited();
  paint();
  renderStats();
  renderList();
  setCaption(hotId ? byId[hotId] : null);
  setStatus("已清空。");
});

if (localStorage.getItem(DIM_STORE) === "1") {
  document.getElementById("dim").checked = true;
  document.body.classList.add("dim-unvisited");
}

drawMap(svg, "main");
drawMap(inset, "inset");
bindPan(svg);
bindPan(inset);
paint();
renderStats();
renderList();
applyView();
