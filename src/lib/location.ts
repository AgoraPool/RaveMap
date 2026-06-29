export type PublicLocationLike = {
  publicLocation: string;
  publicLatitude?: number;
  publicLongitude?: number;
};

const cityOnlyLocations = new Set([
  "brno",
  "bratislava",
  "czech republic",
  "czechia",
  "česko",
  "cesko",
  "dresden",
  "germany",
  "ostrava",
  "plzen",
  "plzeň",
  "poland",
  "polsko",
  "praha",
  "prague",
  "rakousko",
  "slovakia",
  "slovensko",
  "vienna",
  "wien",
]);

export function normalizedLocation(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function hasCoordinates(item: PublicLocationLike): boolean {
  return (
    item.publicLatitude !== undefined &&
    item.publicLongitude !== undefined &&
    Number.isFinite(item.publicLatitude) &&
    Number.isFinite(item.publicLongitude)
  );
}

export function hasPrecisePublicLocation(item: PublicLocationLike): boolean {
  if (!hasCoordinates(item)) {
    return false;
  }

  const normalized = normalizedLocation(item.publicLocation);
  return Boolean(normalized && !cityOnlyLocations.has(normalized));
}

export function osmMarkerUrl(item: PublicLocationLike, zoom = 16): string {
  if (!hasCoordinates(item)) {
    return "";
  }

  const lat = item.publicLatitude as number;
  const lon = item.publicLongitude as number;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

export function osmEmbedUrl(item: PublicLocationLike, pad = 0.01): string {
  if (!hasCoordinates(item)) {
    return "";
  }

  const lat = item.publicLatitude as number;
  const lon = item.publicLongitude as number;
  const west = lon - pad;
  const east = lon + pad;
  const south = lat - pad;
  const north = lat + pad;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${lat}%2C${lon}`;
}
