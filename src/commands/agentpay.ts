import fetch from 'node-fetch';
const nodeFetch = require('node-fetch');
(global as any).fetch = nodeFetch.default || nodeFetch;
(global as any).Headers = nodeFetch.Headers;
(global as any).Request = nodeFetch.Request;
(global as any).Response = nodeFetch.Response;
import axios from 'axios';
import chalk from 'chalk';
import { loadWallet, BUYER_WALLET_FILE, loadWallet as loadBuyerWallet } from '../utils/wallet';
import fs from 'fs';

async function discoverService(url: string): Promise<any> {
  const base = url.replace('/run', '').replace('/negotiate', '');
  try {
    const res = await axios.get(base, { timeout: 5000 });
    return res.data;
  } catch {
    return null;
  }
}

async function negotiate(
  negotiateUrl: string,
  offeredPrice: number,
  agentId: string,
  maxRounds: number = 3
): Promise<{ success: boolean; finalPrice?: number; message?: string }> {
  let offer = offeredPrice;
  let round = 0;

  while (round < maxRounds) {
    round++;
    console.log(chalk.yellow(`\n  Negotiation round ${round}`));
    console.log(chalk.gray(`   Offering: ${offer} STX`));

    try {
      const res = await axios.patch(negotiateUrl, {
        offeredPrice: offer,
        agentId,
        reason: `Agent autonomous negotiation round ${round}`,
      });

      const data = res.data;

      if (data.status === 'accepted') {
        console.log(chalk.green(`   Accepted at ${data.finalPrice} STX`));
        return { success: true, finalPrice: data.finalPrice };
      }

      if (data.status === 'counter-offer') {
        console.log(chalk.yellow(`   Counter-offer: ${data.counterOffer} STX`));
        // Accept counter-offer on final round
        if (round === maxRounds) {
          console.log(chalk.cyan(`   Accepting counter-offer on final round`));
          offer = data.counterOffer;
          continue;
        }
        // Try to meet halfway between our offer and counter
        const midpoint = (offer + data.counterOffer) / 2;
        offer = parseFloat(midpoint.toFixed(6));
      }
    } catch (err: any) {
      console.log(chalk.red(`   Negotiation error: ${err.message}`));
      return { success: false, message: err.message };
    }
  }

  return { success: false, message: 'Negotiation failed after max rounds' };
}

export async function agentPayCommand(
  url: string,
  options: {
    negotiate?: boolean;
    offer?: string;
    agentId?: string;
    data?: string;
    file?: string;
    raw?: boolean;
  }
) {
  // Load buyer wallet
  let wallet: any;
  try {
    wallet = fs.existsSync(BUYER_WALLET_FILE)
      ? loadBuyerWallet(BUYER_WALLET_FILE)
      : loadBuyerWallet();
    console.log(chalk.gray(`  Agent wallet: ${wallet.address}`));
  } catch (err: any) {
    console.error(chalk.red(err.message));
    return;
  }

  const agentId = options.agentId || `stackspay-agent-${wallet.address.slice(0, 8)}`;

  // Step 1: Discover service
  console.log('');
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  Discovering service...'));

  const service = await discoverService(url);

  if (service) {
    console.log(chalk.green(`  Service      : ${service.name || 'unknown'}`));
    console.log(chalk.gray(`  Listed price : ${service.pricing?.listed || service.price || 'unknown'}`));
    console.log(chalk.gray(`  Negotiable   : ${service.negotiable ? 'YES' : 'NO'}`));
    console.log(chalk.gray(`  Capabilities : ${(service.capabilities || []).join(', ')}`));
  }

  // Step 2: Negotiate if requested and service supports it
  if (options.negotiate && service?.negotiable) {
    const listedPrice = parseFloat(
      (service.pricing?.listed || '0.001').replace(' STX', '').replace(' SBTC', '')
    );
    const offerPrice = options.offer
      ? parseFloat(options.offer)
      : listedPrice * 0.7; // Start at 70% of listed price

    const baseUrl = url.replace('/run', '');
    const negotiateUrl = `${baseUrl}/negotiate`;

    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.yellow('  Starting autonomous negotiation...'));
    console.log(chalk.gray(`  Strategy: offer 70% of listed, accept counter-offers`));

    const result = await negotiate(negotiateUrl, offerPrice, agentId);

    if (!result.success) {
      console.log(chalk.red(`\n  Negotiation failed: ${result.message}`));
      console.log(chalk.gray('  Falling back to listed price...'));
    } else {
      console.log(chalk.green(`\n  Deal agreed: ${result.finalPrice} STX`));
    }
  }

  // Step 3: Pay and execute — exact same flow as pay.ts
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  Paying and executing...'));

  try {
    const { wrapAxiosWithPayment, decodePaymentResponse } = require('x402-stacks');
    const { getAccount } = require('../utils/wallet');

    const startTime = Date.now();

    // Build request body
    let body: any = {};
    if (options.data) {
      try { body = JSON.parse(options.data); } catch { body = options.data; }
    } else if (options.file) {
      body = require('fs').readFileSync(options.file, 'utf-8');
    }

    const account = getAccount(wallet);
    const api = wrapAxiosWithPayment(axios.create({ timeout: 60000 }), account);

    const response = await api.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': agentId,
        'X-Agent-Ready': 'true',
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const paymentInfo = decodePaymentResponse(response.headers['payment-response']);
    const responseData = response.data;

    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  Agent Payment Complete'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Agent    :'), chalk.white(agentId));
    if (paymentInfo?.transaction) {
      console.log(chalk.cyan('  TX       :'), chalk.white(paymentInfo.transaction));
    }
    console.log(chalk.cyan('  Time     :'), chalk.white(`${elapsed}s`));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    if (options.raw) {
      console.log(JSON.stringify(responseData, null, 2));
    } else if (responseData?.proofOfIntel) {
      console.log(chalk.bold('\n  Proof of Intel:'));
      console.log(chalk.cyan('  Output    :'), chalk.white(responseData.proofOfIntel.output));
      console.log(chalk.cyan('  Executed  :'), chalk.gray(responseData.proofOfIntel.executedAt));
      console.log(chalk.cyan('  TX        :'), chalk.white(responseData.proofOfIntel.transaction));
      console.log(chalk.blue(`  Explorer  : https://explorer.hiro.so/txid/${paymentInfo?.transaction}?chain=${wallet.network}`));
    } else if (responseData?.output) {
      console.log(chalk.bold('\n  Response:'));
      console.log(chalk.white(responseData.output));
    } else {
      console.log(chalk.white(JSON.stringify(responseData, null, 2)));
    }

    if (paymentInfo?.transaction) {
      console.log(chalk.blue(`\n  View TX: https://explorer.hiro.so/txid/${paymentInfo.transaction}?chain=${wallet.network}`));
    }

  } catch (err: any) {
    console.error(chalk.red(`\n  Agent pay failed: ${err.message}`));
    if (err.response?.data) {
      console.error(chalk.gray(JSON.stringify(err.response.data, null, 2)));
    }
  }
}