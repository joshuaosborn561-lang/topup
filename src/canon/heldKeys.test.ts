import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addHeldRow,
  emptyHeldKeys,
  normalizeEmail,
  normalizeLinkedin,
  normalizeNameCompany,
  poolRowsFromCsv,
  rowHasEmail,
  rowIsHeld,
} from "./heldKeys.js";

/** D98 — identifier normalize and match. Ask Josh or Cayden. */

describe("D98 — held identifier keys", () => {
  it("normalizes email, LinkedIn, and name+company", () => {
    assert.equal(normalizeEmail("  A@Example.COM "), "a@example.com");
    assert.equal(normalizeEmail("not-an-email"), null);
    assert.equal(normalizeLinkedin("https://WWW.LinkedIn.com/in/AnnSmith/?trk=x"), "linkedin.com/in/annsmith");
    assert.equal(normalizeLinkedin("http://linkedin.com/in/annsmith/"), "linkedin.com/in/annsmith");
    assert.equal(normalizeLinkedin("example.com/x"), null);
    assert.equal(normalizeNameCompany("Ann", "Smith", "Acme, Inc."), "ann|smith|acme inc");
    assert.equal(normalizeNameCompany("ANN", "SMITH", "Acme Inc"), "ann|smith|acme inc");
    assert.equal(normalizeNameCompany("Ann", "", "Acme"), null);
  });

  it("matches email first, then LinkedIn, then name+company", () => {
    const keys = emptyHeldKeys();
    addHeldRow(keys, "held@example.com", "https://linkedin.com/in/pat", "Sam", "Smith", "Acme Inc");
    assert.equal(rowIsHeld({ email: "held@example.com", linkedin: null, first: null, last: null, company: null }, keys), true);
    assert.equal(
      rowIsHeld({ email: null, linkedin: "https://www.linkedin.com/in/Pat/", first: null, last: null, company: null }, keys),
      true,
    );
    assert.equal(rowIsHeld({ email: null, linkedin: null, first: "Sam", last: "Smith", company: "Acme, Inc." }, keys), true);
    assert.equal(rowIsHeld({ email: "new@example.com", linkedin: null, first: "New", last: "Person", company: "Co" }, keys), false);
  });

  it("parses identifier CSV rows including those with no work_email", () => {
    const rows = poolRowsFromCsv(
      "work_email,linkedin_url,first_name,last_name,company_name\n" +
        "a@example.com,https://linkedin.com/in/a,Ann,A,Acme\n" +
        ",https://linkedin.com/in/b,Bob,B,Beta\n",
    );
    assert.equal(rows.length, 2);
    assert.equal(rowHasEmail(rows[0]!), true);
    assert.equal(rowHasEmail(rows[1]!), false);
    assert.equal(rows[1]!.linkedin, "https://linkedin.com/in/b");
  });

  it("keeps a quoted newline inside a company field as one row", () => {
    const rows = poolRowsFromCsv(
      'work_email,linkedin_url,first_name,last_name,company_name\n' +
        'a@example.com,https://linkedin.com/in/a,Ann,A,"Acme\nInc"\n',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.company, "Acme\nInc");
  });
});
