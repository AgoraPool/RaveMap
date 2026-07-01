import assert from "node:assert/strict";
import test from "node:test";
import { extractMediaSamples, extractMediaSummaryParts } from "../src/lib/media-samples.ts";

test("media sample parser extracts common YouTube URLs", () => {
  const samples = extractMediaSamples(`
    https://www.youtube.com/watch?v=abc_DEF-123
    https://youtu.be/xyz_987-qqq.
    https://youtube.com/shorts/shorts_id-42
  `);

  assert.deepEqual(
    samples.map((sample) => sample.embedUrl),
    [
      "https://www.youtube-nocookie.com/embed/abc_DEF-123",
      "https://www.youtube-nocookie.com/embed/xyz_987-qqq",
      "https://www.youtube-nocookie.com/embed/shorts_id-42",
    ],
  );
});

test("media sample parser extracts SoundCloud track and set URLs", () => {
  const samples = extractMediaSamples(`
    https://soundcloud.com/artist/track-name
    https://www.soundcloud.com/artist/sets/sample-set?utm_source=test
    https://on.soundcloud.com/XZXqvdj3zgrDgtm9j
  `);

  assert.equal(samples.length, 3);
  assert.equal(samples[0].provider, "soundcloud");
  assert.equal(samples[0].embedUrl, "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack-name");
  assert.equal(
    samples[1].embedUrl,
    "https://w.soundcloud.com/player/?url=https%3A%2F%2Fwww.soundcloud.com%2Fartist%2Fsets%2Fsample-set%3Futm_source%3Dtest",
  );
  assert.equal(
    samples[2].embedUrl,
    "https://w.soundcloud.com/player/?url=https%3A%2F%2Fon.soundcloud.com%2FXZXqvdj3zgrDgtm9j",
  );
});

test("media sample parser extracts SoundCloud profile URLs", () => {
  const samples = extractMediaSamples(`
    https://soundcloud.com/aburanna
    https://soundcloud.com/citti-official
    https://soundcloud.com/nocturnal_thing
    https://soundcloud.com/search?q=not-an-artist
  `);

  assert.deepEqual(
    samples.map((sample) => [sample.provider, sample.label, sample.embedUrl]),
    [
      ["soundcloud", "SoundCloud: aburanna", "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Faburanna"],
      ["soundcloud", "SoundCloud: citti official", "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fcitti-official"],
      ["soundcloud", "SoundCloud: nocturnal thing", "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fnocturnal_thing"],
    ],
  );
});

test("media sample parser surfaces YouTube channel links without embedding them", () => {
  const samples = extractMediaSamples(`
    https://youtube.com/@surtarang?si=ndDkSUB2gjt-WZMq
    https://www.youtube.com/channel/UC123456789
    https://youtube.com/user/sample-user
  `);

  assert.deepEqual(
    samples.map((sample) => [sample.provider, sample.label, sample.sourceUrl, sample.embedUrl]),
    [
      ["youtube", "YouTube: @surtarang", "https://youtube.com/@surtarang?si=ndDkSUB2gjt-WZMq", undefined],
      ["youtube", "YouTube: channel / UC123456789", "https://www.youtube.com/channel/UC123456789", undefined],
      ["youtube", "YouTube: user / sample user", "https://youtube.com/user/sample-user", undefined],
    ],
  );
});

test("media sample parser handles mixed descriptions and ignores unsupported URLs", () => {
  const samples = extractMediaSamples(`
    Text before https://example.com/watch?v=nope
    http://youtu.be/insecure1
    https://soundcloud.com/artist/track
    https://youtube.com/watch?v=validVideo1
    https://youtube.com/watch?v=validVideo1
  `);

  assert.deepEqual(
    samples.map((sample) => [sample.provider, sample.embedUrl]),
    [
      ["soundcloud", "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack"],
      ["youtube", "https://www.youtube-nocookie.com/embed/validVideo1"],
    ],
  );
});

test("media summary parts keep samples inline with surrounding text", () => {
  const parts = extractMediaSummaryParts(
    "Anna / https://soundcloud.com/aburanna.\nVideo: https://www.youtube.com/watch?v=abc_DEF-123 and https://example.com/nope",
  );

  assert.equal(parts.length, 5);
  assert.deepEqual(parts[0], { type: "text", text: "Anna / " });
  assert.equal(parts[1].type, "sample");
  if (parts[1].type === "sample") {
    assert.equal(parts[1].text, "https://soundcloud.com/aburanna");
    assert.equal(parts[1].sample.embedUrl, "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Faburanna");
  }
  assert.deepEqual(parts[2], { type: "text", text: ".\nVideo: " });
  assert.equal(parts[3].type, "sample");
  if (parts[3].type === "sample") {
    assert.equal(parts[3].text, "https://www.youtube.com/watch?v=abc_DEF-123");
    assert.equal(parts[3].sample.embedUrl, "https://www.youtube-nocookie.com/embed/abc_DEF-123");
  }
  assert.deepEqual(parts[4], { type: "text", text: " and https://example.com/nope" });
});
