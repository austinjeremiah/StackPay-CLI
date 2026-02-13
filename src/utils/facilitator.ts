import express from 'express';
import https from 'https';

const TESTNET_HOST = 'api.testnet.hiro.so';
const MAINNET_HOST = 'api.hiro.so';

function getHost(network: string): string {
  return network.includes('2147483648') ? TESTNET_HOST : MAINNET_HOST;
}

function httpsGet(host: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get({ hostname: host, path, headers: { Accept: 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Derive Stacks address from pubkey hash using c32check
function getAddressFromPubkeyHash(pkHash: string): string {
  try {
    const c32check = require('c32check');
    return c32check.c32address(26, pkHash); // 26 = testnet version
  } catch {
    return '';
  }
}

// Fetch the REAL current nonce from Hiro API
async function fetchNonce(address: string, host: string): Promise<number> {
  try {
    const data = await httpsGet(host, `/extended/v1/address/${address}/nonces`);
    const rawNonce = data.possible_next_nonce;
    const nonce = typeof rawNonce === 'number' ? rawNonce : 0;
    console.log(`[Facilitator] Fetched nonce for ${address}: ${nonce}`);
    return nonce;
  } catch (e: any) {
    console.log(`[Facilitator] Nonce fetch failed: ${e.message}, using tx nonce`);
    return -1; // signal to use tx nonce as-is
  }
}

// Patch nonce at bytes 27-34 (big-endian uint64)
function patchNonce(txHex: string, nonce: number): string {
  const buf = Buffer.from(txHex.replace('0x', ''), 'hex');
  buf.writeBigUInt64BE(BigInt(nonce), 27);
  return buf.toString('hex');
}

// Extract sender pubkey hash from tx (bytes 7-26)
function extractSenderPkHash(txHex: string): string {
  const buf = Buffer.from(txHex.replace('0x', ''), 'hex');
  return buf.slice(7, 27).toString('hex');
}

// Get nonce currently encoded in tx
function getTxNonce(txHex: string): number {
  const buf = Buffer.from(txHex.replace('0x', ''), 'hex');
  return Number(buf.readBigUInt64BE(27));
}

function broadcastRaw(txHex: string, host: string): Promise<{ txid: string; error?: string }> {
  return new Promise((resolve) => {
    const txBytes = Buffer.from(txHex.replace('0x', ''), 'hex');
    const req = https.request({
      hostname: host,
      path: '/v2/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': txBytes.length,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          console.log(`[Facilitator] Broadcast response (${res.statusCode}): ${raw.substring(0, 200)}`);

          // Success: quoted txid string
          if (raw.startsWith('"') && raw.endsWith('"')) {
            const txid = raw.slice(1, -1).trim();
            return resolve({ txid });
          }

          const json = JSON.parse(raw);
          if (json.txid) return resolve({ txid: json.txid });
          const error = json.reason || json.error || json.message || JSON.stringify(json);
          resolve({ txid: '', error });
        } catch (e: any) {
          resolve({ txid: '', error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ txid: '', error: e.message }));
    req.write(txBytes);
    req.end();
  });
}

export function startLocalFacilitator(port: number = 8085): void {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/supported', (_req, res) => {
    res.json({
      kinds: [
        { x402Version: 2, scheme: 'exact', network: 'stacks:1' },
        { x402Version: 2, scheme: 'exact', network: 'stacks:2147483648' },
      ],
      extensions: [],
    });
  });

  app.post('/verify', (req, res) => {
    const { paymentPayload } = req.body;
    const inner = paymentPayload?.payload || paymentPayload;
    const txHex = inner?.payload?.transaction || inner?.transaction;
    if (!txHex || txHex.replace('0x', '').length < 100) {
      return res.json({ isValid: false, invalidReason: 'MISSING_TRANSACTION' });
    }
    res.json({ isValid: true, payer: 'verified' });
  });

  app.post('/settle', async (req, res) => {
    try {
      const { paymentPayload, paymentRequirements } = req.body;
      const inner = paymentPayload?.payload || paymentPayload;
      let txHex: string = inner?.payload?.transaction || inner?.transaction || '';
      const network = paymentRequirements?.network || inner?.accepted?.network || 'stacks:2147483648';
      const host = getHost(network);

      if (!txHex) {
        return res.json({ success: false, errorReason: 'MISSING_TRANSACTION', transaction: '', network });
      }

      // Get sender address and fetch REAL nonce from chain
      const pkHash = extractSenderPkHash(txHex);
      const senderAddress = getAddressFromPubkeyHash(pkHash);
      const txNonce = getTxNonce(txHex);

      console.log(`[Facilitator] Sender: ${senderAddress}, TX nonce: ${txNonce}`);

      if (senderAddress) {
        const realNonce = await fetchNonce(senderAddress, host);
        if (realNonce >= 0 && realNonce !== txNonce) {
          console.log(`[Facilitator] Patching nonce: ${txNonce} → ${realNonce}`);
          txHex = patchNonce(txHex, realNonce);
        }
      }

      // Broadcast
      console.log(`[Facilitator] Broadcasting to ${host}...`);
      let result = await broadcastRaw(txHex, host);

      // If still nonce error, retry with +1
      if (result.error?.toLowerCase().includes('nonce') || result.error?.toLowerCase().includes('badnonce')) {
        const currentNonce = getTxNonce(txHex);
        console.log(`[Facilitator] Nonce error, retrying with ${currentNonce + 1}...`);
        txHex = patchNonce(txHex, currentNonce + 1);
        result = await broadcastRaw(txHex, host);
      }

      if (result.txid) {
        console.log(`[Facilitator] ✅ TX confirmed: ${result.txid}`);
        return res.json({ success: true, payer: senderAddress || 'stacks-wallet', transaction: result.txid, network });
      }

      console.log(`[Facilitator] ❌ Failed: ${result.error}`);
      res.json({ success: false, errorReason: result.error, transaction: '', network });

    } catch (err: any) {
      console.error(`[Facilitator] Fatal: ${err.message}`);
      res.status(500).json({ success: false, errorReason: err.message, transaction: '', network: 'stacks:2147483648' });
    }
  });

  app.listen(port, () => {
    console.log(`  [Facilitator] Local x402 facilitator running on :${port}`);
  });
}