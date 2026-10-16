// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  CityPicker,
  cityPhotoSrc,
  cityEconomyFlavor,
} from "./CityPicker";
import type { CityInfo } from "../lib/api";

/**
 * Fixtures mirror the server's citySummary() output
 * (server/src/game/cities.js) — the picker must render these verbatim,
 * nothing hardcoded.
 */
const CITIES: CityInfo[] = [
  {
    id: "lagos",
    name: "Lagos",
    state: "Lagos State",
    tagline: "The hustle capital — higher pay, higher bills, zero sleep.",
    emoji: "🌉",
    starting_cash: 2000,
    pay_mult: 1.15,
    cost_mult: 1.15,
  },
  {
    id: "benin",
    name: "Benin City",
    state: "Edo State",
    tagline: "The ancient bronze kingdom — heritage, festivals, and quiet old money.",
    emoji: "🏛️",
    starting_cash: 3000,
    pay_mult: 1.0,
    cost_mult: 0.95,
  },
  {
    id: "ph",
    name: "Port Harcourt",
    state: "Rivers State",
    tagline: "Oil & gas money flows here — big contracts, bigger weekends.",
    emoji: "🛢️",
    starting_cash: 3000,
    pay_mult: 1.2,
    cost_mult: 1.1,
  },
  {
    id: "abuja",
    name: "Abuja",
    state: "FCT",
    tagline: "The capital — government contracts, civil service, planned-city calm.",
    emoji: "🦅",
    starting_cash: 2500,
    pay_mult: 1.1,
    cost_mult: 1.1,
  },
];

describe("CityPicker", () => {
  afterEach(cleanup);

  it("renders one full-bleed card per server city with its photo", () => {
    render(<CityPicker cities={CITIES} selectedId="lagos" onSelect={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].getAttribute("aria-checked")).toBe("false");
    const imgs = document.querySelectorAll(".citypick-card__bg");
    expect(imgs).toHaveLength(4);
    expect(imgs[0].getAttribute("src")).toBe("/cities/lagos.jpg");
    expect(imgs[1].getAttribute("src")).toBe("/cities/benin.jpg");
    expect(imgs[2].getAttribute("src")).toBe("/cities/ph.jpg");
    expect(imgs[3].getAttribute("src")).toBe("/cities/abuja.jpg");
  });

  it("renders server name, tagline, state and starting cash verbatim", () => {
    render(<CityPicker cities={CITIES} selectedId="lagos" onSelect={() => {}} />);
    expect(screen.getByText("Benin City")).toBeTruthy();
    expect(
      screen.getByText(
        "The ancient bronze kingdom — heritage, festivals, and quiet old money."
      )
    ).toBeTruthy();
    expect(screen.getByText("₦2,000 starting cash")).toBeTruthy();
    // benin and ph share the same starting cash — both cards render it.
    expect(screen.getAllByText("₦3,000 starting cash")).toHaveLength(2);
  });

  it("marks the selected card and fires onSelect on tap", () => {
    const onSelect = vi.fn();
    render(<CityPicker cities={CITIES} selectedId="lagos" onSelect={onSelect} />);
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[2]);
    expect(onSelect).toHaveBeenCalledWith("ph");
    const cards = document.querySelectorAll(".citypick-card");
    expect(cards[0].classList.contains("citypick-card--sel")).toBe(true);
    expect(cards[2].classList.contains("citypick-card--sel")).toBe(false);
  });

  it("starts with nothing selected when selectedId is null", () => {
    render(<CityPicker cities={CITIES} selectedId={null} onSelect={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    for (const r of radios) {
      expect(r.getAttribute("aria-checked")).toBe("false");
    }
    const cards = document.querySelectorAll(".citypick-card");
    for (const card of cards) {
      expect(card.classList.contains("citypick-card--sel")).toBe(false);
    }
  });

  it("cityPhotoSrc maps city ids to /cities/*.jpg", () => {
    expect(cityPhotoSrc("lagos")).toBe("/cities/lagos.jpg");
    expect(cityPhotoSrc("benin")).toBe("/cities/benin.jpg");
    expect(cityPhotoSrc("ph")).toBe("/cities/ph.jpg");
    expect(cityPhotoSrc("abuja")).toBe("/cities/abuja.jpg");
  });

  it("cityEconomyFlavor derives pay/cost flavor from server multipliers", () => {
    expect(cityEconomyFlavor(CITIES[0])).toBe("higher pay, higher costs");
    expect(cityEconomyFlavor(CITIES[1])).toBe("steady pay, lower costs");
    expect(cityEconomyFlavor(CITIES[2])).toBe("top pay, high costs");
    expect(cityEconomyFlavor(CITIES[3])).toBe("higher pay, high costs");
  });
});
