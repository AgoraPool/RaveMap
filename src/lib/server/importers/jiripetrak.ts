import { getEnv } from "../env";
import { getNostrEventRepository } from "../nostr-repository";
import { randomSlugSuffix, slugify } from "../slug";
import type { AdminEventDto, CreateEventCommand } from "../nostr-types";

export type ImportedEvent = {
  sourceEventId: string;
  rawTitle: string;
  isHighlightedOnSource: boolean;
  sourceDateRaw?: string;
  sourceUpdatedAt?: Date | null;
  sourcePublicationAt?: Date | null;
  sourceContentHash: string;
  warnings: string[];
  title: string;
  summary: string;
  publicLocation: string;
  publicLatitude?: number;
  publicLongitude?: number;
  startsAt: Date;
  endAt?: Date;
  coverImageUrl?: string;
  externalUrl: string;
  sourceName: string;
  sourceUrl: string;
  genres: string[];
  lineup: string[];
  tags: string[];
  galleryImageUrls: string[];
};

type SyncResult = {
  sourceUrl: string;
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  pending: number;
  events: Array<{
    slug?: string;
    title: string;
    sourceUrl: string;
    action: "created" | "updated" | "skipped" | "pending";
    reason?: string;
  }>;
};

const SOURCE_NAME = "Jiri Petrak freetekno calendar";
const SOURCE_DISPLAY_NAME = "Jiří Petrák.cz";
const SOURCE_IMPORT_VERSION = "jiripetrak-description-lineup-coordinates-v2";
const DEFAULT_LOCATION = "Česko";
const DETAIL_FETCH_CONCURRENCY = 2;
const DETAIL_FETCH_DELAY_MS = 350;
const DETAIL_FETCH_TIMEOUT_MS = 8000;
const SYNC_WRITE_LIMIT = 3;
const SYNC_SOFT_TIMEOUT_MS = 14_000;
const EVENT_HINT_RE = /(tekno|techno|freetekno|free tekno|party|parties|rave|soundsystem|sound system|festival|open air|dnb|drum|bass|hardtek|jungle|acid|core)/i;
const GENERIC_TITLE_RE = /^(?:detail|více|vice|read more|zobrazit více|more|info|calendar|kalendář|kalendar)$/i;
const NAVIGATION_TEXT_RE =
  /^(?:úvodní strana|uvodni strana|akce a parties|tekno parties|freetekno|kalendář událostí|kalendar udalosti|kontakt|facebook|instagram|mapy\.com|www\.facebook\.com)$/i;
const FLAG_RE = /[\u{1F1E6}-\u{1F1FF}]/gu;

type Coordinates = {
  latitude: number;
  longitude: number;
};

const CZECH_MONTHS: Record<string, number> = {
  leden: 0,
  ledna: 0,
  unor: 1,
  unora: 1,
  únor: 1,
  února: 1,
  brezen: 2,
  brezna: 2,
  březen: 2,
  března: 2,
  duben: 3,
  dubna: 3,
  kveten: 4,
  kvetna: 4,
  květen: 4,
  května: 4,
  cerven: 5,
  cervna: 5,
  červen: 5,
  června: 5,
  cervenec: 6,
  cervence: 6,
  červenec: 6,
  července: 6,
  srpen: 7,
  srpna: 7,
  zari: 8,
  září: 8,
  rijen: 9,
  rijna: 9,
  říjen: 9,
  října: 9,
  listopad: 10,
  listopadu: 10,
  prosinec: 11,
  prosince: 11,
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalizeSpaces(value: string): string {
  return decodeHtml(value).replace(/[ \t\f\v]+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return decodeHtml(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToText(value: string): string {
  const withBreaks = value
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return normalizeText(withBreaks);
}

function stripTags(value: string): string {
  return normalizeSpaces(value.replace(/<[^>]+>/g, " "));
}

function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return undefined;
  }
}

function sourceEventIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value, "https://www.jiripetrak.cz");
    return url.pathname.match(/-(\d+)\/?$/)?.[1];
  } catch {
    return value.match(/-(\d+)\/?$/)?.[1];
  }
}

