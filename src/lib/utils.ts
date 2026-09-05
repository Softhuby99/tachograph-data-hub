import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format the numbers inside a "Card Quantities" string with dot thousand
 * separators (German style): 2000000 -> 2.000.000, 2000 -> 2.000.
 * Numbers already separated by , or . are normalised so both "2,000,000" and
 * "2.000.000" become "2.000.000". Non-numeric text (e.g. "approx.", "cards")
 * is left untouched; numbers with fewer than 4 digits stay as typed.
 */
export function formatQuantities(raw: string): string {
  return raw.replace(/\d[\d.,]*\d/g, (m) => {
    const digits = m.replace(/[^\d]/g, "");
    if (digits.length < 4) return m;
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  });
}
