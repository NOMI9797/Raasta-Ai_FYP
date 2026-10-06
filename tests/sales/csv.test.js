import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, readLinkedInLeadsCsv } from "../../libs/sales/csv";

test("parseCsv keeps commas, quotes and line breaks inside quoted cells", () => {
  const rows = parseCsv('a,"b, c","say ""hi""","two\nlines"\r\n1,2,3,4\n');
  assert.deepEqual(rows, [
    ["a", "b, c", 'say "hi"', "two\nlines"],
    ["1", "2", "3", "4"],
  ]);
});

test("reads a LinkedIn export with headers, joining first and last name", () => {
  const csv = "First Name,Last Name,Company,Title,LinkedIn URL\nAli,Khan,\"Arbisoft, Inc.\",CTO,https://www.linkedin.com/in/alikhan\n";
  const { rows, skipped } = readLinkedInLeadsCsv(csv);
  assert.equal(skipped, 0);
  assert.deepEqual(rows, [
    { url: "https://www.linkedin.com/in/alikhan", name: "Ali Khan", title: "CTO", company: "Arbisoft, Inc." },
  ]);
});

test("reads a plain list of URLs without a header", () => {
  const { rows, skipped } = readLinkedInLeadsCsv("https://www.linkedin.com/in/one\nhttps://linkedin.com/in/two, extra\nnot a url\n");
  assert.deepEqual(rows.map((r) => r.url), ["https://www.linkedin.com/in/one", "https://linkedin.com/in/two"]);
  assert.equal(skipped, 1);
});

test("skips rows without a LinkedIn profile URL", () => {
  const { rows, skipped } = readLinkedInLeadsCsv("name,url\nA,https://example.com\nB,https://www.linkedin.com/in/b\n");
  assert.equal(rows.length, 1);
  assert.equal(skipped, 1);
});