function isInternalEventDetailUrl(value: string, baseUrl: string): boolean {
  const absolute = absoluteUrl(value, baseUrl);
  if (!absolute) {
    return false;
  }

  try {
    const base = new URL(baseUrl);
    const url = new URL(absolute);
    return url.origin === base.origin && /^\/cs\/.+-\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function sourceContentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function versionedSourceContentHash(value: string): string {
  return `${SOURCE_IMPORT_VERSION}:${sourceContentHash(value)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = (AbortSignal as typeof AbortSignal & { timeout?: (timeoutMs: number) => AbortSignal }).timeout;
  return timeout ? timeout(ms) : undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseCzechMetadataDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeSpaces(value);
  const withTime = normalized.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\s+([01]?\d|2[0-3])[:.](\d{2})\b/);
  if (withTime) {
    return (
      makeDate(
        Number.parseInt(withTime[3], 10),
        Number.parseInt(withTime[2], 10) - 1,
        Number.parseInt(withTime[1], 10),
        `${withTime[4]}:${withTime[5]}`,
      ) ?? null
    );
  }

  const numeric = normalized.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\b/);
  if (numeric) {
    return makeDate(Number.parseInt(numeric[3], 10), Number.parseInt(numeric[2], 10) - 1, Number.parseInt(numeric[1], 10), "00:00") ?? null;
  }

  return null;
}

function getTimeParts(text: string): { hours: number; minutes: number } {
  const match = text.match(/\b([01]?\d|2[0-3])[:.](\d{2})\b/);
  if (match) {
    return {
      hours: Number.parseInt(match[1], 10),
      minutes: Number.parseInt(match[2], 10),
    };
  }

  const hourMatch = text.match(/\b([01]?\d|2[0-3])\s*h\b/i);
  return {
    hours: hourMatch ? Number.parseInt(hourMatch[1], 10) : 20,
    minutes: 0,
  };
}

function lastSundayOfMonth(year: number, month: number): number {
  const date = new Date(Date.UTC(year, month + 1, 0));
  return date.getUTCDate() - date.getUTCDay();
}

function pragueOffsetHours(year: number, month: number, day: number, hours: number): number {
  const marchSwitchDay = lastSundayOfMonth(year, 2);
  const octoberSwitchDay = lastSundayOfMonth(year, 9);

  if (month < 2 || month > 9) {
    return 1;
  }

  if (month > 2 && month < 9) {
    return 2;
  }

  if (month === 2) {
    return day > marchSwitchDay || (day === marchSwitchDay && hours >= 2) ? 2 : 1;
  }

  return day < octoberSwitchDay || (day === octoberSwitchDay && hours < 3) ? 2 : 1;
}

function makeDate(year: number, month: number, day: number, text: string): Date | undefined {
  const { hours, minutes } = getTimeParts(text);
  const offsetHours = pragueOffsetHours(year, month, day, hours);
  const date = new Date(Date.UTC(year, month, day, hours - offsetHours, minutes, 0, 0));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDateFromText(text: string): Date | undefined {
  const normalized = normalizeText(text);
  const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?:[ T]([01]?\d|2[0-3]):(\d{2}))?\b/);
  if (iso) {
    const year = Number.parseInt(iso[1], 10);
    const month = Number.parseInt(iso[2], 10) - 1;
    const day = Number.parseInt(iso[3], 10);
    const timeText = iso[4] ? `${iso[4]}:${iso[5]}` : normalized;
    return makeDate(year, month, day, timeText);
  }

  const numeric = normalized.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})(?:\s+([01]?\d|2[0-3])[:.](\d{2}))?\b/);
  if (numeric) {
    return makeDate(
      Number.parseInt(numeric[3], 10),
      Number.parseInt(numeric[2], 10) - 1,
      Number.parseInt(numeric[1], 10),
      numeric[4] ? `${numeric[4]}:${numeric[5]}` : normalized.slice(numeric.index ?? 0),
    );
  }

  const numericWithoutYear = normalized.match(/\b(\d{1,2})\.\s*(\d{1,2})\.(?:\s+([01]?\d|2[0-3])[:.](\d{2}))?\b/);
  if (numericWithoutYear) {
    const now = new Date();
    const month = Number.parseInt(numericWithoutYear[2], 10) - 1;
    const day = Number.parseInt(numericWithoutYear[1], 10);
    const timeText = numericWithoutYear[3] ? `${numericWithoutYear[3]}:${numericWithoutYear[4]}` : normalized;
    const currentYearDate = makeDate(now.getUTCFullYear(), month, day, timeText);
    if (currentYearDate && currentYearDate.getTime() > now.getTime() - 30 * 24 * 60 * 60 * 1000) {
      return currentYearDate;
    }

    return makeDate(now.getUTCFullYear() + 1, month, day, timeText);
  }

  const range = normalized.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*[-–]\s*\d{1,2}\.\s*\d{1,2}\.\s*(20\d{2})\b/);
  if (range) {
    return makeDate(Number.parseInt(range[3], 10), Number.parseInt(range[2], 10) - 1, Number.parseInt(range[1], 10), normalized);
  }

  const named = normalized.match(/\b(\d{1,2})\.?\s+([A-Za-zÁ-ž]+)\s+(20\d{2})\b/i);
  if (named) {
    const month = CZECH_MONTHS[named[2].toLowerCase()];
    if (month !== undefined) {
      return makeDate(Number.parseInt(named[3], 10), month, Number.parseInt(named[1], 10), normalized);
    }
  }

  return undefined;
}

function parseEndDateFromText(text: string, start: Date): Date | undefined {
  const validEnd = (date: Date | undefined) => (date && date.getTime() > start.getTime() ? date : undefined);
  const normalized = normalizeText(text);
  const numericRange = normalized.match(/\b\d{1,2}\.\s*\d{1,2}\.\s*[-–]\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\b/);
  if (numericRange) {
    return validEnd(
      makeDate(
        Number.parseInt(numericRange[3], 10),
        Number.parseInt(numericRange[2], 10) - 1,
        Number.parseInt(numericRange[1], 10),
        "23:59",
      ),
    );
  }

  const sameMonthRange = normalized.match(/\b\d{1,2}\.?\s*[-–]\s*(\d{1,2})\.?\s+([A-Za-zÁ-ž]+)\s+(20\d{2})\b/i);
  if (sameMonthRange) {
    const month = CZECH_MONTHS[sameMonthRange[2].toLowerCase()];
    if (month !== undefined) {
      return validEnd(makeDate(Number.parseInt(sameMonthRange[3], 10), month, Number.parseInt(sameMonthRange[1], 10), "23:59"));
    }
  }

  const explicitEnd = normalized.match(/\b(?:do|konec|end)\s*:?\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/i);
  if (explicitEnd) {
    return validEnd(
      makeDate(
        Number.parseInt(explicitEnd[3], 10),
        Number.parseInt(explicitEnd[2], 10) - 1,
        Number.parseInt(explicitEnd[1], 10),
        "23:59",
      ),
    );
  }

  return undefined;
}

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

function datePartsFromText(text: string): LocalDateParts | undefined {
  const normalized = normalizeText(text);
  const numeric = normalized.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\b/);
  if (numeric) {
    return {
      year: Number.parseInt(numeric[3], 10),
      month: Number.parseInt(numeric[2], 10) - 1,
      day: Number.parseInt(numeric[1], 10),
    };
  }

  const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return {
      year: Number.parseInt(iso[1], 10),
      month: Number.parseInt(iso[2], 10) - 1,
      day: Number.parseInt(iso[3], 10),
    };
  }

  return undefined;
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function czechWeekdayIndex(value: string): number | undefined {
  const key = stripDiacritics(value).toLowerCase();
  const weekdays: Record<string, number> = {
    ne: 7,
    po: 1,
    ut: 2,
    st: 3,
    ct: 4,
    pa: 5,
    so: 6,
  };

  return weekdays[key];
}

function jsDayToCzechWeekday(day: number): number {
  return day === 0 ? 7 : day;
}

function makeDatePlusDays(parts: LocalDateParts, days: number, timeText: string): Date | undefined {
  const utc = new Date(Date.UTC(parts.year, parts.month, parts.day + days));
  return makeDate(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), timeText);
}

export function parseJiriPetrakDateRange(rawValue: string): { startsAt: Date | null; endsAt: Date | null; warning?: string } {
  const normalized = normalizeSpaces(rawValue.replace(/^Datum\s*:\s*/i, "").replace(/»/g, "→"));
  const match = normalized.match(
    /^(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\s*-\s*([A-ZÁ-Ž]{2})\s*([01]?\d|2[0-3])h?\s*→\s*(?:(PO|ÚT|UT|ST|ČT|CT|PÁ|PA|SO|NE)\s*)?([01]?\d|2[0-3])h?/i,
  );

  if (!match) {
    return { startsAt: null, endsAt: null, warning: `Unrecognized source date format: ${rawValue}` };
  }

  const startDay = Number.parseInt(match[1], 10);
  const startMonth = Number.parseInt(match[2], 10) - 1;
  const startYear = Number.parseInt(match[3], 10);
  const startWeekday = czechWeekdayIndex(match[4]);
  const startHour = Number.parseInt(match[5], 10);
  const endWeekday = match[6] ? czechWeekdayIndex(match[6]) : undefined;
  const endHour = Number.parseInt(match[7], 10);
  const startsAt = makeDate(startYear, startMonth, startDay, `${startHour}:00`) ?? null;

  if (!startsAt || startWeekday === undefined) {
    return { startsAt, endsAt: null, warning: `Could not parse source start date: ${rawValue}` };
  }

  const startLocalDay = jsDayToCzechWeekday(new Date(Date.UTC(startYear, startMonth, startDay)).getUTCDay());
  const weekdayWarning = startLocalDay === startWeekday ? undefined : `Weekday does not match source date: ${rawValue}`;
  let daysToEnd = 0;

  if (endWeekday !== undefined) {
    daysToEnd = (endWeekday - startWeekday + 7) % 7;
    if (daysToEnd === 0) {
      daysToEnd = 7;
    }
  } else if (endHour < startHour) {
    daysToEnd = 1;
  }

  const endsAt = makeDatePlusDays({ year: startYear, month: startMonth, day: startDay }, daysToEnd, `${endHour}:00`) ?? null;
  return { startsAt, endsAt, warning: weekdayWarning };
}

function parseDetailEndDate(dateLine: string, startsAt: Date, startParts?: LocalDateParts): Date | undefined {
  const sourceRange = parseJiriPetrakDateRange(dateLine);
  if (sourceRange.endsAt && sourceRange.endsAt.getTime() > startsAt.getTime()) {
    return sourceRange.endsAt;
  }

  const direct = parseEndDateFromText(dateLine, startsAt);
  if (direct) {
    return direct;
  }

  const parts = startParts ?? datePartsFromText(dateLine);
  if (!parts) {
    return undefined;
  }

  const endDate = dateLine.match(/[-–]\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})(?:\s+(?:[A-ZÁ-Ž]{2}\s*)?([01]?\d|2[0-3])(?:[:.](\d{2})|\s*h)?)?/i);
  if (endDate) {
    const timeText = endDate[4] ? `${endDate[4]}:${endDate[5] ?? "00"}` : "23:59";
    const parsed = makeDate(
      Number.parseInt(endDate[3], 10),
      Number.parseInt(endDate[2], 10) - 1,
      Number.parseInt(endDate[1], 10),
      timeText,
    );
    return parsed && parsed.getTime() > startsAt.getTime() ? parsed : undefined;
  }

  const weekdayRange = dateLine.match(/(?:→|->|»)\s*([A-ZÁ-Ž]{2})\s*([01]?\d|2[0-3])(?:[:.](\d{2})|\s*h)?/i);
  const startWeekday = dateLine.match(/\b([A-ZÁ-Ž]{2})\s*([01]?\d|2[0-3])(?:[:.]\d{2}|\s*h)/i);
  if (!weekdayRange || !startWeekday) {
    return undefined;
  }

  const startDay = czechWeekdayIndex(startWeekday[1]);
  const endDay = czechWeekdayIndex(weekdayRange[1]);
  if (startDay === undefined || endDay === undefined) {
    return undefined;
  }

  const days = (endDay - startDay + 7) % 7 || 7;
  const parsed = makeDatePlusDays(parts, days, `${weekdayRange[2]}:${weekdayRange[3] ?? "00"}`);
  return parsed && parsed.getTime() > startsAt.getTime() ? parsed : undefined;
}

function shortCzechDate(value: Date): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Europe/Prague",
  }).format(value);
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : typeof item?.name === "string" ? item.name : ""))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,/|]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeSpaces(value)).filter(Boolean))];
}

function inferGenres(text: string): string[] {
  const normalized = text.toLowerCase();
  const genres = ["tekno", "freetekno"];
  for (const genre of ["techno", "hardtek", "tribe", "acid", "dnb", "drum and bass", "jungle", "breakcore", "core"]) {
    if (normalized.includes(genre)) {
      genres.push(genre);
    }
  }

  return uniq(genres);
}

function splitLineupValues(value: string): string[] {
  return value
    .replace(/\b(?:and|a|ft\.?|feat\.?)\b/gi, ",")
    .split(/[,;|/]+|\s{2,}|(?:\s+[+&]\s+)/)
    .map((item) =>
      cleanSourceLabel(
        item
          .replace(/^[•*·\-–—>✅\s]+/, "")
          .trim(),
      ),
    )
    .filter((item) => item.length >= 2 && item.length <= 90)
    .filter((item) => !/^(?:line[\s-]?up|djs?|live|artists?|sounds?|sound systems?|soundsystems?|stage)$/i.test(item));
}

function looksLikeLineupCandidate(line: string): boolean {
  const normalized = normalizeSpaces(line);
  if (!normalized || normalized.length > 140) {
    return false;
  }

  if (/[.!?]\s*$/.test(normalized) && normalized.split(/\s+/).length > 6) {
    return false;
  }

  if (/^\d{1,2}[.:]\d{2}\b|\b\d{1,2}\.\s*\d{1,2}\.\s*(?:20\d{2})?\b/.test(normalized)) {
    return false;
  }

  if (/^(?:entry|vstup|tickets?|no space|rules?|lokalita|místo|misto|datum|odkaz|tagy)\b/i.test(stripDiacritics(normalized))) {
    return false;
  }

  return /(?:sound\s*system|soundsystem|crew|collective|records|stage|djs?|live|aka|b2b)/i.test(normalized) || normalized.split(/\s+/).length <= 5;
}

function inferLineup(text: string): string[] {
  const lines = normalizeText(text).split("\n");
  const values: string[] = [];
  const labelPattern =
    /^(?:line[\s-]?up|hraji|hrají|hrajou|djs?|live(?:\s+acts?)?|sound(?:\s*system)?s?|soundsystems?|artists?|vystoupi|vystoupí|playing|stage)\s*[:：-]\s*(.*)$/i;
  const labelOnlyPattern =
    /^(?:line[\s-]?up|hraji|hrají|hrajou|djs?|live(?:\s+acts?)?|sound(?:\s*system)?s?|soundsystems?|artists?|vystoupi|vystoupí|playing|stage)$/i;
  const stopPattern =
    /^(?:datum|date|lokalita|místo|misto|venue|location|tagy|tags|odkaz|link|entry|vstup|tickets?|no space|rules?|fotogalerie)\s*[:：-]?/i;
  let capturing = false;

  for (const line of lines) {
    const trimmed = cleanSourceLabel(line.trim());
    if (!trimmed) {
      capturing = false;
      continue;
    }

    if (stopPattern.test(stripDiacritics(trimmed))) {
      capturing = false;
      continue;
    }

    const match = line.match(labelPattern);
    if (match) {
      capturing = true;
      if (match[1]) {
        values.push(...splitLineupValues(match[1]));
      }
      continue;
    }

    if (labelOnlyPattern.test(trimmed)) {
      capturing = true;
      continue;
    }

    if (!looksLikeLineupCandidate(trimmed)) {
      if (capturing) {
        capturing = false;
      }
      continue;
    }

    if (capturing || /(?:sound\s*system|soundsystem|crew|collective|records|factory|kultur|djs?|b2b)/i.test(trimmed)) {
      values.push(...splitLineupValues(trimmed));
    }
  }

  return uniq(values).slice(0, 40);
}

function inferLineupFromSourceDescription(summary: string, sourceTags: string[]): string[] {
  const tagLineup = sourceTags.filter((tag) => /(?:sound\s*system|soundsystem|crew|collective|records|factory|kultur|stage|djs?)/i.test(tag));
  return uniq([...inferLineup(summary), ...tagLineup]).slice(0, 40);
}

function inferLocation(text: string): string {
  const locationMatch = normalizeText(text).match(/(?:místo|misto|kde|location|venue|adresa|address)\s*[:：-]\s*([^\n]{2,120})/i);
  if (locationMatch) {
    return normalizeSpaces(locationMatch[1]).slice(0, 180);
  }

  const countryMatch = normalizeText(text).match(/\b(?:cz|czech republic|česko|cesko|slovakia|slovensko|poland|germany|austria)\b/i);
  return countryMatch ? normalizeSpaces(countryMatch[0]).slice(0, 180) : DEFAULT_LOCATION;
}

function normalizeSourceTags(text: string): string[] {
  return uniq(
    text
      .replace(FLAG_RE, "")
      .split(/[,/|]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 80),
  );
}

function cleanSourceLabel(value: string): string {
  return normalizeSpaces(value.replace(FLAG_RE, "").replace(/\s*\(?mapy\.(?:com|cz)\)?\.?\s*/gi, " "));
}

function parseCoordinateValue(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = decodeURIComponent(value).trim().replace(",", ".");
  if (!/^-?\d{1,3}(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coordinatesFromNumbers(latitude: number | undefined, longitude: number | undefined): Coordinates | undefined {
  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }

  return { latitude, longitude };
}

function coordinatesFromPair(value: string | null | undefined): Coordinates | undefined {
  if (!value) {
    return undefined;
  }

  const decoded = decodeURIComponent(value);
  const match = decoded.match(/(-?\d{1,2}(?:[.,]\d+)?)[,\s]+(-?\d{1,3}(?:[.,]\d+)?)/);
  return coordinatesFromNumbers(parseCoordinateValue(match?.[1]), parseCoordinateValue(match?.[2]));
}

function coordinatesFromUrl(value: string | undefined): Coordinates | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const params = url.searchParams;
    const fromMapy = coordinatesFromNumbers(parseCoordinateValue(params.get("y")), parseCoordinateValue(params.get("x")));
    if (fromMapy) {
      return fromMapy;
    }

    const fromNamedParams =
      coordinatesFromNumbers(parseCoordinateValue(params.get("lat")), parseCoordinateValue(params.get("lon"))) ??
      coordinatesFromNumbers(parseCoordinateValue(params.get("lat")), parseCoordinateValue(params.get("lng"))) ??
      coordinatesFromNumbers(parseCoordinateValue(params.get("latitude")), parseCoordinateValue(params.get("longitude")));
    if (fromNamedParams) {
      return fromNamedParams;
    }

    const fromPairParam = coordinatesFromPair(params.get("q")) ?? coordinatesFromPair(params.get("ll")) ?? coordinatesFromPair(params.get("center"));
    if (fromPairParam) {
      return fromPairParam;
    }

    const atPathMatch = url.href.match(/@(-?\d{1,2}(?:[.,]\d+)?),(-?\d{1,3}(?:[.,]\d+)?)/);
    const fromAtPath = coordinatesFromPair(atPathMatch ? `${atPathMatch[1]},${atPathMatch[2]}` : undefined);
    if (fromAtPath) {
      return fromAtPath;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function coordinatesFromJsonLdLocation(location: unknown): Coordinates | undefined {
  if (!location || typeof location !== "object") {
    return undefined;
  }

  const geo = "geo" in location ? (location as { geo?: unknown }).geo : undefined;
  if (!geo || typeof geo !== "object") {
    return undefined;
  }

  return coordinatesFromNumbers(
    parseCoordinateValue(String((geo as { latitude?: unknown }).latitude ?? "")),
    parseCoordinateValue(String((geo as { longitude?: unknown }).longitude ?? "")),
  );
}

function extractUpcomingSection(html: string): string {
  const startMarkers = ["nadchazejici", "budouci akce", "upcoming"];
  const endMarkers = ["probehle", "uplynule", "archiv", "past events"];

  for (const candidateHtml of [html, decodeHtml(html)]) {
    const normalized = stripDiacritics(candidateHtml).toLowerCase();
    const start = startMarkers
      .map((marker) => normalized.indexOf(marker))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];

    if (start === undefined) {
      continue;
    }

    const end = endMarkers
      .map((marker) => normalized.indexOf(marker, start + 1))
      .filter((index) => index > start)
      .sort((left, right) => left - right)[0];

    return candidateHtml.slice(start, end ?? candidateHtml.length);
  }

  return html;
}

function extractLabelValue(text: string, labels: string[]): string | undefined {
  const normalizedLabels = labels.map((label) => stripDiacritics(label).toLowerCase());
  for (const rawLine of normalizeText(text).split("\n")) {
    const line = rawLine.trim();
    const comparableLine = line.replace(/^[^\p{L}\p{N}]+/u, "");
    const normalizedLine = stripDiacritics(comparableLine).toLowerCase();
    const label = normalizedLabels.find((candidate) => normalizedLine.startsWith(`${candidate}:`));
    if (label) {
      return normalizeSpaces(comparableLine.slice(label.length + 1).replace(/^[^\p{L}\p{N}]+/u, ""));
    }
  }

  return undefined;
}

function boundedDetailHtml(html: string): string {
  const withoutHead = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "");
  const h1 = withoutHead.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  const start = h1?.index ?? 0;
  const afterStart = withoutHead.slice(start);
  const stop = afterStart.search(/(?:Komentovat|Sd[ií]lej\s+přátelům|Sd[ií]lej\s+pratelum|Sd[ií]lej)/i);
  return stop >= 0 ? afterStart.slice(0, stop) : afterStart;
}

function detailDescriptionHtml(html: string): string {
  const bounded = boundedDetailHtml(html);
  let start = 0;
  for (const label of ["Odkaz", "Tagy", "Lokalita", "Místo", "Misto", "Datum"]) {
    const match = bounded.match(new RegExp(`${escapeRegExp(label)}\\s*:`, "i"));
    if (!match || match.index === undefined) {
      continue;
    }

    const afterLabel = bounded.slice(match.index);
    const boundary = afterLabel.search(/(?:<\/p>|<\/div>|<br\s*\/?>)/i);
    if (boundary >= 0) {
      start = Math.max(start, match.index + boundary);
    }
  }

  return bounded
    .slice(start)
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<picture[\s\S]*?<\/picture>/gi, " ")
    .replace(/<figure[\s\S]*?<\/figure>/gi, " ")
    .replace(/<section\b[^>]*>[\s\S]{0,1200}?Fotogalerie[\s\S]*?<\/section>/gi, " ")
    .replace(/Fotogalerie[\s\S]{0,500}?(?=<p\b|<div\b|$)/gi, " ");
}

function labelHtmlSegment(html: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*:?([\\s\\S]{0,700}?)(?=(?:Datum|Lokalita|Místo|Misto|Tagy|Odkaz|Fotogalerie)\\s*:|<h[1-6]\\b|</(?:p|div|section|article|tr|li)>|$)`, "i");
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function cleanSummaryLines(text: string, title: string): string {
  const isStopLine = (line: string) => {
    const normalized = stripDiacritics(line).toLowerCase();
    return normalized.startsWith("komentovat") || normalized.startsWith("sdilej pratelum") || normalized.startsWith("sdilej");
  };

  const skipLine = (line: string) => {
    const normalized = stripDiacritics(line).toLowerCase();
    return (
      normalized === stripDiacritics(title).toLowerCase() ||
      normalized.includes("uvodni strana") ||
      normalized.includes("akce a parties") ||
      normalized.includes("kalendar udalosti") ||
      normalized.includes("tekno parties") ||
      normalized.startsWith("aktualizovano:") ||
      normalized.startsWith("publikovano:") ||
      normalized.startsWith("bude publikovano") ||
      normalized.startsWith("datum:") ||
      normalized.startsWith("lokalita:") ||
      normalized.startsWith("misto:") ||
      normalized.startsWith("tagy:") ||
      normalized.startsWith("odkaz:") ||
      normalized.startsWith("fotogalerie") ||
      normalized.includes("rozbalit galerii") ||
      normalized.includes("box_left") ||
      normalized.includes("minispace") ||
      normalized.startsWith("<path") ||
      normalized.startsWith("path ") ||
      /m\d+[\d\s.,-]+[clhv]/i.test(line)
    );
  };

  const lines: string[] = [];
  for (const rawLine of normalizeText(text).split("\n")) {
    const line = rawLine.trim();
    if (line && isStopLine(line)) {
      break;
    }

    if (!line) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      continue;
    }

    if (!skipLine(line)) {
      lines.push(line);
    }
  }

  const collapsed: string[] = [];
  for (const line of lines) {
    if (collapsed[collapsed.length - 1] !== line) {
      collapsed.push(line);
    }
  }

  return collapsed.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 2000).trim();
}

