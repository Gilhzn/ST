/**
 * In-memory onboarding draft (birth month/year from the age gate). Kept out of
 * URLs and storage: if the person is under 16 nothing is kept (design §13.2).
 */
let draft: { birthYear: number; birthMonth: number } | null = null;

export function setBirth(value: { birthYear: number; birthMonth: number } | null): void {
  draft = value;
}

export function getBirth(): { birthYear: number; birthMonth: number } | null {
  return draft;
}
