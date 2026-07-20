import {
  normalizeLocationIdentity,
  parseLocationGeography,
  parseLocationList,
  parseLocationText,
  splitLocationLabels,
} from "../src";

const CANADIAN_PROVINCES = [
  ["AB", "Alberta"],
  ["BC", "British Columbia"],
  ["MB", "Manitoba"],
  ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"],
  ["NT", "Northwest Territories"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Prince Edward Island"],
  ["QC", "Québec"],
  ["SK", "Saskatchewan"],
  ["YT", "Yukon"],
] as const;

const US_STATES_AND_DC = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
  ["DC", "District of Columbia"],
] as const;

describe("parseLocationText", () => {
  it("splits a plain US city and state label", () => {
    const parsed = parseLocationText("  Atlanta,   GA  ");

    expect(parsed).toMatchObject({
      location: { city: "Atlanta", state: "GA" },
      remoteMentioned: false,
      workFromHomeType: null,
    });
  });

  it("normalizes lowercase postal codes", () => {
    expect(parseLocationText("Atlanta, ga").location).toMatchObject({
      city: "Atlanta",
      state: "GA",
    });
  });

  it("accepts US territories and military postal regions", () => {
    expect(parseLocationText("San Juan, PR").location).toMatchObject({
      city: "San Juan",
      state: "PR",
    });
    expect(parseLocationText("APO, AE").location).toMatchObject({
      city: "APO",
      state: "AE",
    });
  });

  it.each([
    ["Atlanta, GA (Hybrid)", false, "Hybrid"],
    ["(REMOTE) Atlanta, ga", true, "Remote"],
    ["Atlanta, GA (hybrid and/or REMOTE)", true, "Hybrid or Remote"],
    ["hybrid / Atlanta, GA", false, "Hybrid"],
    ["(hYbRiD) / Atlanta, GA", false, "Hybrid"],
    ["Atlanta, GA / remote", true, "Remote"],
    ["REMOTE / Atlanta, GA / HYBRID", true, "Hybrid or Remote"],
  ] as const)(
    "extracts flexible workplace qualifiers from %s",
    (raw, remoteMentioned, workFromHomeType) => {
      expect(parseLocationText(raw)).toMatchObject({
        location: { city: "Atlanta", state: "GA" },
        remoteMentioned,
        workFromHomeType,
      });
    },
  );

  it("recognizes Canadian city/province labels and preserves unsafe labels", () => {
    expect(
      parseLocationText("Atlanta, GA (Headquarters)").location,
    ).toMatchObject({
      city: "Atlanta, GA (Headquarters)",
    });
    expect(parseLocationText("Toronto, ON").location).toMatchObject({
      city: "Toronto",
      state: "ON",
      country: "Canada",
    });
    expect(parseLocationText("Atlanta / Savannah, GA").location).toMatchObject({
      city: "Atlanta / Savannah, GA",
    });
  });

  it("splits a remote-qualified location and retains its workplace meaning", () => {
    const parsed = parseLocationText("Remote / Atlanta, GA");

    expect(parsed.location).toMatchObject({ city: "Atlanta", state: "GA" });
    expect(parsed.remoteMentioned).toBe(true);
    expect(parsed.workFromHomeType).toBe("Remote");
  });

  it("returns no location for empty input", () => {
    expect(parseLocationText("   ")).toEqual({
      location: null,
      remoteMentioned: false,
      workFromHomeType: null,
    });
    expect(parseLocationText(null)).toEqual({
      location: null,
      remoteMentioned: false,
      workFromHomeType: null,
    });
  });
});