function extractImages(html: string, baseUrl: string): string[] {
  const images = [...html.matchAll(/<img\b[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => absoluteUrl(match[1], baseUrl))
    .filter((url): url is string => Boolean(url))
    .filter((url) => !/(?:flag|vlajk|icon|spacer|blank|favicon|logo)/i.test(url))
    .filter((url) => /\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(url) || /(?:image|foto|gallery|galerie|upload|files)/i.test(url));

  return uniq(images).slice(0, 20);
}

function extractDetailCoverImage(html: string, baseUrl: string): string | undefined {
  const bounded = boundedDetailHtml(html);
  const beforeGallery = bounded.split(/Fotogalerie/i)[0] || bounded;
  const candidates = [...beforeGallery.matchAll(/<img\b[^>]+>/gi)]
    .map((match) => {
      const tag = match[0];
      const src =
        tag.match(/\b(?:src|data-src|data-original)=["']([^"']+)["']/i)?.[1] ??
        tag.match(/\bsrcset=["']([^"',\s]+)["']/i)?.[1];
      return { tag, url: absoluteUrl(src, baseUrl) };
    })
    .filter((item): item is { tag: string; url: string } => Boolean(item.url))
    .filter((item) => !/(?:flag|vlajk|icon|spacer|blank|favicon|logo|avatar|user|mapy|marker)/i.test(`${item.tag} ${item.url}`))
    .filter((item) => /\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(item.url) || /(?:image|foto|photo|upload|files|media)/i.test(item.url));

  return candidates[0]?.url;
}

function extractHrefForLabel(html: string, labels: string[], baseUrl: string): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*:[\\s\\S]{0,420}?<a\\b[^>]+href=["']([^"']+)["']`, "i");
    const match = html.match(pattern);
    const url = absoluteUrl(match?.[1], baseUrl);
    if (url) {
      return url;
    }
  }

  const textUrl = extractLabelValue(htmlToText(html), labels)?.match(/(?:https?:\/\/|www\.)\S+/i)?.[0];
  if (!textUrl) {
    return undefined;
  }

  return textUrl.startsWith("www.") ? `https://${textUrl}` : absoluteUrl(textUrl, baseUrl);
}

function extractLinkedLabelValues(html: string, labels: string[]): string[] {
  const segment = labelHtmlSegment(html, labels);
  if (!segment) {
    return [];
  }

  return uniq(
    [...segment.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => cleanSourceLabel(htmlToText(match[1])))
      .filter((item) => item.length >= 2 && !NAVIGATION_TEXT_RE.test(item)),
  );
}

function extractPlainLabelValueFromHtml(html: string, labels: string[]): string | undefined {
  const segment = labelHtmlSegment(html, labels);
  if (!segment) {
    return undefined;
  }

  const withoutAnchors = segment.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ");
  const value = cleanSourceLabel(htmlToText(withoutAnchors));
  return value || undefined;
}

function detailLinkAllowed(url: string, sourceUrl: string, text: string): boolean {
  try {
    const source = new URL(sourceUrl);
    const target = new URL(url);
    const title = normalizeSpaces(text);
    const sameSite = target.origin === source.origin;
    const samePage = target.href.replace(/#.*$/, "") === source.href.replace(/#.*$/, "");
    const asset = /\.(?:jpe?g|png|gif|webp|pdf|zip|rar|ics)$/i.test(target.pathname);
    const nav = !title || title.length < 4 || title.length > 180 || GENERIC_TITLE_RE.test(title) || NAVIGATION_TEXT_RE.test(title);

    return sameSite && !samePage && !asset && !nav;
  } catch {
    return false;
  }
}

function extractListingEvents(html: string, sourceUrl: string): ImportedEvent[] {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const events: ImportedEvent[] = [];
  const seen = new Set<string>();
  const detailAnchors = [...clean.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      html: match[0],
      href: match[1],
      text: cleanTitle(match[2]),
      url: absoluteUrl(match[1], sourceUrl),
    }))
    .filter((anchor) => anchor.url && isInternalEventDetailUrl(anchor.url, sourceUrl));

  for (let anchorIndex = 0; anchorIndex < detailAnchors.length; anchorIndex += 1) {
    const anchor = detailAnchors[anchorIndex];
    const detailUrl = anchor.url as string;
    const sourceEventId = sourceEventIdFromUrl(detailUrl);
    const rawTitle = anchor.text;
    const title = rawTitle;
    const warnings: string[] = [];

    if (!sourceEventId || !title || seen.has(sourceEventId)) {
      continue;
    }

    const previousBoundary = anchorIndex > 0 ? detailAnchors[anchorIndex - 1].end : 0;
    const nextBoundary = anchorIndex + 1 < detailAnchors.length ? detailAnchors[anchorIndex + 1].index : clean.length;
    const beforeAnchor = clean.slice(previousBoundary, anchor.index);
    const afterAnchor = clean.slice(anchor.end, nextBoundary);
    const beforeText = htmlToText(beforeAnchor);
    const dateMatches = [...beforeText.matchAll(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\b/g)];
    const dateMatch = dateMatches[dateMatches.length - 1];
    const textAfterDate = dateMatch ? beforeText.slice((dateMatch.index ?? 0) + dateMatch[0].length) : "";
    const timeMatch = textAfterDate.match(/\b(PO|ÚT|UT|ST|ČT|CT|PÁ|PA|SO|NE)\s*(\d{1,2})\s*(?:»|→|->)\s*(?:(PO|ÚT|UT|ST|ČT|CT|PÁ|PA|SO|NE)\s*)?(\d{1,2})\b/i);

    if (!dateMatch || !timeMatch) {
      console.warn("Skipping malformed Jiri Petrak listing record", {
        sourceEventId,
        sourceUrl: detailUrl,
        reason: "missing date or time range",
      });
      continue;
    }

    const sourceDateRaw = `${dateMatch[1]}. ${dateMatch[2]}. ${dateMatch[3]} - ${timeMatch[1]} ${timeMatch[2]}h → ${
      timeMatch[3] ? `${timeMatch[3]} ` : ""
    }${timeMatch[4]}h`;
    const parsedRange = parseJiriPetrakDateRange(sourceDateRaw);
    if (parsedRange.warning) {
      warnings.push(parsedRange.warning);
    }
    if (!parsedRange.startsAt) {
      console.warn("Skipping malformed Jiri Petrak listing record", {
        sourceEventId,
        sourceUrl: detailUrl,
        sourceDateRaw,
        reason: "unparseable date range",
      });
      continue;
    }

    const mapLocationMatch = afterAnchor.match(/<a\b[^>]+href=["']([^"']*mapy\.(?:cz|com)[^"']*)["'][^>]*>[\s\S]*?<\/a>\s*([^<\n\r]+)/i);
    const mapCoordinates = coordinatesFromUrl(absoluteUrl(mapLocationMatch?.[1], sourceUrl));
    const followingText = htmlToText(afterAnchor);
    const fallbackLocation = followingText
      .split("\n")
      .map((line) => cleanSourceLabel(line))
      .find((line) => line && !NAVIGATION_TEXT_RE.test(line) && !/^[-–—]+$/.test(line));
    const publicLocation = cleanSourceLabel(mapLocationMatch?.[2] ?? fallbackLocation ?? DEFAULT_LOCATION);
    const isHighlightedOnSource = rawTitle.trimStart().startsWith("✅");
    const summary = `${rawTitle}\n${publicLocation}\n${sourceDateRaw}`;
    const hashInput = [sourceEventId, rawTitle, sourceDateRaw, publicLocation, detailUrl].join("\n");

    seen.add(sourceEventId);
    events.push({
      sourceEventId,
      rawTitle,
      isHighlightedOnSource,
      sourceDateRaw,
      sourceUpdatedAt: null,
      sourcePublicationAt: null,
      sourceContentHash: sourceContentHash(hashInput),
      warnings,
      title,
      summary,
      publicLocation,
      publicLatitude: mapCoordinates?.latitude,
      publicLongitude: mapCoordinates?.longitude,
      startsAt: parsedRange.startsAt,
      endAt: parsedRange.endsAt ?? undefined,
      coverImageUrl: undefined,
      externalUrl: detailUrl,
      sourceName: SOURCE_DISPLAY_NAME,
      sourceUrl: detailUrl,
      genres: inferGenres(`${title}\n${summary}`),
      lineup: [],
      tags: [],
      galleryImageUrls: [],
    });
  }

  return events;
}

function cleanTitle(value: string): string {
  const text = htmlToText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !GENERIC_TITLE_RE.test(line))
    .find((line) => EVENT_HINT_RE.test(line) || line.length >= 4);

  return normalizeSpaces(text ?? "").replace(/\s+\|\s+.*$/, "").slice(0, 180);
}

