import express from 'express';
import { exec } from 'child_process';
import chalk from 'chalk';
import { paymentMiddleware, getPayment, STXtoMicroSTX, formatPaymentAmount } from 'x402-stacks';
import { loadWallet } from '../utils/wallet';
import { startLocalFacilitator } from '../utils/facilitator';
import { resolveBNS, lookupBNS } from '../utils/bns';

const FACILITATOR_PORT = 8089;
const FACILITATOR_URL = `http://localhost:${FACILITATOR_PORT}`;

interface NegotiationOffer {
  offeredPrice: number;
  agentId?: string;
  reason?: string;
}

interface NegotiationResult {
  accepted: boolean;
  finalPrice?: number;
  counterOffer?: number;
  message: string;
}

function evaluateOffer(
  offer: number,
  listedPrice: number,
  minPrice: number
): NegotiationResult {
  // Accept if offer >= listed price
  if (offer >= listedPrice) {
    return {
      accepted: true,
      finalPrice: offer,
      message: `Offer of ${offer} STX accepted`,
    };
  }

  // Accept if offer >= min price (below listed but above floor)
  if (offer >= minPrice) {
    return {
      accepted: true,
      finalPrice: offer,
      message: `Discounted offer of ${offer} STX accepted (floor: ${minPrice} STX)`,
    };
  }

  // Reject but counter-offer at min price
  const counterOffer = minPrice;
  return {
    accepted: false,
    counterOffer,
    message: `Offer of ${offer} STX rejected. Counter-offer: ${counterOffer} STX`,
  };
}

