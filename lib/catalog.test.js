const c = require("./catalog");

describe("prices", () => {
  test.each([["4.99", 499], ["$4.99", 499], ["4", 400], ["4.5", 450], ["1,000.00", 100000], [12.5, 1250]])("%p -> %p cents", (raw, cents) => {
    expect(c.parsePriceToCents(raw)).toBe(cents);
  });
  test.each(["", "abc", "4.999", "-1", "10000.00", "4.9.9"])("%p is not a price", (raw) => {
    expect(c.parsePriceToCents(raw)).toBeNull();
  });
});

describe("excluded-item screening (term 3)", () => {
  test.each([
    ["Bud Light Beer 6-pack", "alcohol"],
    ["Tito's Vodka", "alcohol"],
    ["Marlboro cigarettes", "tobacco_vape"],
    ["Disposable vape", "tobacco_vape"],
    ["CBD gummies", "cannabis_hemp_cbd"],
    ["Rx only allergy pills", "prescription"],
    ["9mm ammo", "weapons"],
    ["$25 gift card", "gift_cards_lottery"],
    ["Scratch-off tickets", "gift_cards_lottery"],
    ["Propane tank", "hazardous"],
    ["Live fish", "live_animals"]
  ])("%p is held as %p", (name, code) => {
    expect(c.screenItem({ name })).toContain(code);
  });
  test.each(["Ginger ale", "Seaweed snack", "Ginger root", "Rumble bar", "Hamburger", "Cheese pizza", "Card stock paper", "Live music night special"])("%p is not flagged", (name) => {
    expect(c.screenItem({ name })).toEqual([]);
  });
  test("section and description are screened too; held when flagged", () => {
    expect(c.screenItem({ name: "House special", description: "with a shot of whiskey" })).toEqual(["alcohol"]);
    expect(c.reviewStateFor(["alcohol"])).toEqual({ review_status: "held", review_flags: ["alcohol"] });
    expect(c.reviewStateFor([])).toEqual({ review_status: "listed", review_flags: [] });
  });
});

describe("item validation", () => {
  test("a new item gets defaults: available, not substitutable", () => {
    expect(c.validateItem({ name: "  Whole   milk ", price: "4.49" })).toEqual({ ok: true, value: { name: "Whole milk", price_cents: 449, available: true, substitutable: false } });
  });
  test("edits check only the fields sent", () => {
    expect(c.validateItem({ available: false }, { partial: true })).toEqual({ ok: true, value: { available: false } });
    expect(c.validateItem({ price: "0" }, { partial: true }).ok).toBe(false);
    expect(c.validateItem({ name: "x" }, { partial: true }).ok).toBe(false);
  });
});

describe("CSV import", () => {
  test("parses quotes, escaped quotes, commas and CRLF", () => {
    expect(c.parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  test("reads any column order, with per-line errors and duplicate names", () => {
    const csv = "Price,Name,Section,Substitutable\n4.99,Whole milk,Dairy,yes\nabc,Bread,,\n2.50,whole MILK,,\n3,Eggs,Dairy,maybe\n";
    const out = c.parseCatalogCsv(csv);
    expect(out.ok).toBe(true);
    expect(out.items).toEqual([{ line: 2, value: { name: "Whole milk", price_cents: 499, section: "Dairy", available: true, substitutable: true } }]);
    expect(out.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });
  test("file-level problems", () => {
    expect(c.parseCatalogCsv("").ok).toBe(false);
    expect(c.parseCatalogCsv("name,section\nMilk,Dairy").error).toMatch(/price/);
    expect(c.parseCatalogCsv("name,price").error).toMatch(/at least one item/);
    const many = "name,price\n" + Array.from({ length: 501 }, (_, i) => `Item ${i},1`).join("\n");
    expect(c.parseCatalogCsv(many).error).toMatch(/500/);
    expect(c.parseCatalogCsv("﻿name,price\nMilk,1").items).toHaveLength(1);
  });
});