function summaryFromBlock(block: string, fallbackTitle: string): string {
  const summary = htmlToText(block)
    .replace(/\n\s*(více|vice|detail|read more|zobrazit více)\s*$/i, "")
    .slice(0, 2000)
    .trim();

  return summary.length >= 10 ? summary : fallbackTitle;
}

function eventFromJsonLd(raw: Record<string, unknown>, sourceUrl: string): ImportedEvent | null {
  const type = raw["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (!types.includes("Event")) {
    return null;
  }

  const title = typeof raw.name === "string" ? raw.name.trim() : "";
  const startsAt = parseDate(raw.startDate);
  if (!title || !startsAt) {
    return null;
  }

  const rawLocation = raw.location;
  const coordinates = coordinatesFromJsonLdLocation(rawLocation);
  const location =
    typeof rawLocation === "string"
      ? rawLocation
      : typeof rawLocation === "object" && rawLocation && "name" in rawLocation
        ? String((rawLocation as { name: unknown }).name)
        : "Česko";
  const externalUrl =
    absoluteUrl(typeof raw.url === "string" ? raw.url : undefined, sourceUrl) ??
    `${sourceUrl}#${slugify(title)}-${startsAt.toISOString().slice(0, 10)}`;
  return {
    sourceEventId: sourceEventIdFromUrl(externalUrl) ?? slugify(title),
    rawTitle: title,
    isHighlightedOnSource: title.trimStart().startsWith("✅"),
    sourceDateRaw: typeof raw.startDate === "string" ? raw.startDate : undefined,
    sourceUpdatedAt: null,
    sourcePublicationAt: null,
    sourceContentHash: versionedSourceContentHash(JSON.stringify(raw)),
    warnings: [],
    title,
    summary: typeof raw.description === "string" ? htmlToText(raw.description).slice(0, 2000) : title,
    publicLocation: stripTags(location).slice(0, 180) || DEFAULT_LOCATION,
    publicLatitude: coordinates?.latitude,
    publicLongitude: coordinates?.longitude,
    startsAt,
    endAt: parseDate(raw.endDate),
    coverImageUrl: undefined,
    externalUrl,
    sourceName: SOURCE_DISPLAY_NAME,
    sourceUrl: externalUrl,
    genres: inferGenres(`${title}\n${typeof raw.description === "string" ? raw.description : ""}`),
    lineup: normalizeStringList(raw.performer),
    tags: normalizeStringList(raw.keywords),
    galleryImageUrls: [],
  };
}

