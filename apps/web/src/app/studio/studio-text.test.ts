import assert from "node:assert/strict";
import test from "node:test";
import { splitPreservingText } from "./studio-text";

test("empty name has no SVG lines", () => {
  assert.deepEqual(splitPreservingText(""), []);
  assert.deepEqual(splitPreservingText("   "), []);
});

test("French and Arabic words remain in order", () => {
  const text = "CABINET DENTAIRE SPÉCIALISÉ EN ORTHODONTIE ET IMPLANTOLOGIE";
  assert.equal(splitPreservingText(text).join(" "), text);
  const arabic = "عيادة طب الأسنان وتقويم الأسنان";
  assert.equal(splitPreservingText(arabic).join(" "), arabic);
});

test("long unbroken name is not truncated by the splitter", () => {
  const name = "SUPERCALIFRAGILISTICEXPIALIDOCIOUS";
  assert.deepEqual(splitPreservingText(name), [name]);
});

test("Unicode code points are counted rather than UTF-16 code units", () => {
  assert.deepEqual(splitPreservingText("😀😀 😀😀", 5), ["😀😀 😀😀"]);
});
