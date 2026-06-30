import type { PublicEventDto } from "./server/nostr-types";

export type EventProvenance = "crew" | "community" | "import" | "admin";

type ProvenanceEvent = Pick<PublicEventDto, "origin" | "source" | "crewSlug" | "tags">;

export function eventProvenance(event: ProvenanceEvent): EventProvenance {
  if (event.crewSlug || event.origin === "studio") return "crew";
  if (event.source || event.origin === "import") return "import";
  if (event.origin === "public" || event.tags?.includes("ravemap")) return "community";
  return "admin";
}

export function eventProvenanceLabel(provenance: EventProvenance): string {
  if (provenance === "crew") return "Crew";
  if (provenance === "community") return "Komunita";
  if (provenance === "import") return "Import";
  return "Admin";
}

export function eventProvenanceDescription(provenance: EventProvenance): string {
  if (provenance === "crew") return "Publikováno pozvanou crew";
  if (provenance === "community") return "Přidáno veřejným formulářem";
  if (provenance === "import") return "Převzato z veřejného zdroje";
  return "Publikováno správcem";
}
