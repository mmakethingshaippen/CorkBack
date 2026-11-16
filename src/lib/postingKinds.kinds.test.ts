/**
 * Feature: board-usability-improvements
 * Property 10: Category kinds are total and correct
 * **Validates: Requirements 7.1, 7.2, 7.6, 7.7, 7.8**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CATEGORIES } from "./categories";
import { categoryKind, fieldSpec } from "./postingKinds";

const LISTING = ["jobs", "housing", "sale", "lost-found"];
const EVENT = ["music", "nightlife", "sports", "social-clubs", "classes"];
const KNOWN = CATEGORIES.map((c) => c.slug as string);

describe("Property 10: category kinds are total and correct", () => {
  it("maps every real slug to the right kind", () => {
    fc.assert(
      fc.property(fc.constantFrom(...KNOWN), (slug) => {
        const expected = LISTING.includes(slug) ? "listing" : slug === "community" ? "event-optional" : "event";
        expect(categoryKind(slug)).toBe(expected);
      }),
    );
    for (const slug of KNOWN) expect(LISTING.includes(slug) || slug === "community" || EVENT.includes(slug)).toBe(true);
  });

  it("treats any unknown string as event", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !KNOWN.includes(s)),
        (slug) => {
          expect(categoryKind(slug)).toBe("event");
          expect(fieldSpec(slug).kind).toBe("event");
        },
      ),
    );
  });

  it("gives every slug and hasEventDate value a non-empty action label and button", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...KNOWN), fc.string()), fc.boolean(), (slug, hasEventDate) => {
        const spec = fieldSpec(slug, { hasEventDate });
        expect(spec.actionLabel.length).toBeGreaterThan(0);
        expect(spec.actionButton.length).toBeGreaterThan(0);
        if (slug === "community") expect(spec.actionButton === "RSVP").toBe(hasEventDate);
      }),
    );
  });
});

describe("field spec labels (Requirement 7.5 to 7.8)", () => {
  it.each([
    ["jobs", "Apply by (optional)", "Application link (optional)", "Apply"],
    ["housing", "Available until (optional)", "Listing or contact link (optional)", "View listing"],
    ["sale", "Offer ends (optional)", "Listing link (optional)", "View listing"],
    ["lost-found", "Keep this up until (optional)", "Contact link (optional)", "Contact"],
  ])("%s listing labels", (slug, deadline, link, button) => {
    const spec = fieldSpec(slug);
    expect(spec.kind).toBe("listing");
    expect(spec.deadlineLabel).toBe(deadline);
    expect(spec.actionLabel).toBe(link);
    expect(spec.actionButton).toBe(button);
    expect(spec.showsEventFields).toBe(false);
  });

  it.each(EVENT)("%s event labels", (slug) => {
    const spec = fieldSpec(slug);
    expect(spec.actionLabel).toBe("RSVP link (optional)");
    expect(spec.actionButton).toBe("RSVP");
    expect(spec.showsEventFields).toBe(true);
    expect(spec.deadlineLabel).toBeNull();
  });

  it("community: link label, RSVP with a date, Learn more without", () => {
    expect(fieldSpec("community").actionLabel).toBe("Link (optional)");
    expect(fieldSpec("community").showsEventFields).toBe(true);
    expect(fieldSpec("community").eventDateOptional).toBe(true);
    expect(fieldSpec("community", { hasEventDate: true }).actionButton).toBe("RSVP");
    expect(fieldSpec("community", { hasEventDate: false }).actionButton).toBe("Learn more");
    expect(fieldSpec("community").actionButton).toBe("Learn more");
  });
});
