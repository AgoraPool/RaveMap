export type MediaSampleProvider = "youtube" | "soundcloud";

export type MediaSample = {
  provider: MediaSampleProvider;
  label: string;
  sourceUrl: string;
  embedUrl?: string;
};

export type MediaSummaryPart =
  | { type: "text"; text: string }
  | { type: "sample"; text: string; sample: MediaSample };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[\])},.;:!?]+$/;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/;
const SOUNDCLOUD_NON_MEDIA_PATHS = new Set([
  "charts",
  "discover",
  "messages",
  "notifications",
  "pages",
  "popular",
  "privacy",
  "search",
  "settings",
  "stream",
  "terms-of-use",
  "upload",
  "you",
]);

function cleanUrlMatch(value: string): string {
  return value.replace(TRAILING_PUNCTUATION, "");
}

function youtubeVideoId(url: URL): string | null {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }

  if (hostname !== "youtube.com" && hostname !== "m.youtube.com" && hostname !== "music.youtube.com") {
    return null;
  }

  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v");
    return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "shorts" && parts[1] && YOUTUBE_ID_PATTERN.test(parts[1])) {
    return parts[1];
  }

  return null;
}

function youtubeChannelPath(url: URL): string | null {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "youtube.com" && hostname !== "m.youtube.com" && hostname !== "music.youtube.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 1) {
    return null;
  }

  const first = parts[0];
  if (first.startsWith("@") || first === "channel" || first === "c" || first === "user") {
    return `/${parts.join("/")}`;
  }

  return null;
}

function soundcloudPath(url: URL): string | null {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "on.soundcloud.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length >= 1 ? `/${parts.join("/")}` : null;
  }

  if (hostname !== "soundcloud.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 1 ||
    parts.some((part) => part.startsWith("__")) ||
    SOUNDCLOUD_NON_MEDIA_PATHS.has(parts[0]?.toLowerCase() ?? "")
  ) {
    return null;
  }

  return `/${parts.join("/")}`;
}

function labelFromPath(provider: MediaSampleProvider, path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }

  const readable = decoded
    .replace(/^\/+/, "")
    .replace(/\//g, " / ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return readable ? `${provider === "youtube" ? "YouTube" : "SoundCloud"}: ${readable}` : provider;
}

function mediaSampleFromUrl(url: URL): MediaSample | null {
  if (url.protocol !== "https:") {
    return null;
  }

  const videoId = youtubeVideoId(url);
  if (videoId) {
    return {
      provider: "youtube",
      label: `YouTube: ${videoId}`,
      sourceUrl: url.href,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };
  }

  const youtubePath = youtubeChannelPath(url);
  if (youtubePath) {
    return {
      provider: "youtube",
      label: labelFromPath("youtube", youtubePath),
      sourceUrl: url.href,
    };
  }

  const path = soundcloudPath(url);
  if (path) {
    url.hash = "";
    return {
      provider: "soundcloud",
      label: labelFromPath("soundcloud", path),
      sourceUrl: url.href,
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.href)}`,
    };
  }

  return null;
}

export function extractMediaSamples(text: string): MediaSample[] {
  const samples: MediaSample[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = cleanUrlMatch(match[0]);
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      continue;
    }

    const sample = mediaSampleFromUrl(url);
    if (!sample) {
      continue;
    }

    const key = sample.embedUrl ?? `${sample.provider}:${sample.sourceUrl}`;
    if (!seen.has(key)) {
      samples.push(sample);
      seen.add(key);
    }
  }

  return samples;
}

export function extractMediaSummaryParts(text: string): MediaSummaryPart[] {
  const parts: MediaSummaryPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const matchedText = match[0];
    const matchIndex = match.index ?? 0;
    const cleanUrl = cleanUrlMatch(matchedText);
    const trailingText = matchedText.slice(cleanUrl.length);

    let sample: MediaSample | null = null;
    try {
      sample = mediaSampleFromUrl(new URL(cleanUrl));
    } catch {
      sample = null;
    }

    if (!sample) {
      continue;
    }

    if (matchIndex > cursor) {
      parts.push({ type: "text", text: text.slice(cursor, matchIndex) });
    }
    parts.push({ type: "sample", text: cleanUrl, sample });
    if (trailingText) {
      parts.push({ type: "text", text: trailingText });
    }
    cursor = matchIndex + matchedText.length;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", text: text.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: "text", text }];
}
