import type { FieldType, FieldZone } from "./readers/base.js";

export interface FormatFieldOptions {
  type: FieldType;
  value: unknown;
  zone: FieldZone;
  locale: string;
}

export function formatField(options: FormatFieldOptions): string {
  const { type, value, zone } = options;

  if (value === null || value === undefined) {
    return "—";
  }

  switch (type) {
    case "percent":
      return formatPercent(value, zone);
    case "timestamp":
      return formatTimestamp(value, zone, options.locale);
    case "tokens":
      return formatTokens(value, zone, options.locale);
    case "cost":
      return formatCost(value, options.locale);
    case "count":
      return formatCount(value, options.locale);
    case "bool":
      return formatBool(value, zone);
    case "text":
      return formatText(value, zone);
    default:
      return String(value);
  }
}

function formatPercent(value: unknown, _zone: FieldZone): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const rounded = Math.round(num);
  return `${rounded}%`;
}

function formatTimestamp(value: unknown, zone: FieldZone, locale: string): string {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return "—";

  // APIs return Unix seconds; Date.now() uses ms. Normalize to ms.
  const num = raw < 1e12 ? raw * 1000 : raw;
  const now = Date.now();
  const diffSec = Math.round((num - now) / 1000);

  if (diffSec < 0) return "now";

  const relative = formatRelative(diffSec, zone);
  if (zone === "panel") {
    const date = new Date(num);
    const abs = date.toLocaleString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${relative} (${abs})`;
  }
  return relative;
}

function formatRelative(seconds: number, zone: FieldZone): string {
  const sep = zone === "status" ? "" : " ";
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(seconds / 86400);
  const weeks = Math.floor(seconds / 604800);

  if (seconds < 60) return "now";
  if (seconds < 3600) return `${mins}m`;
  if (seconds < 86400) {
    const h = hours;
    const m = mins % 60;
    return m > 0 ? `${h}h${sep}${m}m` : `${h}h`;
  }
  if (seconds < 604800) {
    const d = days;
    const h = hours % 24;
    return h > 0 ? `${d}d${sep}${h}h` : `${d}d`;
  }
  const w = weeks;
  const d = days % 7;
  return d > 0 ? `${w}w${sep}${d}d` : `${w}w`;
}

function formatTokens(value: unknown, zone: FieldZone, locale: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";

  const abs = Math.abs(num);
  const suffix = abs >= 1e9 ? "G" : abs >= 1e6 ? "M" : abs >= 1e3 ? "K" : "";
  const divisor = abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : abs >= 1e3 ? 1e3 : 1;

  if (suffix === "") {
    return String(Math.round(num));
  }

  const scaled = num / divisor;
  const formatted = abs >= 100 * divisor ? Math.round(scaled).toString() : scaled.toFixed(1);

  if (zone === "panel") {
    return `${num.toLocaleString(locale)} (${formatted}${suffix})`;
  }
  return `${formatted}${suffix}`;
}

function formatCost(value: unknown, locale: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

function formatCount(value: unknown, locale: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";

  try {
    return new Intl.NumberFormat(locale).format(Math.round(num));
  } catch {
    return String(Math.round(num));
  }
}

function formatBool(value: unknown, zone: FieldZone): string {
  if (zone === "status") {
    return value ? "✓" : "✗";
  }
  return value ? "yes" : "no";
}

function formatText(value: unknown, zone: FieldZone): string {
  const str = String(value);
  if (zone === "status" && str.length > 10) {
    return `${str.slice(0, 8)}…`;
  }
  return str;
}
