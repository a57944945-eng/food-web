const ALL = "全部";

const state = {
  restaurants: [],
  userLocation: null,
  search: "",
  region: ALL,
  category: ALL,
  maxDistanceKm: "all",
  openNowOnly: false,
};

const els = {
  list: document.querySelector("#list"),
  template: document.querySelector("#restaurantTemplate"),
  resultCount: document.querySelector("#resultCount"),
  locationStatus: document.querySelector("#locationStatus"),
  locateBtn: document.querySelector("#locateBtn"),
  searchInput: document.querySelector("#searchInput"),
  regionSelect: document.querySelector("#regionSelect"),
  categorySelect: document.querySelector("#categorySelect"),
  distanceSelect: document.querySelector("#distanceSelect"),
  openNowOnly: document.querySelector("#openNowOnly"),
  dataWarning: document.querySelector("#dataWarning"),
};

init();

async function init() {
  const response = await fetch(`./data/restaurants.json?v=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json();
  state.restaurants = payload.restaurants;
  fillSelect(els.regionSelect, uniqueValues("region"));
  fillSelect(els.categorySelect, uniqueValues("category"));
  bindEvents();
  render();
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });

  els.regionSelect.addEventListener("change", (event) => {
    state.region = event.target.value;
    render();
  });

  els.categorySelect.addEventListener("change", (event) => {
    state.category = event.target.value;
    render();
  });

  els.distanceSelect.addEventListener("change", (event) => {
    state.maxDistanceKm = event.target.value;
    if (state.maxDistanceKm !== "all" && !state.userLocation) {
      els.locationStatus.textContent = "請先按定位附近";
    }
    render();
  });

  els.openNowOnly.addEventListener("change", (event) => {
    state.openNowOnly = event.target.checked;
    render();
  });

  els.locateBtn.addEventListener("click", locateUser);
}

function render() {
  const items = filteredRestaurants().sort(sortByDistance);
  els.list.replaceChildren(...items.map(renderCard));
  els.resultCount.textContent = `${items.length} 間符合`;
  renderDataWarning(items);
}

function filteredRestaurants() {
  return state.restaurants.filter((item) => {
    const haystack = [item.name, item.region, item.address, item.recommended, item.notes, item.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !state.search || haystack.includes(state.search);
    const matchesRegion = state.region === ALL || item.region === state.region;
    const matchesCategory = state.category === ALL || item.category === state.category;
    const matchesOpen = !state.openNowOnly || isOpenNow(item);
    const matchesDistance = isWithinDistance(item);
    return matchesSearch && matchesRegion && matchesCategory && matchesOpen && matchesDistance;
  });
}

function renderCard(item) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.querySelector("h2").textContent = item.name;
  node.querySelector(".meta").textContent = [item.region, cleanAddress(item.address)].filter(Boolean).join(" / ");
  node.querySelector(".recommend").textContent = item.recommended || "尚未填寫推薦餐點";
  node.querySelector(".notes").textContent = item.notes || "";
  node.querySelector(".distance").textContent = distanceLabel(item);

  node.append(mapLink(item));

  const badges = node.querySelector(".badges");
  badges.append(badge(item.category || "未分類"));
  badges.append(badge(openStatusLabel(item), !isOpenNow(item)));
  if (item.dataIssues?.includes("missing_opening_hours")) badges.append(badge("缺營業時間", true));
  if (item.dataIssues?.includes("missing_coordinates")) badges.append(badge("缺座標", true));
  if (item.dataIssues?.includes("missing_precise_address")) badges.append(badge("地址待補", true));
  return node;
}

function renderDataWarning(items) {
  const missingHours = items.filter((item) => item.dataIssues?.includes("missing_opening_hours")).length;
  const missingCoordinates = items.filter((item) => item.dataIssues?.includes("missing_coordinates")).length;
  if (!missingHours && !missingCoordinates) {
    els.dataWarning.hidden = true;
    return;
  }
  els.dataWarning.hidden = false;
  els.dataWarning.textContent =
    `目前資料還不能可靠判斷附近與營業中：${missingCoordinates} 筆缺座標，${missingHours} 筆缺營業時間。`;
}

function fillSelect(select, values) {
  select.replaceChildren(...[ALL, ...values].map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
}

function uniqueValues(key) {
  return [...new Set(state.restaurants.map((item) => item[key]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant")
  );
}

function locateUser() {
  if (!navigator.geolocation) {
    els.locationStatus.textContent = "此瀏覽器不支援定位";
    return;
  }

  els.locationStatus.textContent = "定位中";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      els.locationStatus.textContent = "已取得位置";
      render();
    },
    () => {
      els.locationStatus.textContent = "定位失敗或未允許";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function sortByDistance(a, b) {
  const da = distanceFromUser(a);
  const db = distanceFromUser(b);
  if (da === null && db === null) return String(a.id).localeCompare(String(b.id), "zh-Hant");
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db;
}

function distanceLabel(item) {
  const distance = distanceFromUser(item);
  return distance === null ? "距離未知" : `${distance.toFixed(1)} km`;
}

function distanceFromUser(item) {
  if (!state.userLocation || item.latitude === null || item.longitude === null) return null;
  if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return null;
  return haversineKm(state.userLocation, item);
}

function isWithinDistance(item) {
  if (state.maxDistanceKm === "all") return true;
  const distance = distanceFromUser(item);
  if (distance === null) return false;
  return distance <= Number(state.maxDistanceKm);
}

function haversineKm(a, b) {
  const earthKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function isOpenNow(item) {
  const ranges = todayHours(item);
  if (!ranges.length) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return ranges.some((range) => {
    const parsed = parseTimeRange(range);
    if (!parsed) return false;
    const { start, end } = parsed;
    if (end < start) return currentMinutes >= start || currentMinutes <= end;
    return currentMinutes >= start && currentMinutes <= end;
  });
}

function openStatusLabel(item) {
  if (item.dataIssues?.includes("missing_opening_hours")) return "營業時間未知";
  return isOpenNow(item) ? "營業中" : "未營業";
}

function todayHours(item) {
  if (!item.openingHours) return [];
  const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const value = item.openingHours[keys[new Date().getDay()]];
  return Array.isArray(value) ? value : [];
}

function parseTimeRange(range) {
  const match = String(range).match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return {
    start: Number(match[1]) * 60 + Number(match[2]),
    end: Number(match[3]) * 60 + Number(match[4]),
  };
}

function cleanAddress(address) {
  if (!address || address === "Not in source") return "";
  return address;
}

function badge(text, isIssue = false) {
  const element = document.createElement("span");
  element.className = isIssue ? "badge issue" : "badge";
  element.textContent = text;
  return element;
}

function mapLink(item) {
  const link = document.createElement("a");
  link.className = "mapLink";
  link.href = googleMapsUrl(item);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Google Maps";
  return link;
}

function googleMapsUrl(item) {
  const query = [item.name, item.address].filter(Boolean).join(" ");
  if (query) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;
  }

  return item.mapUrl || "https://www.google.com/maps";
}
