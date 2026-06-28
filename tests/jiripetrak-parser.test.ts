import assert from "node:assert/strict";
import test from "node:test";
import {
  parseJiriPetrakDateRange,
  parseJiriPetrakDetailPage,
  parseJiriPetrakEvents,
} from "../src/lib/server/importers/jiripetrak.ts";

const sourceUrl = "https://www.jiripetrak.cz/cs/tekno-parties-freetekno-kalendar-udalosti-42/";

const listingFixture = `
  <main>
    <h1>Tekno parties (Freetekno) - Kalendář událostí</h1>
    <h2>Nadcházející [3]</h2>
    <p>24.06. 2026</p>
    <p>ST 18 » NE 18</p>
    <p>• <a href="/cs/ufo-bufo-2026-4648/">UFO BUFO 2026</a></p>
    <p><a href="https://mapy.cz/s/example">▼</a> Rekreační středisko Hadinka, Vítkov</p>
    <hr>
    <p>03.07. 2026</p>
    <p>PÁ 17 » NE 12</p>
    <p>• <a href="/cs/psyna-2026-11819/">✅ Psyna 2026</a></p>
    <p><a href="https://mapy.com/s/example">▼</a> Ústecký kraj ?</p>
    <hr>
    <p>bad record</p>
    <p>• <a href="/cs/broken-9999/">Broken Date</a></p>
    <h2>Uplynulé [1]</h2>
    <p>01.01. 2024</p>
    <p>PO 20 » 23</p>
    <p>• <a href="/cs/old-party-111/">Old Party</a></p>
  </main>
`;

const detailFixture = `
  <head>
    <title>Dreaming Of Paradise 2026 - Jiří Petrák.cz</title>
  </head>
  <nav>
    <a href="/cs/uzitecne-cestovatelske-odkazy-a-aplikace-38/">Užitečné cestovatelské odkazy a aplikace</a>
    <span>Přihlásit se</span>
    <span>Aktuality</span>
  </nav>
  <article>
    <h1><img alt="">UFO BUFO 2026</h1>
    <p>aktualizováno: 1. 10. 2025</p>
    <p>publikováno: 24. 6. 2026</p>
    <p>Datum: <strong>24. 6. 2026 - ST 18h → NE 18h</strong></p>
    <p>Lokalita: <a href="https://mapy.com/s/example">mapy.com</a> Rekreační středisko Hadinka</p>
    <p>Tagy: <a href="/cs/tag/ufo">UFO BUFO festival</a> <a href="/cs/tag/krach">Krach Kultur Sound System</a></p>
    <p>Odkaz: <a href="https://www.facebook.com/events/example">www.facebook.com</a></p>
    <img src="/event-poster.jpg" alt="event poster">
    <section>Fotogalerie <img src="/poster.jpg" alt="poster text"> gallery text</section>
    <p>Your favorite Psychedelic Music &amp; Art Festival</p>
    <p>Hadinka, Klokočov, Vítkov, North-East of Czechia</p>
    <p>LINE UP</p>
    <p>Acid Joe</p>
    <p>Rave Factory Sound System</p>
    <p>Koala23 b2b FAK</p>
    <p>Entry: 8€</p>
    <h2>Komentovat</h2>
    <p>comment content</p>
    <p>Sdílej přátelům</p>
  </article>
`;

test("calendar parser imports only upcoming internal detail links", () => {
  const events = parseJiriPetrakEvents(listingFixture, sourceUrl);

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.sourceEventId),
    ["4648", "11819"],
  );
  assert.equal(events.some((event) => event.title === "Old Party"), false);
});

