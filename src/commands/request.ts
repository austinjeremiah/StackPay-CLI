import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { createServer } from 'http';
import { loadWallet } from '../utils/wallet';

function generateQR(text: string): string {
  // Simple terminal QR using block characters
  // We'll use a URL shortener approach and display the URL prominently
  // For actual QR we use a public API
  return text;
}

async function fetchQRAsText(url: string): Promise<string> {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(url);
    https.get({
      hostname: 'api.qrserver.com',
      path: `/v1/create-qr-code/?size=200x200&data=${encoded}`,
      headers: { Accept: 'image/png' },
    }, (res) => {
      // Just return the QR image URL for display
      resolve(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`);
    }).on('error', () => resolve(''));
  });
}

function generatePaymentPage(wallet: any, price: string, token: string, description: string, port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>stackspay — Payment Request</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #111;
      border: 1px solid #222;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 0 60px rgba(0,255,100,0.05);
    }
    .logo { font-size: 14px; color: #444; margin-bottom: 32px; letter-spacing: 2px; }
    .amount { font-size: 56px; font-weight: 800; color: #00ff88; margin: 16px 0; }
    .token { font-size: 20px; color: #555; margin-bottom: 8px; }
    .desc { color: #666; margin-bottom: 32px; font-size: 14px; line-height: 1.6; }
    .address-box {
      background: #0a0a0a;
      border: 1px solid #1a1a1a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      word-break: break-all;
      font-family: monospace;
      font-size: 12px;
      color: #888;
    }
    .address-label { font-size: 11px; color: #444; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
    .qr { margin: 24px auto; }
    .qr img { width: 180px; height: 180px; border-radius: 8px; border: 4px solid #1a1a1a; }
    .btn {
      display: inline-block;
      background: #00ff88;
      color: #000;
      font-weight: 700;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 15px;
      margin-top: 8px;
      width: 100%;
    }
    .btn:hover { background: #00cc66; }
    .network { font-size: 11px; color: #333; margin-top: 24px; }
    .powered { font-size: 11px; color: #222; margin-top: 12px; }
    .copy-btn {
      background: none;
      border: 1px solid #222;
      color: #555;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      margin-top: 8px;
    }
    .copy-btn:hover { border-color: #444; color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚡ STACKSPAY</div>
    <div class="token">Pay with STX</div>
    <div class="amount">${price}</div>
    <div class="token">${token}</div>
    <div class="desc">${description}</div>

    <div class="address-box">
      <div class="address-label">Send payment to</div>
      ${wallet.address}
      <br/>
      <button class="copy-btn" onclick="navigator.clipboard.writeText('${wallet.address}');this.textContent='Copied!'">
        Copy Address
      </button>
    </div>

    <div class="qr">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${wallet.address}" alt="QR Code" />
    </div>

    <a class="btn" href="https://explorer.hiro.so/sandbox/faucet?chain=${wallet.network}" target="_blank">
      Open Hiro Wallet to Pay
    </a>

    <div class="network">Network: Stacks ${wallet.network} · x402 Protocol v2</div>
    <div class="powered">Powered by stackspay</div>
  </div>
</body>
</html>`;
}

export async function requestCommand(options: {
  price: string;
  token: string;
  port: string;
  description?: string;
  save?: string;
}) {
  let wallet: any;
  try {
    wallet = loadWallet();
  } catch (err: any) {
    console.error(chalk.red(err.message));
    return;
  }

  const port = parseInt(options.port) || 5000;
  const token = (options.token || 'STX').toUpperCase();
  const price = options.price || '0.01';
  const description = options.description || `Pay ${price} ${token} via stackspay`;

  const html = generatePaymentPage(wallet, price, token, description, port);

  // Save to file if requested
  if (options.save) {
    fs.writeFileSync(options.save, html);
    console.log(chalk.green(`✅ Payment page saved to: ${options.save}`));
  }

  // Serve the payment page
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else if (req.url === '/address') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ address: wallet.address, price, token, network: wallet.network }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  🔗 stackspay — Payment Request Page'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Price    :'), chalk.green.bold(`${price} ${token}`));
    console.log(chalk.cyan('  Wallet   :'), chalk.white(wallet.address));
    console.log(chalk.cyan('  Network  :'), chalk.white(wallet.network));
    console.log(chalk.cyan('  Page     :'), chalk.blue.bold(`http://localhost:${port}`));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
    console.log(chalk.yellow('  Share this link for payments:'));
    console.log(chalk.blue.bold(`  http://localhost:${port}`));
    console.log('');
    console.log(chalk.gray('  QR Code:'));
    console.log(chalk.blue(`  https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${wallet.address}`));
    console.log('');
    console.log(chalk.gray('  Press Ctrl+C to stop'));
  });
}