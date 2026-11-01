import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Licence for customers who install the server themselves (HOSTING_MODE=self).
 * The vendor signs it with a private key that never leaves the vendor; the server
 * only holds the public key, so a customer cannot edit their own licence.
 */
export interface Licence {
  customer: string;
  edition: 'starter' | 'business' | 'enterprise';
  modules: string[];
  maxEmployees: number;
  expires: string; // yyyy-mm-dd
}

export interface SignedLicence {
  licence: Licence;
  signature: string; // base64
}

export type LicenceState =
  | { status: 'not_required' }
  | { status: 'valid'; licence: Licence }
  | { status: 'expired'; licence: Licence }
  | { status: 'invalid'; reason: string };

export function canonical(licence: Licence): string {
  const ordered: Licence = {
    customer: licence.customer,
    edition: licence.edition,
    modules: [...licence.modules].sort(),
    maxEmployees: licence.maxEmployees,
    expires: licence.expires,
  };
  return JSON.stringify(ordered);
}

export function checkLicence(signed: SignedLicence, publicKeyBase64: string, today = new Date()): LicenceState {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
    const ok = verify(null, Buffer.from(canonical(signed.licence)), key, Buffer.from(signed.signature, 'base64'));
    if (!ok) return { status: 'invalid', reason: 'The licence signature does not match.' };
  } catch (err) {
    return { status: 'invalid', reason: `The licence could not be checked: ${(err as Error).message}` };
  }
  const end = new Date(`${signed.licence.expires}T23:59:59Z`);
  return today > end ? { status: 'expired', licence: signed.licence } : { status: 'valid', licence: signed.licence };
}

export async function loadLicence(mode: 'cloud' | 'self', path: string, publicKey: string): Promise<LicenceState> {
  if (mode === 'cloud') return { status: 'not_required' };
  if (!publicKey) return { status: 'invalid', reason: 'LICENCE_PUBLIC_KEY is not set.' };
  try {
    const signed = JSON.parse(await readFile(path, 'utf8')) as SignedLicence;
    return checkLicence(signed, publicKey);
  } catch (err) {
    return { status: 'invalid', reason: `No readable licence file at ${path}: ${(err as Error).message}` };
  }
}
