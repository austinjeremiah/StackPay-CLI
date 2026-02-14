import express from 'express';
import { exec } from 'child_process';
import chalk from 'chalk';
import { paymentMiddleware, getPayment, STXtoMicroSTX, BTCtoSats, formatPaymentAmount } from 'x402-stacks';
import { loadWallet } from '../utils/wallet';
import { startLocalFacilitator } from '../utils/facilitator';
import { resolveBNS, lookupBNS } from '../utils/bns';

const FACILITATOR_PORT = 8085;
const FACILITATOR_URL = `http://localhost:${FACILITATOR_PORT}`;

export async function serveCommand(options: {
  cmd: string;
  price: string;
  token: string;
  port: string;
  description?: string;
  receiver?: string;
}) {
  let wallet: any;
  try {
    wallet = loadWallet();
  } catch (err: any) {
    console.error(chalk.red(err.message));
    return;
  }

  const port = parseInt(options.port) || 3000;
  const token = (options.token || 'STX').toUpperCase();
  const priceFloat = parseFloat(options.price);

  let amount: bigint;
  if (token === 'STX') {
    amount = STXtoMicroSTX(priceFloat);
  } else if (token === 'SBTC') {
    amount = BTCtoSats(priceFloat);
  } else {
    console.error(chalk.red(`Unsupported token: ${token}`));
    return;
  }

  // Resolve receiver address — BNS name or raw address
  let receiverAddress = wallet.address;
  let receiverDisplay = wallet.address;

  if (options.receiver) {
    try {
      const resolved = await resolveBNS(options.receiver);
      receiverAddress = resolved.address;
      receiverDisplay = resolved.isBNS
        ? `${resolved.name} → ${resolved.address}`
        : resolved.address;
      if (resolved.isBNS) {
        console.log(chalk.green(`  ✅ BNS resolved: ${resolved.name} → ${resolved.address}`));
      }
    } catch (err: any) {
      console.error(chalk.red(`❌ ${err.message}`));
      return;
    }
  } else {
    // Try reverse BNS lookup for display
    const name = await lookupBNS(wallet.address);
    if (name) receiverDisplay = `${name} (${wallet.address})`;
  }

  startLocalFacilitator(FACILITATOR_PORT);

  const app = express();
  app.use(express.json());
  app.use(express.text());

  let totalEarned = 0n;

  app.get('/health', (_req, res) => {
    res.json({
      status: 'live',
      price: `${options.price} ${token}`,
      address: receiverAddress,
      network: wallet.network,
      totalEarned: formatPaymentAmount(totalEarned),
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      name: options.description || 'stackspay service',
      protocol: 'x402-stacks',
      version: 2,
      price: `${options.price} ${token}`,
      payTo: receiverAddress,
      network: wallet.network,
      endpoint: `POST /run`,
      usage: `stackspay pay http://localhost:${port}/run`,
    });
  });

  app.post(
    '/run',
    paymentMiddleware({
      amount,
      payTo: receiverAddress,
      network: wallet.network,
      facilitatorUrl: FACILITATOR_URL,
      description: options.description || `Execute: ${options.cmd}`,
      asset: token === 'SBTC' ? 'SBTC' : 'STX',
    }),
    async (req: any, res: any) => {
      totalEarned += amount;
      const payment = getPayment(req);
      const input = req.body;

      console.log(chalk.green(`\n⚡ Payment received!`));
      console.log(chalk.gray(`   From   : ${payment?.payer || 'unknown'}`));
      console.log(chalk.gray(`   Amount : ${options.price} ${token}`));
      console.log(chalk.gray(`   TX     : ${payment?.transaction || 'pending'}`));

      const cmdWithInput = typeof input === 'string' && input
        ? `echo '${input.replace(/'/g, "'\\''")}' | ${options.cmd}`
        : options.cmd;

      exec(cmdWithInput, { timeout: 30000 }, (error, stdout) => {
        if (error) return res.status(500).json({ success: false, error: error.message });
        const output = stdout.trim();
        console.log(chalk.cyan(`   Output : ${output}`));
        console.log(chalk.bold.green(`   Total earned: ${formatPaymentAmount(totalEarned)}`));
        res.json({
          success: true,
          output,
          payment: { payer: payment?.payer, transaction: payment?.transaction },
        });
      });
    }
  );

  app.listen(port, () => {
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  🚀 stackspay — x402 Service Live'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Command  :'), chalk.white(options.cmd));
    console.log(chalk.cyan('  Price    :'), chalk.green.bold(`${options.price} ${token}`));
    console.log(chalk.cyan('  Receiver :'), chalk.white(receiverDisplay));
    console.log(chalk.cyan('  Network  :'), chalk.white(wallet.network));
    console.log(chalk.cyan('  Endpoint :'), chalk.blue(`http://localhost:${port}/run`));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
    console.log(chalk.yellow('  To call this service:'));
    console.log(chalk.gray(`  stackspay pay http://localhost:${port}/run`));
    console.log(chalk.gray('  Waiting for payments... Press Ctrl+C to stop'));
  });
}