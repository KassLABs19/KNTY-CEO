import { authenticator } from 'otplib';

authenticator.options = { window: 1 }; // accept the previous/next 30-second code too

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}

export function otpauthUrl(email: string, secret: string, issuer = 'KNTY CEO'): string {
  return authenticator.keyuri(email, issuer, secret);
}

export function verifyTotp(code: string, secret: string): boolean {
  return authenticator.check(code.replace(/\s/g, ''), secret);
}

export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}