export async function agentCommand(options: {
  cmd: string;
  price: string;
  min?: string;
  token: string;
  port: string;
  negotiate: boolean;
  description?: string;
  capabilities?: string;
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
  const listedPrice = parseFloat(options.price);
  const minPrice = options.min ? parseFloat(options.min) : listedPrice * 0.5;
  const capabilities = options.capabilities
    ? options.capabilities.split(',').map(c => c.trim())
    : ['data', 'compute', 'analysis'];

  // BNS reverse lookup for display
  const bnsName = await lookupBNS(wallet.address);
  const agentIdentity = bnsName || wallet.address;

  startLocalFacilitator(FACILITATOR_PORT);

  const app = express();
  app.use(express.json());
  app.use(express.text());

  let totalEarned = 0;
  let totalNegotiations = 0;
  let acceptedOffers = 0;
  let rejectedOffers = 0;

  // Agent discovery endpoint — agents call this first to learn about the service
  app.get('/', (_req, res) => {
    res.json({
      name: options.description || 'stackspay agent service',
      protocol: 'x402-stacks',
      version: 2,
      agentReady: true,
      negotiable: options.negotiate,
      pricing: {
        listed: `${listedPrice} ${token}`,
        minimum: options.negotiate ? `${minPrice} ${token}` : `${listedPrice} ${token}`,
        currency: token,
      },
      payTo: wallet.address,
      identity: agentIdentity,
      network: wallet.network,
      capabilities,
      endpoints: {
        execute: `POST /run`,
        negotiate: options.negotiate ? `PATCH /negotiate` : null,
        status: `GET /status`,
      },
      usage: {
        direct: `stackspay agent-pay http://localhost:${port}/run`,
        negotiate: options.negotiate
          ? `stackspay agent-pay http://localhost:${port}/run --negotiate`
          : null,
      },
    });
  });

  // Status endpoint
  app.get('/status', (_req, res) => {
    res.json({
      online: true,
      address: wallet.address,
      identity: agentIdentity,
      stats: {
        totalEarned: `${totalEarned.toFixed(6)} ${token}`,
        totalNegotiations,
        acceptedOffers,
        rejectedOffers,
        acceptanceRate: totalNegotiations > 0
          ? `${((acceptedOffers / totalNegotiations) * 100).toFixed(1)}%`
          : 'N/A',
      },
    });
  });

  // Negotiation endpoint — agent sends an offer before paying
  if (options.negotiate) {
    app.patch('/negotiate', (req: any, res: any) => {
      const body: NegotiationOffer = req.body;

      if (!body.offeredPrice || isNaN(body.offeredPrice)) {
        return res.status(400).json({
          error: 'Invalid offer — include { offeredPrice: number, agentId?: string }',
        });
      }

      totalNegotiations++;
      const result = evaluateOffer(body.offeredPrice, listedPrice, minPrice);

      if (result.accepted) {
        acceptedOffers++;
        console.log(chalk.green(`\n  Negotiation accepted`));
        console.log(chalk.gray(`   Agent    : ${body.agentId || 'anonymous'}`));
        console.log(chalk.gray(`   Offered  : ${body.offeredPrice} ${token}`));
        console.log(chalk.gray(`   Accepted : ${result.finalPrice} ${token}`));

        return res.json({
          status: 'accepted',
          finalPrice: result.finalPrice,
          currency: token,
          payTo: wallet.address,
          message: result.message,
          next: `POST /run with payment of ${result.finalPrice} ${token}`,
        });
      } else {
        rejectedOffers++;
        console.log(chalk.yellow(`\n  Negotiation rejected — counter-offer sent`));
        console.log(chalk.gray(`   Agent     : ${body.agentId || 'anonymous'}`));
        console.log(chalk.gray(`   Offered   : ${body.offeredPrice} ${token}`));
        console.log(chalk.gray(`   Counter   : ${result.counterOffer} ${token}`));

        return res.status(200).json({
          status: 'counter-offer',
          counterOffer: result.counterOffer,
          currency: token,
          payTo: wallet.address,
          message: result.message,
          next: `Send PATCH /negotiate with offeredPrice >= ${result.counterOffer}`,
        });
      }
    });
  }

  // Execute endpoint — agent pays and gets result
  app.post(
    '/run',
    paymentMiddleware({
      amount: STXtoMicroSTX(listedPrice),
      payTo: wallet.address,
      network: wallet.network,
      facilitatorUrl: FACILITATOR_URL,
      description: options.description || `Agent service: ${options.cmd}`,
      asset: 'STX',
    }),
    async (req: any, res: any) => {
      const payment = getPayment(req);
      const input = req.body;

      totalEarned += listedPrice;

      console.log(chalk.green(`\n  Agent payment received`));
      console.log(chalk.gray(`   From     : ${payment?.payer || 'unknown'}`));
      console.log(chalk.gray(`   Amount   : ${listedPrice} ${token}`));
      console.log(chalk.gray(`   TX       : ${payment?.transaction || 'pending'}`));

      const cmdWithInput = typeof input === 'string' && input
        ? `echo '${input.replace(/'/g, "'\\''")}' | ${options.cmd}`
        : options.cmd;

      exec(cmdWithInput, { timeout: 30000 }, (error, stdout) => {
        if (error) {
          return res.status(500).json({
            success: false,
            error: error.message,
            agentReady: true,
          });
        }

        const output = stdout.trim();
        console.log(chalk.cyan(`   Output   : ${output}`));
        console.log(chalk.bold.green(`   Total earned: ${totalEarned.toFixed(6)} ${token}`));

        // Agent-friendly structured response
        res.json({
          success: true,
          agentReady: true,
          proofOfIntel: {
            output,
            executedAt: new Date().toISOString(),
            transaction: payment?.transaction,
            paidBy: payment?.payer,
            amount: `${listedPrice} ${token}`,
            network: wallet.network,
            explorerUrl: `https://explorer.hiro.so/txid/${payment?.transaction}?chain=${wallet.network}`,
          },
          capabilities,
          provider: agentIdentity,
        });
      });
    }
  );

  app.listen(port, () => {
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  stackspay — Agent Service Live'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Command      :'), chalk.white(options.cmd));
    console.log(chalk.cyan('  Listed Price :'), chalk.green.bold(`${listedPrice} ${token}`));
    if (options.negotiate) {
      console.log(chalk.cyan('  Min Price    :'), chalk.yellow(`${minPrice} ${token}`));
      console.log(chalk.cyan('  Negotiable   :'), chalk.green('YES'));
    }
    console.log(chalk.cyan('  Identity     :'), chalk.white(agentIdentity));
    console.log(chalk.cyan('  Network      :'), chalk.white(wallet.network));
    console.log(chalk.cyan('  Capabilities :'), chalk.gray(capabilities.join(', ')));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
    if (options.negotiate) {
      console.log(chalk.yellow('  Negotiation endpoints:'));
      console.log(chalk.gray(`  PATCH http://localhost:${port}/negotiate  — send offer`));
      console.log(chalk.gray(`  POST  http://localhost:${port}/run        — pay and execute`));
    }
    console.log('');
    console.log(chalk.yellow('  To call this agent service:'));
    console.log(chalk.gray(`  stackspay agent-pay http://localhost:${port}/run`));
    if (options.negotiate) {
      console.log(chalk.gray(`  stackspay agent-pay http://localhost:${port}/run --negotiate`));
    }
    console.log(chalk.gray('  Waiting for agent calls... Press Ctrl+C to stop'));
  });
}