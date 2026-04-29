// Run with: node scripts/generate-vapid-keys.mjs
// Requires Node.js 18+
//
// You only need to run this once. The keys are then stored:
//   - private key  → Cloudflare Worker secret (`wrangler secret put VAPID_PRIVATE_KEY`)
//   - public key   → index.html (hardcoded — safe to be public)
//   - subject      → Cloudflare Worker secret (`wrangler secret put VAPID_SUBJECT`)

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const b64url = buf => Buffer.from(buf).toString('base64url');

console.log('\n=== VAPID Keys — keep the private key secret! ===\n');
console.log('1. VAPID_PUBLIC_KEY (paste into index.html as VAPID_PUBLIC_KEY constant):');
console.log(b64url(publicRaw));
console.log('\n2. VAPID_PRIVATE_KEY (run `wrangler secret put VAPID_PRIVATE_KEY`, then paste this):');
console.log(JSON.stringify(privateJwk));
console.log('\n3. VAPID_SUBJECT (run `wrangler secret put VAPID_SUBJECT`, then paste your mailto):');
console.log('mailto:your-email@example.com');
console.log('\n================================================\n');
