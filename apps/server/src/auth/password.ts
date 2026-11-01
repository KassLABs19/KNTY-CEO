import bcrypt from 'bcryptjs';

const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimum password rules. Returns a message when the password is too weak. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(plain) || !/[0-9]/.test(plain)) return 'Use both letters and numbers.';
  return null;
}

// A throwaway hash so a wrong email takes as long to check as a wrong password.
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= bcrypt.hash('not-a-real-password', COST);
  return dummy;
}