function parseJsonLd(html: string, sourceUrl: string): ImportedEvent[] {
  const events: ImportedEvent[] = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(match[1].trim()) as unknown;
      const graph =
        typeof parsed === "object" && parsed && "@graph" in parsed
          ? (parsed as { "@graph"?: unknown })["@graph"]
          : undefined;
      const candidates = Array.isArray(parsed) ? parsed : Array.isArray(graph) ? graph : [parsed];

      for (const candidate of candidates) {
        if (typeof candidate === "object" && candidate) {
          const event = eventFromJsonLd(candidate as Record<string, unknown>, sourceUrl);
          if (event) {
            events.push(event);
          }
        }
      }
    } catch {
      // Ignore malformed embedded JSON-LD and continue with other blocks.
    }
  }

  return events;
}

function extractCandidateBlocks(html: string): string[] {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const blocks: string[] = [];
  const blockPatterns = [
    /<tr\b[^>]*>([\s\S]{60,8000}?)<\/tr>/gi,
    /<article\b[^>]*>([\s\S]{60,12000}?)<\/article>/gi,
    /<li\b[^>]*>([\s\S]{60,8000}?)<\/li>/gi,
    /<div\b[^>]+class=["'][^"']*(?:event|udalost|akce|calendar|jev|jcal|item|entry)[^"']*["'][^>]*>([\s\S]{60,12000}?)<\/div>/gi,
  ];

  for (const pattern of blockPatterns) {
    for (const match of clean.matchAll(pattern)) {
      blocks.push(match[0]);
    }
  }

  for (const match of clean.matchAll(/<a\b[^>]+href=["'][^"']+["'][^>]*>[\s\S]{0,500}?<\/a>/gi)) {
    const index = match.index ?? 0;
    const start = Math.max(0, index - 1200);
    const end = Math.min(clean.length, index + match[0].length + 2200);
    blocks.push(clean.slice(start, end));
  }

  return blocks;
}

function linkFromBlock(block: string, sourceUrl: string): string | undefined {
  const links = [...block.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      url: absoluteUrl(match[1], sourceUrl),
      text: htmlToText(match[2]),
    }))
    .filter((link): link is { url: string; text: string } => {
      if (!link.url) {
        return false;
      }

      const url = new URL(link.url);
      const isUsableProtocol = url.protocol === "http:" || url.protocol === "https:";
      const isAsset = /\.(jpe?g|png|gif|webp|pdf|zip|rar)$/i.test(url.pathname);
      const isNavigation = /(?:^|\s)(home|kontakt|contact|login|rss|facebook|instagram|previous|next|další|predchozi|předchozí)(?:\s|$)/i.test(link.text);
      return isUsableProtocol && !isAsset && !isNavigation;
    });

  return links.find((link) => EVENT_HINT_RE.test(link.text))?.url ?? links[0]?.url;
}

