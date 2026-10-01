import { describe, expect, it } from "vitest";
import { paymentReceiptSchema, receivedAmountInWords } from "@/lib/invoice-receipts";

describe("received amount in Indian words", () => {
  it.each([
    [0, "Zero Rupees Only"], [1, "One Rupee Only"], [200, "Two Hundred Rupees Only"],
    [123456.78, "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only"],
    [10000000, "One Crore Rupees Only"], [1.01, "One Rupee and One Paisa Only"],
    [9.999, "Ten Rupees Only"],
  ])("formats %s", (amount, words) => expect(receivedAmountInWords(amount)).toBe(words));
  it.each([-1, Infinity, NaN, 10_000_000_000])("rejects invalid amount %s", (amount) => expect(() => receivedAmountInWords(amount)).toThrow());
  it.each(["upi", "card", "cash", "neft"])("accepts %s and normalizes reference", (method) => {
    expect(paymentReceiptSchema.parse({ amount: "25.50", method, reference: " ref " })).toEqual({ amount: 25.5, method, reference: "ref" });
  });
  it("rejects overprecise and unsupported receipts", () => {
    expect(paymentReceiptSchema.safeParse({ amount: 1.001, method: "cash" }).success).toBe(false);
    expect(paymentReceiptSchema.safeParse({ amount: 5, method: "crypto" }).success).toBe(false);
  });
});
