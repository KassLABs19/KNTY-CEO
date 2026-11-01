/**
 * Vendor-only tool for licences on customer-hosted servers.
 *
 *   npm run licence:keys -w @ceo/server
 *       Makes a key pair once. Keep licence-private.pem secret and out of git.
 *       Put the printed public key into LICENCE_PUBLIC_KEY on customer servers.
 *
 *   npm run licence:sign -w @ceo/server -- --customer "Acme Ltd" --edition business \
 *       --modules approvals,people,predicto --max 250 --expires 2027-12-31 --out licence.json
 *       Signs a licence with licence-private.pem. Send licence.json to the customer.
 */
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { canonical, type Licence, type SignedLicence } from '../src/licence.js';

const [command, ...rest] = process.argv.slice(2);

if (command === 'keys') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync('licence-private.pem', privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  console.log('Private key written to licence-private.pem (keep it secret, never commit it).');
  console.log(`LICENCE_PUBLIC_KEY=${pub}`);
} else if (command === 'sign') {
  const { values } = parseArgs({
    args: rest,
    options: {
      customer: { type: 'string' },
      edition: { type: 'string', default: 'business' },
      modules: { type: 'string', default: '' },
      max: { type: 'string', default: '100' },
      expires: { type: 'string' },
      key: { type: 'string', default: 'licence-private.pem' },
      out: { type: 'string', default: 'licence.json' },
    },
  });
  if (!values.customer || !values.expires) {
    console.error('Both --customer and --expires (yyyy-mm-dd) are required.');
    process.exit(1);
  }
  const licence: Licence = {
    customer: values.customer,
    edition: values.edition as Licence['edition'],
    modules: values.modules ? values.modules.split(',').map((m) => m.trim()) : [],
    maxEmployees: Number(values.max),
    expires: values.expires,
  };
  const key = createPrivateKey(readFileSync(values.key!));
  const signed: SignedLicence = { licence, signature: sign(null, Buffer.from(canonical(licence)), key).toString('base64') };
  writeFileSync(values.out!, JSON.stringify(signed, null, 2));
  console.log(`Licence for ${licence.customer} written to ${values.out}.`);
} else {
  console.log('Usage: licence.ts keys | licence.ts sign --customer NAME --expires YYYY-MM-DD [--edition] [--modules] [--max] [--out]');
  process.exit(command ? 1 : 0);
}
