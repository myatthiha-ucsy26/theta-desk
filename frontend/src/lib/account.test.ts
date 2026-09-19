import { describe, expect, it } from "vitest";
import { accountBadge, bookLabel, bookWord, buyingPower, needsLiveConfirmation } from "./account";
import type { Account } from "./api";

describe("accountBadge", () => {
  it("marks the live account as a warning, not as good news", () => {
    // Nothing is wrong, but this is the state where a mistake costs money.
    expect(accountBadge("live")).toMatchObject({ tone: "warn", label: "Live account" });
  });

  it("keeps paper neutral and says no money moves", () => {
    const badge = accountBadge("paper");
    expect(badge.tone).toBe("neutral");
    expect(badge.hint).toMatch(/simulated/i);
  });

  it("never claims paper before the first status lands", () => {
    // Showing "Paper" while we do not know would be the dangerous default.
    expect(accountBadge(undefined).label).toBe("Account —");
    expect(accountBadge(null).label).toBe("Account —");
  });
});

describe("buyingPower", () => {
  const paper = { account: "paper", cash: 10000, currency: "USD", power: 9560 } as Account;
  const live = {
    account: "live", cash: 2, currency: "USD", net_value: 1, buying_power: 3,
    unrealized_pl: 4, open_count: 1,
  } as Account;

  it("reads whichever field the account reported", () => {
    expect(buyingPower(paper)).toBe(9560);
    expect(buyingPower(live)).toBe(3);
  });

  it("is null when there is nothing to read", () => {
    expect(buyingPower(null)).toBeNull();
    expect(buyingPower({ account: "paper", cash: 0, currency: "USD" } as Account)).toBeNull();
  });
});

describe("bookLabel", () => {
  it("names the book after its account", () => {
    expect(bookLabel("live")).toBe("Live book");
    expect(bookLabel("paper")).toBe("Paper book");
  });
});

describe("bookWord", () => {
  it("gives the one-word form a count chip reads with", () => {
    expect(bookWord("live")).toBe("live");
    expect(bookWord("paper")).toBe("paper");
    expect(bookWord(undefined)).toBe("paper");
  });
});

describe("needsLiveConfirmation", () => {
  it("asks on the way in and not on the way out", () => {
    expect(needsLiveConfirmation("paper", "live")).toBe(true);
    expect(needsLiveConfirmation("live", "paper")).toBe(false);
    expect(needsLiveConfirmation("live", "live")).toBe(false);
  });
});
