import { CURRENCIES, DEFAULT_SETTINGS } from "./constants";

export function toLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayISO() {
  return toLocalDateString(new Date());
}

export function addDaysISO(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

export function startOfMonthISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function startOfYearISO(date = new Date()) {
  return `${date.getFullYear()}-01-01`;
}

export function startOfWeekISO(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? 6 : day - 1;
  copy.setDate(copy.getDate() - diff);
  return toLocalDateString(copy);
}

export function toDisplayDate(value) {
  if (!value) return "—";

  const raw = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);

  if (Number.isNaN(dateOnly.getTime())) return raw;

  return dateOnly.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function toDisplayDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return toDisplayDate(value);
}

export function getCurrency(settings) {
  const code = settings?.currency || "PKR";
  return CURRENCIES.find((currency) => currency.code === code) || CURRENCIES[0];
}

export function formatMoney(amount, settings) {
  const currency = getCurrency(settings);
  const number = Number(amount);
  const safeNumber = Number.isFinite(number) ? number : 0;

  const formatted = safeNumber.toLocaleString(currency.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${currency.symbol} ${formatted}`;
}

export function formatNumber(value, settings) {
  const currency = getCurrency(settings);
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString(currency.locale);
}

export function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number).toLocaleString() : "0";
}

export function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

export function isValidEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

export function isValidPhone(value) {
  if (!value) return true;
  return /^[0-9+\-()\s]{6,20}$/.test(String(value).trim());
}

export function isNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

export function isPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

export function isNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0;
}

export function hasRecordedCost(value) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

export function toDateKey(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return toLocalDateString(date);
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function expiryInfo(expiry, warningDays = 30) {
  const today = todayISO();

  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(String(expiry))) {
    return { status: "unknown", label: "No expiry", days: null };
  }

  const expiryDate = new Date(`${expiry}T12:00:00`);
  const todayDate = new Date(`${today}T12:00:00`);
  const days = Math.round((expiryDate.getTime() - todayDate.getTime()) / 86400000);

  if (days < 0) {
    return { status: "expired", label: "Expired", days };
  }

  if (days <= Number(warningDays || 30)) {
    return {
      status: "expiring",
      label: days === 0 ? "Expires today" : `${days} day${days === 1 ? "" : "s"} left`,
      days,
    };
  }

  return { status: "ok", label: "Valid", days };
}

export function getStockStatus(quantity, lowStockLimit = 10) {
  const stock = Number(quantity) || 0;

  if (stock <= 0) {
    return { status: "out", label: "Out of stock" };
  }

  if (stock <= Number(lowStockLimit)) {
    return { status: "low", label: "Low stock" };
  }

  return { status: "in", label: "In stock" };
}

export function generateInvoiceNumber(prefix = "INV") {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const timePart = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const randomPart = Math.floor(100 + Math.random() * 900);
  const safePrefix = normalizeText(prefix).replace(/[^A-Za-z0-9\-_/]/g, "") || "INV";

  return `${safePrefix}-${datePart}-${timePart}${randomPart}`;
}

export function saleHasCompleteCost(sale) {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  return (
    items.length > 0 &&
    items.every((item) => hasRecordedCost(item.costPrice))
  );
}

export function saleCost(sale) {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  return items.reduce(
    (total, item) => total + Number(item.costPrice || 0) * Number(item.quantity || 0),
    0
  );
}

export function saleItemCount(sale) {
  return (Array.isArray(sale?.items) ? sale.items : []).reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );
}

export function isCompletedSale(sale) {
  return (sale?.status || "completed") !== "cancelled";
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadCSV(filename, headers, rows) {
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ];
  const blob = new Blob([`\ufeff${lines.join("\r\n")}`], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, filename);
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function getWeekStart(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return toLocalDateString(date);
}

export function getBucketKey(dateString, groupBy) {
  if (!dateString) return "unknown";
  if (groupBy === "month") return dateString.slice(0, 7);
  if (groupBy === "year") return dateString.slice(0, 4);
  if (groupBy === "week") return getWeekStart(dateString);
  return dateString.slice(0, 10);
}

export function prettyBucket(key, groupBy) {
  if (!key || key === "unknown") return "Unknown";
  if (groupBy === "month") {
    const date = new Date(`${key}-01T12:00:00`);
    return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }
  if (groupBy === "year") return key;
  if (groupBy === "week") {
    return `Week of ${toDisplayDate(key)}`;
  }
  return toDisplayDate(key);
}

export function makeRangePreset(preset) {
  const now = new Date();

  if (preset === "today") {
    return { start: todayISO(), end: todayISO() };
  }

  if (preset === "week") {
    return { start: startOfWeekISO(now), end: todayISO() };
  }

  if (preset === "month") {
    return { start: startOfMonthISO(now), end: todayISO() };
  }

  if (preset === "year") {
    return { start: startOfYearISO(now), end: todayISO() };
  }

  return { start: "", end: "" };
}

export function mergeSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
