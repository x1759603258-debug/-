import assert from "node:assert/strict";

process.env.SUB2API_BASE_URL ||= "https://example.test/v1";
process.env.SUB2API_KEY ||= "test-key";

const { upstreamHeaders } = await import("./proxy.js");

const headers = upstreamHeaders();

assert.equal(headers.Authorization, "Bearer test-key");
assert.equal(headers["Content-Type"], "application/json");
assert.ok(headers.Accept.includes("application/json"));
assert.equal(headers.Origin, "https://example.test");
assert.equal(headers.Referer, "https://example.test/");
assert.ok(headers["User-Agent"].includes("Mozilla/5.0"));

const formHeaders = upstreamHeaders({ "Content-Type": undefined } as unknown as HeadersInit);

assert.equal("Content-Type" in formHeaders, false);
assert.equal(formHeaders.Authorization, "Bearer test-key");
assert.equal(formHeaders.Origin, "https://example.test");
assert.equal(formHeaders.Referer, "https://example.test/");
assert.ok(formHeaders["User-Agent"].includes("Mozilla/5.0"));
