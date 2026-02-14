import https from 'https';

function httpsGet(host: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: host,
      path,
      headers: { Accept: 'application/json' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Resolve BNS name (e.g. austin.btc) → Stacks address
// If already ST/SP address, returns as-is
export async function resolveBNS(
  nameOrAddress: string
): Promise<{ address: string; isBNS: boolean; name?: string }> {
  const trimmed = nameOrAddress.trim();

  // Already a Stacks address
  if (trimmed.startsWith('ST') || trimmed.startsWith('SP')) {
    return { address: trimmed, isBNS: false };
  }

  // Must contain a dot to be a BNS name
  if (!trimmed.includes('.')) {
    throw new Error(`"${trimmed}" is not a valid Stacks address or BNS name`);
  }

  try {
    // BNS names always resolved via mainnet API
    const data = await httpsGet('api.hiro.so', `/v1/names/${trimmed}`);
    if (data?.address) {
      return { address: data.address, isBNS: true, name: trimmed };
    }
    throw new Error(`BNS name "${trimmed}" has no address`);
  } catch (err: any) {
    throw new Error(`Could not resolve "${trimmed}": ${err.message}`);
  }
}

// Reverse lookup: Stacks address → BNS name (if any)
export async function lookupBNS(address: string): Promise<string | null> {
  try {
    const data = await httpsGet('api.hiro.so', `/v1/addresses/stacks/${address}`);
    const names: string[] = data?.names || [];
    return names.length > 0 ? names[0] : null;
  } catch {
    return null;
  }
}