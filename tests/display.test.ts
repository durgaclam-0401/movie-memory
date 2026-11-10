import { describe, expect, it } from "vitest";
import { displayName, initials } from "@/lib/display";

describe("profile fallbacks", () => {
  it("U-4 DASH-2: name, then email prefix, then 'Movie fan'", () => {
    expect(displayName({ name: "Ada Lovelace", email: "ada@example.com" })).toBe("Ada Lovelace");
    expect(displayName({ name: null, email: "ada@example.com" })).toBe("ada");
    expect(displayName({ name: "   ", email: "ada@example.com" })).toBe("ada");
    expect(displayName({ name: null, email: null })).toBe("Movie fan");
  });

  it("U-5 DASH-3: initials from first and last word", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Ada King Lovelace")).toBe("AL");
    expect(initials("cher")).toBe("C");
    expect(initials("Movie fan")).toBe("MF");
  });
});
