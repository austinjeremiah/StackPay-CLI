import express from 'express';
import { exec } from 'child_process';
import chalk from 'chalk';
import https from 'https';
import { paymentMiddleware, getPayment, STXtoMicroSTX, formatPaymentAmount } from 'x402-stacks';
import { loadWallet } from '../utils/wallet';
import { startLocalFacilitator } from '../utils/facilitator';

const FACILITATOR_PORT = 8087;
const FACILITATOR_URL = `http://localhost:${FACILITATOR_PORT}`;

interface SplitRecipient {
  address: string;
  percentage: number;
}

function parseSplits(splitArgs: string[]): SplitRecipient[] {
  return splitArgs.map(s => {
    const [address, pct] = s.split(':');
    if (!address || !pct) throw new Error(`Invalid split format: "${s}" — use ADDRESS:PERCENTAGE (e.g. ST1ABC:70)`);
    const percentage = parseFloat(pct);
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      throw new Error(`Invalid percentage in "${s}" — must be 1-100`);
    }
    return { address, percentage };
  });
}

function sendSTX(
  fromPrivateKey: string,
  toAddress: string,
  microSTX: bigint,
  network: string,
  memo: string
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const { makeSTXTokenTransfer, broadcastTransaction, AnchorMode } = require('@stacks/transactions');
      const stacksNetwork = network === 'mainnet'
        ? new (require('@stacks/network').StacksMainnet)()
        : new (require('@stacks/network').StacksTestnet)();

      const tx = await makeSTXTokenTransfer({
        recipient: toAddress,
        amount: microSTX,
        senderKey: fromPrivateKey,
        network: stacksNetwork,
        memo: memo.substring(0, 34),
        anchorMode: AnchorMode.Any,
      });

      const result = await broadcastTransaction(tx, stacksNetwork);
      if (result.error) reject(new Error(result.error));
      else resolve(result.txid || result);
    } catch (e: any) {
      reject(e);
    }
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
  try {
    wallet = loadWallet();
  } catch (err: any) {
    console.error(chalk.red(err.message));
    return;
  }

  // Parse and validate splits
  let recipients: SplitRecipient[];
  try {
    recipients = parseSplits(options.split);
  } catch (err: any) {
    console.error(chalk.red(`❌ ${err.message}`));
    console.error(chalk.gray('   Example: --split ST1ABC123:70 --split ST2XYZ456:30'));
    return;
  }

  const totalPct = recipients.reduce((sum, r) => sum + r.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.01) {
    console.error(chalk.red(`❌ Split percentages must total 100% (got ${totalPct}%)`));
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
  let splitCount = 0;

  app.get('/', (_req, res) => {
    res.json({
      name: options.description || 'stackspay split service',
      protocol: 'x402-stacks',
      version: 2,
      price: `${options.price} ${token}`,
      payTo: wallet.address,
      network: wallet.network,
      splits: recipients.map(r => ({ address: r.address, percentage: r.percentage })),
      endpoint: 'POST /run',
    });
  });

  app.post(
    '/run',
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
      splitCount++;
      const payment = getPayment(req);
      const input = req.body;

      console.log(chalk.green(`\n⚡ Payment received — splitting...`));
      console.log(chalk.gray(`   From   : ${payment?.payer || 'unknown'}`));
      console.log(chalk.gray(`   Amount : ${options.price} ${token}`));
      console.log(chalk.gray(`   TX     : ${payment?.transaction || 'pending'}`));

      // Execute command
      const cmdWithInput = typeof input === 'string' && input
        ? `echo '${input.replace(/'/g, "'\\''")}' | ${options.cmd}`
        : options.cmd;

      exec(cmdWithInput, { timeout: 30000 }, async (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        const output = stdout.trim();
        console.log(chalk.cyan(`   Output : ${output}`));

        // Send response immediately, then split in background
        res.json({
          success: true,
          output,
          payment: {
            payer: payment?.payer,
            transaction: payment?.transaction,
            amount: `${options.price} ${token}`,
            splits: recipients.map(r => ({
              address: r.address,
              percentage: r.percentage,
              amount: `${(priceFloat * r.percentage / 100).toFixed(6)} STX`,
            })),
          },
        });

        // Split payments in background
        console.log(chalk.yellow(`\n   Splitting payment...`));
        for (const recipient of recipients) {
          const splitAmount = BigInt(Math.floor(Number(totalAmount) * recipient.percentage / 100));
          const splitSTX = (Number(splitAmount) / 1_000_000).toFixed(6);

          try {
            const txid = await sendSTX(
              wallet.privateKey,
              recipient.address,
              splitAmount,
              wallet.network,
              `x402:split:${splitCount}`
            );
            console.log(chalk.green(`   ✅ ${splitSTX} STX → ${recipient.address.slice(0, 16)}... (${recipient.percentage}%)`));
            console.log(chalk.blue(`      TX: https://explorer.hiro.so/txid/${txid}?chain=${wallet.network}`));
          } catch (err: any) {
            console.log(chalk.red(`   ❌ Split failed for ${recipient.address}: ${err.message}`));
          }
        }

        console.log(chalk.bold.green(`\n   Total earned: ${formatPaymentAmount(totalEarned)} STX`));
      });
    }
  );

  app.listen(port, () => {
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  💸 stackspay — Split Payment Service'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Command  :'), chalk.white(options.cmd));
    console.log(chalk.cyan('  Price    :'), chalk.green.bold(`${options.price} ${token}`));
    console.log(chalk.cyan('  Network  :'), chalk.white(wallet.network));
    console.log('');
    console.log(chalk.bold.yellow('  Revenue Split:'));
    recipients.forEach(r => {
      const amt = (priceFloat * r.percentage / 100).toFixed(6);
      console.log(chalk.gray(`    ${r.percentage}% → ${r.address} (${amt} STX)`));
    });
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
    console.log(chalk.yellow('  To call this service:'));
    console.log(chalk.gray(`  stackspay pay http://localhost:${port}/run`));
    console.log('');
    console.log(chalk.gray('  Waiting for payments... Press Ctrl+C to stop'));
  });
}