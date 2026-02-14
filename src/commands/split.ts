import express from 'express';
import { exec } from 'child_process';
import chalk from 'chalk';
import { paymentMiddleware, getPayment, STXtoMicroSTX, formatPaymentAmount } from 'x402-stacks';
import { loadWallet } from '../utils/wallet';
import { startLocalFacilitator } from '../utils/facilitator';
import { resolveBNS } from '../utils/bns';

const FACILITATOR_PORT = 8087;
const FACILITATOR_URL = `http://localhost:${FACILITATOR_PORT}`;

interface SplitRecipient {
  address: string;
  percentage: number;
  name?: string;
}

async function parseSplits(splitArgs: string[], network: string): Promise<SplitRecipient[]> {
  const results: SplitRecipient[] = [];
  for (const s of splitArgs) {
    const lastColon = s.lastIndexOf(':');
    if (lastColon === -1) throw new Error(`Invalid split: "${s}" — use ADDRESS:PCT or name.btc:PCT`);
    const nameOrAddr = s.slice(0, lastColon);
    const pct = s.slice(lastColon + 1);
    const percentage = parseFloat(pct);
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      throw new Error(`Invalid percentage in "${s}"`);
    }
    const resolved = await resolveBNS(nameOrAddr);
    if (resolved.isBNS) {
      console.log(chalk.green(`  ✅ BNS resolved: ${resolved.name} → ${resolved.address}`));
    }
    results.push({ address: resolved.address, percentage, name: resolved.name });
  }
  return results;
}

function sendSTX(fromKey: string, to: string, amount: bigint, network: string, memo: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const { makeSTXTokenTransfer, broadcastTransaction, AnchorMode } = require('@stacks/transactions');
      const net = network === 'mainnet'
        ? new (require('@stacks/network').StacksMainnet)()
        : new (require('@stacks/network').StacksTestnet)();
      const tx = await makeSTXTokenTransfer({
        recipient: to, amount, senderKey: fromKey,
        network: net, memo: memo.slice(0, 34), anchorMode: AnchorMode.Any,
      });
      const result = await broadcastTransaction(tx, net);
      if (result.error) reject(new Error(result.error));
      else resolve(result.txid || result);
    } catch (e: any) { reject(e); }
  });
}

export async function splitCommand(options: {
  cmd: string;
  price: string;
  token: string;
  port: string;
  split: string[];
  description?: string;
}) {
  let wallet: any;
  try { wallet = loadWallet(); } catch (err: any) { console.error(chalk.red(err.message)); return; }

  let recipients: SplitRecipient[];
  try {
    recipients = await parseSplits(options.split, wallet.network);
  } catch (err: any) {
    console.error(chalk.red(`❌ ${err.message}`));
    return;
  }

  const totalPct = recipients.reduce((s, r) => s + r.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.01) {
    console.error(chalk.red(`❌ Splits must total 100% (got ${totalPct}%)`));
    return;
  }

  const port = parseInt(options.port) || 3000;
  const token = (options.token || 'STX').toUpperCase();
  const priceFloat = parseFloat(options.price);
  const totalAmount = STXtoMicroSTX(priceFloat);

  startLocalFacilitator(FACILITATOR_PORT);
  const app = express();
  app.use(express.json());
  app.use(express.text());
  let totalEarned = 0n;

  app.get('/', (_req, res) => {
    res.json({
      name: options.description || 'stackspay split',
      protocol: 'x402-stacks',
      version: 2,
      price: `${options.price} ${token}`,
      payTo: wallet.address,
      network: wallet.network,
      splits: recipients.map(r => ({ to: r.name || r.address, percentage: r.percentage })),
    });
  });

  app.post('/run',
    paymentMiddleware({
      amount: totalAmount,
      payTo: wallet.address,
      network: wallet.network,
      facilitatorUrl: FACILITATOR_URL,
      description: options.description || `Split: ${options.cmd}`,
      asset: 'STX',
    }),
    async (req: any, res: any) => {
      totalEarned += totalAmount;
      const payment = getPayment(req);
      const input = req.body;

      console.log(chalk.green(`\n⚡ Payment received — splitting...`));
      console.log(chalk.gray(`   TX: ${payment?.transaction}`));

      const cmd = typeof input === 'string' && input
        ? `echo '${input.replace(/'/g, "'\\''")}' | ${options.cmd}`
        : options.cmd;

      exec(cmd, { timeout: 30000 }, async (error, stdout) => {
        if (error) return res.status(500).json({ success: false, error: error.message });
        const output = stdout.trim();
        console.log(chalk.cyan(`   Output: ${output}`));

        res.json({
          success: true, output,
          payment: {
            payer: payment?.payer,
            transaction: payment?.transaction,
            splits: recipients.map(r => ({
              to: r.name || r.address,
              percentage: r.percentage,
              amount: `${(priceFloat * r.percentage / 100).toFixed(6)} STX`,
            })),
          },
        });

        // Execute splits in background
        for (const r of recipients) {
          const amt = BigInt(Math.floor(Number(totalAmount) * r.percentage / 100));
          const display = r.name || r.address.slice(0, 16) + '...';
          try {
            const txid = await sendSTX(wallet.privateKey, r.address, amt, wallet.network, 'x402:split');
            console.log(chalk.green(`   ✅ ${(Number(amt) / 1e6).toFixed(6)} STX → ${display} (${r.percentage}%)`));
            console.log(chalk.blue(`      TX: https://explorer.hiro.so/txid/${txid}?chain=${wallet.network}`));
          } catch (e: any) {
            console.log(chalk.red(`   ❌ ${display}: ${e.message}`));
          }
        }
        console.log(chalk.green(`\n   Total earned: ${formatPaymentAmount(totalEarned)} STX`));
      });
    }
  );

  app.listen(port, () => {
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  💸 stackspay — Split Payment Service'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Command :'), chalk.white(options.cmd));
    console.log(chalk.cyan('  Price   :'), chalk.green.bold(`${options.price} ${token}`));
    console.log('');
    console.log(chalk.bold.yellow('  Revenue Split:'));
    recipients.forEach(r => {
      const amt = (priceFloat * r.percentage / 100).toFixed(6);
      const display = r.name ? `${r.name} (${r.address.slice(0, 12)}...)` : r.address;
      console.log(chalk.gray(`    ${r.percentage}% → ${display} (${amt} STX)`));
    });
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.gray(`\n  npm run dev -- pay http://localhost:${port}/run`));
    console.log(chalk.gray('  Waiting for payments... Press Ctrl+C to stop'));
  });
}