function titleFromBlock(block: string): string {
  const heading = block.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1];
  if (heading) {
    const title = cleanTitle(heading);
    if (title) {
      return title;
    }
  }

  const links = [...block.matchAll(/<a\b[^>]+href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => cleanTitle(match[1]))
    .filter((title) => title.length >= 4);

  return links.find((title) => EVENT_HINT_RE.test(title)) ?? links[0] ?? "";
}

function eventFromBlock(block: string, sourceUrl: string): ImportedEvent | null {
  const text = htmlToText(block);
  const timeDate = parseDate(block.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1]);
  const dateAttribute = block.match(/\b(?:datetime|data-date|data-start|data-start-date|start|date)=["']([^"']+)["']/i)?.[1];
  const attributeDate = parseDate(dateAttribute) ?? parseDateFromText(dateAttribute ?? "");
  const startsAt = timeDate ?? attributeDate ?? parseDateFromText(text);
  const title = titleFromBlock(block);
  const externalUrl = linkFromBlock(block, sourceUrl) ?? `${sourceUrl}#${slugify(title)}-${startsAt?.toISOString().slice(0, 10)}`;

  if (!title || !startsAt || !externalUrl) {
    return null;
  }

  const summary = summaryFromBlock(block, title);
  const galleryImageUrls = extractImages(block, sourceUrl);
  const mapHref = [...block.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => absoluteUrl(match[1], sourceUrl))
    .find((url): url is string => Boolean(url && /(?:mapy\.|google\.[^/]+\/maps|openstreetmap\.org)/i.test(url)));
  const coordinates = coordinatesFromUrl(mapHref);

  return {
    sourceEventId: sourceEventIdFromUrl(externalUrl) ?? slugify(title),
    rawTitle: title,
    isHighlightedOnSource: title.trimStart().startsWith("✅"),
    sourceDateRaw: text.match(/\b\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}[^\n]*/)?.[0],
    sourceUpdatedAt: null,
    sourcePublicationAt: null,
    sourceContentHash: sourceContentHash(`${title}\n${text}\n${externalUrl}`),
    warnings: [],
    title,
    summary,
    publicLocation: inferLocation(summary),
    publicLatitude: coordinates?.latitude,
    publicLongitude: coordinates?.longitude,
    startsAt,
    endAt: parseEndDateFromText(text, startsAt),
    coverImageUrl: undefined,
    externalUrl,
    sourceName: SOURCE_DISPLAY_NAME,
    sourceUrl: externalUrl,
    genres: inferGenres(`${title}\n${summary}`),
    lineup: inferLineup(summary),
    tags: [],
    galleryImageUrls: [],
  };
}

function detailTitle(html: string): string {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (heading) {
    const title = cleanTitle(heading);
    if (title) {
      return title;
    }
  }

  return cleanTitle(html);
}

