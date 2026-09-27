// PII masking for the Support role and password hashing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "@da2/shared/server";
import { maskAddress, maskEmail, maskOrder, maskPhone } from "../../apps/api/src/lib/pii";

test("emails keep only the first and last character of the local part", () => {
  assert.equal(maskEmail("saman.perera@gmail.com"), "s***a@gmail.com");
  assert.equal(maskEmail("a@x.lk"), "a***@x.lk");
  assert.equal(maskEmail(null), null);
});

test("phones show only the last four digits", () => {
  assert.equal(maskPhone("+94 77 123 4567"), "••• ••• 4567");
});

test("addresses keep city and country, hide street and postcode", () => {
  assert.deepEqual(maskAddress({ line1: "42 Galle Road", line2: "Kollupitiya", city: "Colombo 03", postcode: "00300", country: "Sri Lanka" }), {
    line1: "••••••",
    line2: "••••••",
    city: "Colombo 03",
    postcode: "•••••",
    country: "Sri Lanka",
  });
});

test("orders are masked for support but not for admin", () => {
  const order = { orderNumber: "ORD-1", contact: { name: "Kasun", email: "kasun@example.com", phone: "0771234567" }, shippingAddress: { line1: "1 Road", city: "Kandy" } };
  const s = maskOrder(order, "support");
  assert.equal(s.contact.email, "k***n@example.com");
  assert.equal(s.contact.name, "Kasun"); // needed to greet the customer
  assert.equal(s.shippingAddress.line1, "••••••");
  assert.deepEqual(maskOrder(order, "admin"), order);
});

test("passwords are salted scrypt hashes that verify only with the right password", async () => {
  const a = await hashPassword("correct horse battery");
  const b = await hashPassword("correct horse battery");
  assert.match(a, /^scrypt\$/);
  assert.notEqual(a, b); // a fresh random salt each time
  assert.equal(await verifyPassword("correct horse battery", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
  assert.equal(await verifyPassword("anything", "erased"), false); // erased accounts can't log in
});
