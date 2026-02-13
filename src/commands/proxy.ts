import express from 'express';
import chalk from 'chalk';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { paymentMiddleware, getPayment, STXtoMicroSTX, formatPaymentAmount } from 'x402-stacks';
import { loadWallet } from '../utils/wallet';
import { startLocalFacilitator } from '../utils/facilitator';

const FACILITATOR_PORT = 8086; // separate port from serve
const FACILITATOR_URL = `http://localhost:${FACILITATOR_PORT}`;

function forwardRequest(
  targetUrl: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    // Clean headers - remove x402 specific ones
    const cleanHeaders = { ...headers };
    delete cleanHeaders['payment-signature'];
    delete cleanHeaders['host'];
    delete cleanHeaders['content-length'];
    if (body) cleanHeaders['content-length'] = String(body.length);

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: cleanHeaders,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 200,
          headers: res.headers as Record<string, string>,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    if (body && body.length > 0) req.write(body);
    req.end();
  });
}

export async function proxyCommand(options: {
  target: string;
  price: string;
  token: string;
  port: string;
  path?: string;
  description?: string;
}) {
  let wallet: any;
  try {
    wallet = loadWallet();
  } catch (err: any) {
    console.error(chalk.red(err.message));
    return;
  }

  // Validate target URL
  let targetUrl: URL;
  try {
    targetUrl = new URL(options.target);
  } catch {
    console.error(chalk.red(`❌ Invalid target URL: ${options.target}`));
    console.error(chalk.gray('   Example: stackspay proxy --target https://api.openai.com/v1/chat/completions --price 0.01'));
    return;
  }

  const port = parseInt(options.port) || 4000;
  const token = (options.token || 'STX').toUpperCase();
  const priceFloat = parseFloat(options.price);
  const amount = STXtoMicroSTX(priceFloat);
  const proxyPath = options.path || '/proxy';

  startLocalFacilitator(FACILITATOR_PORT);

  const app = express();
  app.use(express.raw({ type: '*/*', limit: '10mb' }));

  let totalRequests = 0;
  let totalEarned = 0n;

  // Free info endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: options.description || `x402 proxy → ${options.target}`,
      protocol: 'x402-stacks',
      version: 2,
      price: `${options.price} ${token}`,
      payTo: wallet.address,
      network: wallet.network,
      proxyTarget: options.target,
      endpoint: `POST/GET ${proxyPath}`,
      usage: `stackspay pay http://localhost:${port}${proxyPath}`,
    });
  });

  // x402 protected proxy — all methods
  const handler = [
    paymentMiddleware({
      amount,
      payTo: wallet.address,
      network: wallet.network,
      facilitatorUrl: FACILITATOR_URL,
      description: options.description || `Proxy: ${options.target}`,
      asset: 'STX',
    }),
    async (req: any, res: any) => {
      totalRequests++;
      totalEarned += amount;
      const payment = getPayment(req);

      console.log(chalk.green(`\n⚡ Payment received — forwarding request`));
      console.log(chalk.gray(`   From   : ${payment?.payer || 'unknown'}`));
      console.log(chalk.gray(`   Amount : ${options.price} ${token}`));
      console.log(chalk.gray(`   TX     : ${payment?.transaction || 'pending'}`));
      console.log(chalk.gray(`   Target : ${options.target}`));

      try {
        // Forward to target
        const body = req.body instanceof Buffer && req.body.length > 0 ? req.body : null;
        const forwardHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') forwardHeaders[k] = v;
        }

        const result = await forwardRequest(options.target, req.method, forwardHeaders, body);

        console.log(chalk.cyan(`   Status : ${result.status}`));
        console.log(chalk.bold.green(`   Total earned: ${formatPaymentAmount(totalEarned)} STX`));

        // Forward response back to client
        res.status(result.status);
        for (const [k, v] of Object.entries(result.headers)) {
          if (k !== 'transfer-encoding') res.setHeader(k, v);
        }
        res.send(result.body);
      } catch (err: any) {
        console.log(chalk.red(`   Error  : ${err.message}`));
        res.status(502).json({ success: false, error: `Proxy error: ${err.message}` });
      }
    },
  ];

  app.all(proxyPath, ...handler);

  app.listen(port, () => {
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('   stackspay — x402 Proxy Live'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Target   :'), chalk.white(options.target));
    console.log(chalk.cyan('  Price    :'), chalk.green.bold(`${options.price} ${token} per request`));
    console.log(chalk.cyan('  Wallet   :'), chalk.white(wallet.address));
    console.log(chalk.cyan('  Network  :'), chalk.white(wallet.network));
    console.log(chalk.cyan('  Proxy at :'), chalk.blue(`http://localhost:${port}${proxyPath}`));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
    console.log(chalk.yellow('  Example call:'));
    console.log(chalk.gray(`  stackspay pay http://localhost:${port}${proxyPath}`));
    console.log('');
    console.log(chalk.gray('  Waiting for paid requests... Press Ctrl+C to stop'));
  });
}