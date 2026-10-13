import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsvRows } from "../../lib/parseCsv.js";
import { hostOf, peopleWithoutEmail } from "./noEmail.js";

/** D103 — the people an export names without an email are kept for the email finder. Ask Josh. */
const HEADER = "first_name,last_name,full_name,work_email,email_status,current_title,current_employer,current_employer_website,company_domain,company_name,employee_count_range,contact_city,contact_state,about_person";

describe("D103 — people without an email in an export", () => {
  it("parses quoted commas, quotes and line breaks", () => {
    const rows = parseCsvRows('a,b,c\r\n"x, y","say ""hi""","line\nbreak"\n,,\n');
    assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', "line\nbreak"], ["", "", ""]]);
  });

  it("turns a domain or a URL into a bare host", () => {
    assert.equal(hostOf("https://www.Acme.com/about?x=1"), "acme.com");
    assert.equal(hostOf("acme.co.uk"), "acme.co.uk");
    assert.equal(hostOf("not a host"), null);
    assert.equal(hostOf(""), null);
  });

  it("keeps each person with a full name and a company, once; skips the ones with an email", () => {
    const csv = [
      HEADER,
      'Ann,Lee,Ann Lee,ann@acme.com,VALID,CIO,Acme,,acme.com,Acme,51 to 200,Austin,TX,"likes commas, and ""quotes"""',
      "Bob,Ray,Bob Ray,,,IT Director,Beta Inc,https://www.beta.io/,,Beta Inc,11 to 50,Reno,NV,",
      "Bob,Ray,Bob Ray,,,IT Director,Beta Inc,https://www.beta.io/,,Beta Inc,11 to 50,Reno,NV,",
      "Cat,,Cat,,,CTO,Gamma,,gamma.com,Gamma,11 to 50,,,",
      "Dan,Wu,Dan Wu,,,Manager,,,,,11 to 50,,,",
      'Eve,Ng,Eve Ng,,,"VP, IT",Delta LLC,,,Delta LLC,201 to 500,Boise,ID,"two\nlines"',
    ].join("\n");
    const scan = peopleWithoutEmail(csv);
    assert.equal(scan.rows, 6);
    assert.equal(scan.with_email, 1);
    assert.equal(scan.without_email, 5);
    assert.equal(scan.no_name, 1, "Cat has no last name");
    assert.equal(scan.no_company, 1, "Dan has no company");
    assert.equal(scan.duplicates, 1, "Bob twice");
    assert.deepEqual(scan.kept.map((p) => `${p.first_name} ${p.last_name} ${p.company_domain ?? "-"} ${p.company_name ?? "-"}`), ["Bob Ray beta.io Beta Inc", "Eve Ng - Delta LLC"]);
    assert.equal(scan.kept[1]!.title, "VP, IT");
    assert.equal(scan.kept[0]!.city, "Reno");
    assert.equal(scan.kept[0]!.employee_range, "11 to 50");
  });
});
