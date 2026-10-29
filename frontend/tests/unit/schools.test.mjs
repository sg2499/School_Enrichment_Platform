// Schools for the Super Admin (#211): place, counts, last active, filtering, credentials.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { countsLine, credentialsText, filterSchools, lastActiveLabel, sameName, schoolPlace } from "../../.test-build/lib/schools.mjs";

const counts = { admins: 1, teachers: 14, students: 420, sections: 12, notSignedIn: 3, inactivePeople: 0, lastActiveAt: null };
const row = (name, extra = {}) => ({
  id: name,
  name,
  board: "CBSE",
  city: "Mysuru",
  state: "Karnataka",
  isActive: true,
  createdAt: null,
  logoUrl: null,
  counts,
  ...extra,
});

describe("school wording", () => {
  test("place and counts", () => {
    assert.equal(schoolPlace({ city: "Mysuru", state: "Karnataka" }), "Mysuru, Karnataka");
    assert.equal(schoolPlace({ city: null, state: "Goa" }), "Goa");
    assert.equal(schoolPlace({ city: null, state: null }), "");
    assert.equal(countsLine(counts), "1 admin · 14 teachers · 420 students · 12 sections");
    assert.equal(
      countsLine({ ...counts, admins: 2, teachers: 1, students: 1, sections: 0 }),
      "2 admins · 1 teacher · 1 student · 0 sections",
    );
  });

  test("last active, by IST calendar day", () => {
    const now = new Date("2026-10-29T08:00:00Z"); // 13:30 IST
    assert.equal(lastActiveLabel(null, now), "Not yet");
    assert.equal(lastActiveLabel("2026-10-28T19:00:00Z", now), "Today"); // 00:30 IST on the 29th
    assert.equal(lastActiveLabel("2026-10-28T17:00:00Z", now), "Yesterday"); // 22:30 IST on the 28th
    assert.equal(lastActiveLabel("2026-10-24T08:00:00Z", now), "5 days ago");
    assert.match(lastActiveLabel("2026-08-01T08:00:00Z", now), /1 Aug 2026/);
  });

  test("search and status", () => {
    const list = [
      row("Green Valley School"),
      row("Hill View", { city: "Hubballi", board: "ICSE" }),
      row("Old School", { isActive: false }),
    ];
    assert.deepEqual(
      filterSchools(list, "", "all").map((s) => s.name),
      ["Green Valley School", "Hill View", "Old School"],
    );
    assert.deepEqual(
      filterSchools(list, "icse hub", "all").map((s) => s.name),
      ["Hill View"],
    );
    assert.deepEqual(
      filterSchools(list, "", "suspended").map((s) => s.name),
      ["Old School"],
    );
    assert.deepEqual(
      filterSchools(list, "school", "active").map((s) => s.name),
      ["Green Valley School"],
    );
  });

  test("names typed to confirm", () => {
    assert.equal(sameName("  st. mary   school ", "St.  Mary  School"), true);
    assert.equal(sameName("St Mary School", "St. Mary School"), false);
  });

  test("credentials to hand over", () => {
    const text = credentialsText(
      { fullName: "Lakshmi Rao", email: "l@example.com", initialPassword: "abcDEF234567" },
      "Green Valley",
      "krama.app/login",
    );
    assert.match(text, /Sign in at: krama.app\/login/);
    assert.match(text, /Email: l@example.com/);
    assert.match(text, /First password: abcDEF234567/);
  });
});
