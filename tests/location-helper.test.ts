import assert from "node:assert/strict";
import test from "node:test";
import { hasPrecisePublicLocation, normalizedLocation, osmEmbedUrl, osmMarkerUrl } from "../src/lib/location.ts";

test("location helper recognizes precise locations with coordinates", () => {
  assert.equal(
    hasPrecisePublicLocation({
      publicLocation: "Tante JU, Dresden",
      publicLatitude: 51.055,
      publicLongitude: 13.731,
    }),
    true,
  );
});

test("location helper rejects city or country only locations", () => {
  assert.equal(
    hasPrecisePublicLocation({
      publicLocation: "Dresden",
      publicLatitude: 51.055,
      publicLongitude: 13.731,
    }),
    false,
  );
  assert.equal(
    hasPrecisePublicLocation({
      publicLocation: "Česko",
      publicLatitude: 49.8,
      publicLongitude: 15.4,
    }),
    false,
  );
});

test("location helper builds OSM URLs from coordinates", () => {
  const event = {
    publicLocation: "Rekreační středisko Hadinka",
    publicLatitude: 49.78,
    publicLongitude: 17.75,
  };

  assert.equal(normalizedLocation("  Česko  "), "cesko");
  assert.equal(osmMarkerUrl(event), "https://www.openstreetmap.org/?mlat=49.78&mlon=17.75#map=16/49.78/17.75");
  assert.match(osmEmbedUrl(event), /marker=49\.78%2C17\.75/);
});