function eventFromDetailPage(html: string, detailUrl: string, fallback: ImportedEvent): ImportedEvent {
  const bounded = boundedDetailHtml(html);
  const text = htmlToText(bounded);
  const title = cleanSourceLabel(detailTitle(bounded) || fallback.title);
  const dateLine = extractLabelValue(text, ["Datum", "Date"]) ?? "";
  const parsedRange = dateLine ? parseJiriPetrakDateRange(dateLine) : { startsAt: null, endsAt: null, warning: "Missing detail Datum field" };
  const startsAt = parsedRange.startsAt ?? fallback.startsAt;
  const location = cleanSourceLabel(
    extractPlainLabelValueFromHtml(bounded, ["Lokalita", "Místo", "Misto", "Venue", "Location"]) ??
      extractLabelValue(text, ["Lokalita", "Místo", "Misto", "Venue", "Location"]) ??
      fallback.publicLocation,
  );
  const locationMapUrl = extractHrefForLabel(bounded, ["Lokalita", "Místo", "Misto", "Venue", "Location"], detailUrl);
  const publicCoordinates = coordinatesFromUrl(locationMapUrl);
  const linkedTags = extractLinkedLabelValues(bounded, ["Tagy", "Tags"]);
  const sourceTags = linkedTags.length > 0 ? linkedTags : normalizeSourceTags(extractLabelValue(text, ["Tagy", "Tags"]) ?? "");
  const sourceLink = extractHrefForLabel(bounded, ["Odkaz", "Link"], detailUrl);
  const coverImageUrl = extractDetailCoverImage(bounded, detailUrl);
  const detailSummary = cleanSummaryLines(htmlToText(detailDescriptionHtml(bounded)), title);
  const summary = detailSummary.length >= 20 ? detailSummary : `${title}\n${cleanSourceLabel(location)}\n${shortCzechDate(startsAt)}`;
  const mergedGenres = inferGenres(`${title}\n${summary}\n${sourceTags.join(", ")}`);
  const sourceLineup = inferLineupFromSourceDescription(summary, sourceTags);
  const sourceUpdatedAt = parseCzechMetadataDate(extractLabelValue(text, ["aktualizováno", "aktualizovano"]));
  const sourcePublicationAt =
    parseCzechMetadataDate(extractLabelValue(text, ["publikováno", "publikovano"])) ??
    parseCzechMetadataDate(text.match(/bude publikováno\s*\n?([^\n]+)/i)?.[1]);
  const warnings = [...fallback.warnings];
  if (parsedRange.warning) {
    warnings.push(parsedRange.warning);
  }

  return {
    ...fallback,
    rawTitle: fallback.rawTitle || title,
    title,
    summary,
    publicLocation: location || DEFAULT_LOCATION,
    publicLatitude: publicCoordinates?.latitude ?? fallback.publicLatitude,
    publicLongitude: publicCoordinates?.longitude ?? fallback.publicLongitude,
    startsAt,
    endAt: parsedRange.endsAt ?? fallback.endAt,
    coverImageUrl,
    externalUrl: sourceLink ?? fallback.externalUrl,
    sourceUrl: detailUrl,
    sourceDateRaw: dateLine || fallback.sourceDateRaw,
    sourceUpdatedAt,
    sourcePublicationAt,
    sourceContentHash: versionedSourceContentHash(
      [
        fallback.sourceEventId,
        title,
        dateLine,
        location,
        publicCoordinates?.latitude,
        publicCoordinates?.longitude,
        sourceTags.join(","),
        sourceLink,
        summary,
        sourceLineup.join(","),
      ].join("\n"),
    ),
    warnings,
    genres: uniq([...fallback.genres, ...mergedGenres]),
    lineup: uniq([...fallback.lineup, ...sourceLineup]),
    tags: uniq([...fallback.tags, ...sourceTags]),
    galleryImageUrls: [],
  };
}

export function parseJiriPetrakDetailPage(html: string, detailUrl: string, fallback: ImportedEvent): ImportedEvent {
  return eventFromDetailPage(html, detailUrl, fallback);
}

function parseFallbackCards(html: string, sourceUrl: string): ImportedEvent[] {
  return extractCandidateBlocks(html)
    .map((block) => eventFromBlock(block, sourceUrl))
    .filter((event): event is ImportedEvent => Boolean(event));
}