describe("parseLocationList", () => {
  it("deduplicates equivalent US city/state/country labels and preserves remote signal", () => {
    const parsed = parseLocationList([
      "Mountain View, CA",
      "Mountain View, California, United States",
      "Seattle, WA",
      "Seattle, WA, United States",
      "Remote",
      "United States",
    ]);

    expect(parsed.labels).toEqual(["Mountain View, CA", "Seattle, WA"]);
    expect(parsed.locations).toHaveLength(3);
    expect(parsed.locations[0]).toMatchObject({
      city: "Mountain View",
      state: "CA",
    });
    expect(parsed.locations[1]).toMatchObject({
      city: "Seattle",
      state: "WA",
    });
    expect(parsed.locations[2]).toMatchObject({
      city: "Remote",
      country: "United States",
    });
    expect(parsed.location).toMatchObject({
      city: "Mountain View, CA; Seattle, WA",
      country: "United States",
    });
    expect(parsed.remoteMentioned).toBe(true);
    expect(parsed.workFromHomeType).toBe("Remote");
  });

  it("suppresses broad country-only labels when concrete locations exist", () => {
    const parsed = parseLocationList(["United States", "Austin, TX"]);

    expect(parsed.labels).toEqual(["Austin, TX"]);
    expect(parsed.location).toMatchObject({
      city: "Austin",
      state: "TX",
      country: "United States",
    });
  });

  it("collapses a bare city when a structured city/state form is present", () => {
    const parsed = parseLocationList([
      "Los Angeles",
      "Los Angeles, California, USA",
    ]);

    expect(parsed.labels).toEqual(["Los Angeles, CA"]);
    expect(parsed.location).toMatchObject({
      city: "Los Angeles",
      state: "CA",
      country: "United States",
    });
  });

  it("keeps remote-only labels visible when there are no concrete locations", () => {
    const parsed = parseLocationList(["Remote", "United States"]);

    expect(parsed.labels).toEqual([]);
    expect(parsed.location).toMatchObject({
      city: "Remote",
      country: "United States",
    });
    expect(parsed.locations).toEqual([
      expect.objectContaining({ city: "Remote", country: "United States" }),
    ]);
    expect(parsed.remoteMentioned).toBe(true);
    expect(parsed.workFromHomeType).toBe("Remote");
  });

  it("preserves a country-only advertised location in the complete array", () => {
    const parsed = parseLocationList(["Canada"]);

    expect(parsed.location).toMatchObject({ country: "Canada" });
    expect(parsed.locations).toEqual([
      expect.objectContaining({ country: "Canada" }),
    ]);
  });

  it("preserves multiple regional-remote countries without collapsing scope", () => {
    const parsed = parseLocationList(["Remote Canada / Remote US"]);

    expect(parsed.locations).toEqual([
      expect.objectContaining({ city: "Remote", country: "Canada" }),
      expect.objectContaining({ city: "Remote", country: "United States" }),
    ]);
  });

  it("preserves a North America regional location", () => {
    const parsed = parseLocationList(["Remote North America"]);

    expect(parsed.locations).toEqual([
      expect.objectContaining({ city: "Remote North America" }),
    ]);
  });

  it("preserves unsafe labels without losing source text", () => {
    const parsed = parseLocationList(["Toronto, ON", "Atlanta / Savannah, GA"]);

    expect(parsed.labels).toEqual(["Toronto, ON", "Atlanta / Savannah, GA"]);
    expect(parsed.location).toMatchObject({
      city: "Toronto, ON; Atlanta / Savannah, GA",
    });
  });

  it("splits supported multi-location delimiters in stable source order", () => {
    const parsed = parseLocationList([
      "Toronto, ON; Vancouver, BC | Calgary, Alberta",
      "Waterloo, Ontario / New York, NY",
      "Vancouver, British Columbia",
    ]);

    expect(parsed.labels).toEqual([
      "Toronto, ON",
      "Vancouver, BC",
      "Calgary, AB",
      "Waterloo, ON",
      "New York, NY",
    ]);
    expect(parsed.locations.map(normalizeLocationIdentity)).toEqual([
      "ca|on|toronto",
      "ca|bc|vancouver",
      "ca|ab|calgary",
      "ca|on|waterloo",
      "us|ny|new york",
    ]);
  });
});

describe("North-American geography parsing", () => {
  it.each(CANADIAN_PROVINCES)(
    "recognizes Canadian province %s and its full-name alias",
    (code, name) => {
      for (const label of [`Example, ${code}`, `Example, ${name}`]) {
        expect(parseLocationGeography(label)).toMatchObject({
          countryCode: "CA",
          region: "canada",
          confidence: "high",
          location: { city: "Example", state: code, country: "Canada" },
        });
      }
    },
  );

  it.each(US_STATES_AND_DC)(
    "recognizes US jurisdiction %s and its full-name alias",
    (code, name) => {
      for (const label of [`Example, ${code}`, `Example, ${name}`]) {
        expect(parseLocationGeography(label)).toMatchObject({
          countryCode: "US",
          region: "united-states",
          confidence: "high",
          location: { city: "Example", state: code, country: "United States" },
        });
      }
    },
  );

  it.each([
    ["Canada", "CA", "canada"],
    ["CAN", "CA", "canada"],
    ["Canadian", "CA", "canada"],
    ["United States", "US", "united-states"],
    ["United States of America", "US", "united-states"],
    ["U.S.A.", "US", "united-states"],
    ["American", "US", "united-states"],
  ] as const)("normalizes country alias %s", (label, countryCode, region) => {
    expect(parseLocationGeography(label)).toMatchObject({
      countryCode,
      region,
      confidence: "high",
    });
  });

  it.each([
    ["Toronto", "CA"],
    ["Greater Toronto Area", "CA"],
    ["GTA", "CA"],
    ["Waterloo", "CA"],
  ] as const)(
    "recognizes Canadian preference region %s",
    (label, countryCode) => {
      expect(parseLocationGeography(label)).toMatchObject({
        countryCode,
        region: "canada",
        confidence: "medium",
      });
    },
  );

  it("classifies country-qualified and regional remote labels", () => {
    expect(parseLocationGeography("Remote within Canada")).toMatchObject({
      countryCode: "CA",
      region: "canada",
      confidence: "high",
      remoteMentioned: true,
      location: { city: "Remote", country: "Canada" },
    });
    expect(parseLocationGeography("United States - Remote")).toMatchObject({
      countryCode: "US",
      region: "united-states",
      confidence: "high",
      remoteMentioned: true,
    });
    expect(parseLocationGeography("Remote North America")).toMatchObject({
      region: "north-america",
      confidence: "medium",
      remoteMentioned: true,
    });
    expect(parseLocationGeography("Remote Americas")).toMatchObject({
      region: "americas",
      confidence: "medium",
      remoteMentioned: true,
    });
    expect(parseLocationGeography("Remote")).toMatchObject({
      region: "unknown",
      confidence: "low",
      remoteMentioned: true,
    });
  });

  it("identifies a confidently non-North-American country", () => {
    expect(parseLocationGeography("Berlin, Germany")).toMatchObject({
      region: "other",
      confidence: "high",
      location: { city: "Berlin", country: "Germany" },
    });
  });

  it("keeps ambiguous slashes intact but splits independently structured labels", () => {
    expect(splitLocationLabels("Atlanta / Savannah, GA")).toEqual([
      "Atlanta / Savannah, GA",
    ]);
    expect(splitLocationLabels("Toronto, ON / Vancouver, BC")).toEqual([
      "Toronto, ON",
      "Vancouver, BC",
    ]);
    expect(splitLocationLabels("Remote Canada / Remote US")).toEqual([
      "Remote Canada",
      "Remote US",
    ]);
  });
});