test("calendar parser extracts title marker, date, time range, source URL, and map-adjacent location", () => {
  const events = parseJiriPetrakEvents(listingFixture, sourceUrl);
  const highlighted = events[1];

  assert.equal(events[0].startsAt.toISOString(), "2026-06-24T16:00:00.000Z");
  assert.equal(events[0].endAt?.toISOString(), "2026-06-28T16:00:00.000Z");
  assert.equal(events[0].publicLocation, "Rekreační středisko Hadinka, Vítkov");
  assert.equal(events[0].sourceUrl, "https://www.jiripetrak.cz/cs/ufo-bufo-2026-4648/");
  assert.equal(highlighted.rawTitle, "✅ Psyna 2026");
  assert.equal(highlighted.isHighlightedOnSource, true);
  assert.equal(highlighted.publicLocation, "Ústecký kraj ?");
});

test("detail URL IDs are parsed from canonical source URLs", () => {
  const events = parseJiriPetrakEvents(
    `
      <h2>Nadcházející [2]</h2>
      <p>24.06. 2026</p><p>ST 18 » NE 18</p>
      <a href="/cs/ufo-bufo-2026-4648/">UFO BUFO 2026</a>
      <a href="https://mapy.cz">▼</a> Hadinka
      <p>26.06. 2026</p><p>PÁ 12 » NE 13</p>
      <a href="/cs/flekk-tekk-2026-ceskoslovenska-kooperace-12093/">Flekk Tekk 2026 - Československá Kooperace</a>
      <a href="https://mapy.com">▼</a> Olešná area
      <h2>Uplynulé [0]</h2>
    `,
    sourceUrl,
  );

  assert.deepEqual(
    events.map((event) => event.sourceEventId),
    ["4648", "12093"],
  );
});

test("source date parser handles weekday and omitted-weekday ranges", () => {
  assert.equal(parseJiriPetrakDateRange("24. 6. 2026 - ST 18h → NE 18h").startsAt?.toISOString(), "2026-06-24T16:00:00.000Z");
  assert.equal(parseJiriPetrakDateRange("24. 6. 2026 - ST 18h → NE 18h").endsAt?.toISOString(), "2026-06-28T16:00:00.000Z");
  assert.equal(parseJiriPetrakDateRange("3. 7. 2026 - PÁ 17h → NE 12h").endsAt?.toISOString(), "2026-07-05T10:00:00.000Z");
  assert.equal(parseJiriPetrakDateRange("6. 7. 2026 - PO 21h → 11h").endsAt?.toISOString(), "2026-07-07T09:00:00.000Z");
  assert.equal(parseJiriPetrakDateRange("6. 7. 2026 - PO 8h → 11h").endsAt?.toISOString(), "2026-07-06T09:00:00.000Z");
});

test("detail parser extracts canonical metadata and excludes gallery/comment/social text", () => {
  const fallback = parseJiriPetrakEvents(listingFixture, sourceUrl)[0];
  const event = parseJiriPetrakDetailPage(detailFixture, fallback.sourceUrl, fallback);

  assert.equal(event.title, "UFO BUFO 2026");
  assert.equal(event.startsAt.toISOString(), "2026-06-24T16:00:00.000Z");
  assert.equal(event.endAt?.toISOString(), "2026-06-28T16:00:00.000Z");
  assert.equal(event.publicLocation, "Rekreační středisko Hadinka");
  assert.deepEqual(event.tags, ["UFO BUFO festival", "Krach Kultur Sound System"]);
  assert.equal(event.externalUrl, "https://www.facebook.com/events/example");
  assert.equal(event.coverImageUrl, "https://www.jiripetrak.cz/event-poster.jpg");
  assert.deepEqual(event.galleryImageUrls, []);
  assert.match(event.summary, /Your favorite Psychedelic Music/);
  assert.match(event.summary, /LINE UP\nAcid Joe\nRave Factory Sound System/);
  assert.deepEqual(event.lineup, ["Acid Joe", "Rave Factory Sound System", "Koala23 b2b FAK", "Krach Kultur Sound System"]);
  assert.doesNotMatch(event.summary, /gallery text|comment content|Sdílej|Přihlásit|Aktuality|cestovatelské odkazy|Jiří Petrák.cz/);
});