function dedupeImportedEvents(events: ImportedEvent[]): ImportedEvent[] {
  const bySourceUrl = new Map<string, ImportedEvent>();
  for (const event of events) {
    bySourceUrl.set(event.sourceUrl, event);
  }

  return [...bySourceUrl.values()].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

export function parseJiriPetrakEvents(html: string, sourceUrl: string): ImportedEvent[] {
  const upcomingHtml = extractUpcomingSection(html);
  const listingEvents = extractListingEvents(upcomingHtml, sourceUrl);
  const now = Date.now();
  return dedupeImportedEvents(listingEvents).filter((event) => (event.endAt ?? event.startsAt).getTime() >= now - 24 * 60 * 60 * 1000);
}

function canFetchDetail(sourceUrl: string, detailUrl: string): boolean {
  try {
    const source = new URL(sourceUrl);
    const detail = new URL(detailUrl);
    return detail.protocol.startsWith("http") && detail.origin === source.origin && !detail.hash;
  } catch {
    return false;
  }
}

async function fetchDetailEvent(event: ImportedEvent, sourceUrl: string, headers: HeadersInit, knownSourceIds = new Set<string>()): Promise<ImportedEvent> {
  if (knownSourceIds.has(event.sourceEventId)) {
    return event;
  }

  if (!canFetchDetail(sourceUrl, event.sourceUrl)) {
    return event;
  }

  try {
    const response = await fetch(event.sourceUrl, {
      headers,
      signal: timeoutSignal(DETAIL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return event;
    }

    return eventFromDetailPage(await response.text(), event.sourceUrl, event);
  } catch {
    return event;
  }
}

function mirrorHeaders(): HeadersInit {
  const env = getEnv();
  return {
    "User-Agent": env.MIRROR_USER_AGENT,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "cs,en;q=0.8",
  };
}

export async function fetchJiriPetrakIndexEvents(): Promise<ImportedEvent[]> {
  const env = getEnv();
  const response = await fetch(env.MIRROR_SOURCE_URL, {
    headers: mirrorHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Zdroj mirroru vrátil stav ${response.status}`);
  }

  const indexEvents = parseJiriPetrakEvents(await response.text(), env.MIRROR_SOURCE_URL);
  if (indexEvents.length === 0) {
    throw new Error("Zdroj mirroru se načetl, ale nepodařilo se rozpoznat žádné akce z kalendáře.");
  }

  return indexEvents;
}

export async function fetchJiriPetrakEvents(options: { knownSourceIds?: Set<string> } = {}): Promise<ImportedEvent[]> {
  const env = getEnv();
  const headers = mirrorHeaders();
  const indexEvents = await fetchJiriPetrakIndexEvents();
  const events = await mapWithConcurrency(indexEvents, DETAIL_FETCH_CONCURRENCY, async (event) => {
    const enriched = await fetchDetailEvent(event, env.MIRROR_SOURCE_URL, headers, options.knownSourceIds);
    if (!options.knownSourceIds?.has(event.sourceEventId)) {
      await sleep(DETAIL_FETCH_DELAY_MS);
    }
    return enriched;
  });
  if (events.length === 0) {
    throw new Error("Zdroj mirroru se načetl, ale nepodařilo se rozpoznat žádné akce z kalendáře.");
  }

  return events;
}

function createUniqueSlugFromSet(base: string, usedSlugs: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix(6)}`;
    if (!usedSlugs.has(candidate)) {
      usedSlugs.add(candidate);
      return candidate;
    }
  }

  const fallback = `${base}-${randomSlugSuffix(10)}`;
  usedSlugs.add(fallback);
  return fallback;
}

function toCreateCommand(event: ImportedEvent, slug: string, isPublished = false): CreateEventCommand {
  return {
    slug,
    title: event.title,
    summary: event.summary.length >= 10 ? event.summary : `${event.title} ze zdroje ${event.sourceName}`,
    publicLocation: event.publicLocation,
    publicLatitude: event.publicLatitude,
    publicLongitude: event.publicLongitude,
    startsAt: event.startsAt,
    endAt: event.endAt,
    coverImageUrl: event.coverImageUrl,
    externalUrl: event.externalUrl,
    source: {
      name: event.sourceName,
      url: event.sourceUrl,
      id: event.sourceEventId,
      contentHash: event.sourceContentHash,
    },
    genres: event.genres,
    lineup: event.lineup,
    tags: uniq([...event.tags, event.isHighlightedOnSource ? "zvýrazněno zdrojem" : ""]),
    galleryImageUrls: [],
    accessType: "public",
    isPublished,
  };
}

function isCurrentSourceHash(value: string | undefined): boolean {
  return Boolean(value?.startsWith(`${SOURCE_IMPORT_VERSION}:`));
}

function isImportedFromJiriPetrak(event: AdminEventDto): boolean {
  return Boolean(event.source?.url?.includes("jiripetrak.cz") || event.source?.name === SOURCE_DISPLAY_NAME || event.source?.name === SOURCE_NAME);
}

function isFallbackImportSummary(summary: string, title: string, location: string): boolean {
  const lines = normalizeText(summary)
    .split("\n")
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);

  if (lines.length === 0) {
    return true;
  }

  if (lines.length > 3) {
    return false;
  }

  const normalizedSummary = stripDiacritics(lines.join(" ")).toLowerCase();
  return (
    normalizedSummary.includes(stripDiacritics(title).toLowerCase()) &&
    normalizedSummary.includes(stripDiacritics(location).toLowerCase().slice(0, 24)) &&
    /\b\d{1,2}\.\s*\d{1,2}\.|\b20\d{2}\b/.test(normalizedSummary)
  );
}

function hasKnownSourceChrome(summary: string): boolean {
  const normalized = stripDiacritics(summary).toLowerCase();
  return /prihlasit se|aktuality|cestovani cestovani|vsechnu cestu|mapy treku|uzitecne cestovatelske odkazy/.test(normalized);
}

function shouldReplaceSummary(existing: AdminEventDto, imported: ImportedEvent): boolean {
  if (imported.summary.length < 20 || isFallbackImportSummary(imported.summary, imported.title, imported.publicLocation)) {
    return false;
  }

  return (
    !existing.summary ||
    isFallbackImportSummary(existing.summary, existing.title, existing.publicLocation) ||
    hasKnownSourceChrome(existing.summary) ||
    (existing.source?.contentHash && !isCurrentSourceHash(existing.source.contentHash) && imported.summary.length > existing.summary.length + 80)
  );
}

function enrichedExistingCommand(existing: AdminEventDto, imported: ImportedEvent): CreateEventCommand | null {
  if (existing.accessType !== "public" || !isImportedFromJiriPetrak(existing)) {
    return null;
  }

  const nextSummary = shouldReplaceSummary(existing, imported) ? imported.summary : existing.summary;
  const nextCoverImageUrl = existing.coverImageUrl || imported.coverImageUrl;
  const nextPublicLatitude = existing.publicLatitude ?? imported.publicLatitude;
  const nextPublicLongitude = existing.publicLongitude ?? imported.publicLongitude;
  const nextLineup = existing.lineup.length > 0 ? uniq([...existing.lineup, ...imported.lineup]) : imported.lineup;
  const nextGenres = uniq([...existing.genres, ...imported.genres]);
  const nextTags = uniq([...existing.tags, ...imported.tags, imported.isHighlightedOnSource ? "zvýrazněno zdrojem" : ""]);
  const nextContentHash = isCurrentSourceHash(imported.sourceContentHash) ? imported.sourceContentHash : existing.source?.contentHash;
  const nextSource = {
    name: existing.source?.name || imported.sourceName,
    url: existing.source?.url || imported.sourceUrl,
    id: existing.source?.id || imported.sourceEventId,
    contentHash: nextContentHash,
  };

  const changed =
    nextSummary !== existing.summary ||
    nextCoverImageUrl !== existing.coverImageUrl ||
    nextPublicLatitude !== existing.publicLatitude ||
    nextPublicLongitude !== existing.publicLongitude ||
    nextLineup.join("\n") !== existing.lineup.join("\n") ||
    nextGenres.join("\n") !== existing.genres.join("\n") ||
    nextTags.join("\n") !== existing.tags.join("\n") ||
    nextContentHash !== existing.source?.contentHash;

  if (!changed) {
    return null;
  }

  return {
    slug: existing.slug,
    title: existing.title,
    summary: nextSummary,
    publicLocation: existing.publicLocation,
    publicLatitude: nextPublicLatitude,
    publicLongitude: nextPublicLongitude,
    startsAt: existing.startsAt,
    endAt: existing.endAt,
    coverImageUrl: nextCoverImageUrl,
    externalUrl: existing.externalUrl || imported.externalUrl,
    source: nextSource,
    genres: nextGenres,
    lineup: nextLineup,
    tags: nextTags,
    galleryImageUrls: existing.galleryImageUrls,
    accessType: existing.accessType,
    isPublished: existing.isPublished,
  };
}

export async function syncJiriPetrakEvents(): Promise<SyncResult> {
  const sourceUrl = getEnv().MIRROR_SOURCE_URL;
  const repository = getNostrEventRepository();
  const existingEvents = await repository.listAdminEvents();
  const usedSlugs = new Set(existingEvents.map((event) => event.slug));
  const existingSourceId = (event: { source?: { id?: string; url?: string } }) =>
    event.source?.id ?? (event.source?.url ? sourceEventIdFromUrl(event.source.url) : undefined);
  const existingBySourceId = new Map<string, AdminEventDto>();
  const existingBySourceUrl = new Map<string, AdminEventDto>();
  for (const event of existingEvents) {
    const sourceId = existingSourceId(event);
    if (sourceId) {
      existingBySourceId.set(sourceId, event);
    }
    if (event.source?.url) {
      existingBySourceUrl.set(event.source.url, event);
    }
  }
  const knownSourceIds = new Set(
    existingEvents
      .filter((event) => isImportedFromJiriPetrak(event) && isCurrentSourceHash(event.source?.contentHash))
      .map(existingSourceId)
      .filter((id): id is string => Boolean(id)),
  );
  const indexEvents = await fetchJiriPetrakIndexEvents();
  const headers = mirrorHeaders();
  const startedAt = Date.now();
  const result: SyncResult = {
    sourceUrl,
    imported: indexEvents.length,
    created: 0,
    updated: 0,
    skipped: 0,
    pending: 0,
    events: [],
  };

  for (const indexEvent of indexEvents) {
    const writes = result.created + result.updated;
    const existing = indexEvent.sourceEventId ? existingBySourceId.get(indexEvent.sourceEventId) : existingBySourceUrl.get(indexEvent.sourceUrl);

    if (existing) {
      if (indexEvent.sourceEventId && knownSourceIds.has(indexEvent.sourceEventId)) {
        result.skipped += 1;
        result.events.push({
          slug: existing.slug,
          title: existing.title,
          sourceUrl: indexEvent.sourceUrl,
          action: "skipped",
          reason: "already imported",
        });
        continue;
      }

      if (writes >= SYNC_WRITE_LIMIT || Date.now() - startedAt > SYNC_SOFT_TIMEOUT_MS) {
        result.pending += 1;
        result.events.push({
          slug: existing.slug,
          title: existing.title,
          sourceUrl: indexEvent.sourceUrl,
          action: "pending",
          reason: "batch limit",
        });
        continue;
      }

      const event = await fetchDetailEvent(indexEvent, sourceUrl, headers);
      const enriched = enrichedExistingCommand(existing, event);
      if (enriched) {
        await repository.createEvent(enriched);
        result.updated += 1;
        result.events.push({ slug: existing.slug, title: existing.title, sourceUrl: event.sourceUrl, action: "updated" });
        continue;
      }

      result.skipped += 1;
      result.events.push({
        slug: existing.slug,
        title: event.title,
        sourceUrl: event.sourceUrl,
        action: "skipped",
        reason: "already imported",
      });
      continue;
    }

    if (writes >= SYNC_WRITE_LIMIT || Date.now() - startedAt > SYNC_SOFT_TIMEOUT_MS) {
      result.pending += 1;
      result.events.push({
        title: indexEvent.title,
        sourceUrl: indexEvent.sourceUrl,
        action: "pending",
        reason: "batch limit",
      });
      continue;
    }

    const event = await fetchDetailEvent(indexEvent, sourceUrl, headers);
    await sleep(DETAIL_FETCH_DELAY_MS);
    const slug = createUniqueSlugFromSet(`${slugify(event.title)}-${event.startsAt.toISOString().slice(0, 10)}`, usedSlugs);

    await repository.createEvent(toCreateCommand(event, slug, false));

    result.created += 1;
    result.events.push({ slug, title: event.title, sourceUrl: event.sourceUrl, action: "created" });
  }

  return result;
}
