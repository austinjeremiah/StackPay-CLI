import express from 'express';
import { exec } from 'child_process';
import chalk from 'chalk';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { paymentMiddleware, getPayment, STXtoMicroSTX, formatPaymentAmount } from 'x402-stacks';
import { loadWallet } from '../utils/wallet';
import { startLocalFacilitator } from '../utils/facilitator';
import { resolveBNS } from '../utils/bns';

const FACILITATOR_PORT = 8088;
const FACILITATOR_URL = `http://localhost:${FACILITATOR_PORT}`;
const VAULT_FILE = path.join(os.homedir(), '.stackspay', 'vault.json');

interface VaultRule {
  type: 'split' | 'lock' | 'reserve';
  address?: string;
  name?: string;        // ← FIXED: added name here
  percentage: number;
  unlockBlock?: number;
  unlockDate?: string;
}

interface VaultState {
  totalReceived: number;
  totalSplit: number;
  totalLocked: number;
  totalReserve: number;
  payments: Array<{
    txid: string;
    amount: number;
    timestamp: string;
    splits: any[];
  }>;
}

function loadVaultState(): VaultState {
  try {
    if (fs.existsSync(VAULT_FILE)) {
      return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
    }
  } catch {}
  return { totalReceived: 0, totalSplit: 0, totalLocked: 0, totalReserve: 0, payments: [] };
}

function saveVaultState(state: VaultState) {
  const dir = path.dirname(VAULT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VAULT_FILE, JSON.stringify(state, null, 2));
}

async function fetchCurrentBlock(host: string): Promise<number> {
  return new Promise((resolve) => {
    https.get({ hostname: host, path: '/v2/info', headers: { Accept: 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(json.stacks_tip_height || 0);
        } catch { resolve(0); }
      });
    }).on('error', () => resolve(0));
  });
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(m|h|d|w)$/);
  if (!match) throw new Error(`Invalid duration: "${duration}" — use 1h, 7d, 2w`);
  const value = parseInt(match[1]);
  const unit = match[2];
  const blocksPerMin = 0.1;
  switch (unit) {
    case 'm': return Math.ceil(value * blocksPerMin);
    case 'h': return Math.ceil(value * 60 * blocksPerMin);
    case 'd': return Math.ceil(value * 24 * 60 * blocksPerMin);
    case 'w': return Math.ceil(value * 7 * 24 * 60 * blocksPerMin);
    default: throw new Error(`Unknown unit: ${unit}`);
  }
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
    } catch (e: any) { reject(e); }
  });
}

export async function vaultCommand(options: {
  cmd: string;
  price: string;
  token: string;
  port: string;
  split?: string[];
  lock?: string;
  reserve?: string;
  description?: string;
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
  const totalAmount = STXtoMicroSTX(priceFloat);
  const host = wallet.network === 'mainnet' ? 'api.hiro.so' : 'api.testnet.hiro.so';

  const rules: VaultRule[] = [];
  let allocatedPct = 0;

  // Parse splits with BNS support
  if (options.split && options.split.length > 0) {
    for (const s of options.split) {
      const lastColon = s.lastIndexOf(':');
      if (lastColon === -1) {
        console.error(chalk.red(`❌ Invalid split: "${s}" — use ADDRESS:PCT or name.btc:PCT`));
        return;
      }
      const nameOrAddr = s.slice(0, lastColon);
      const pct = s.slice(lastColon + 1);
      const percentage = parseFloat(pct);
      if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
        console.error(chalk.red(`❌ Invalid percentage in "${s}"`));
        return;
      }
      const resolved = await resolveBNS(nameOrAddr);
      if (resolved.isBNS) {
        console.log(chalk.green(`  ✅ BNS: ${resolved.name} → ${resolved.address}`));
      }
      rules.push({
        type: 'split',
        address: resolved.address,
        name: resolved.name,        // ← now works
        percentage,
      });
      allocatedPct += percentage;
    }
  }

  // Parse reserve
  const reservePct = options.reserve ? parseFloat(options.reserve) : 0;
  if (reservePct > 0) {
    rules.push({ type: 'reserve', percentage: reservePct });
    allocatedPct += reservePct;
  }

  // Parse lock
  if (options.lock) {
    let lockBlocks: number;
    try {
      lockBlocks = parseDuration(options.lock);
    } catch (err: any) {
      console.error(chalk.red(`❌ ${err.message}`));
      return;
    }
    const lockPct = 100 - allocatedPct;
    if (lockPct <= 0) {
      console.error(chalk.red('❌ Nothing left to lock — split + reserve already equals 100%'));
      return;
    }
    const currentBlock = await fetchCurrentBlock(host);
    const unlockBlock = currentBlock + lockBlocks;
    const unlockDate = new Date(Date.now() + lockBlocks * 10 * 60 * 1000).toLocaleString();
    rules.push({ type: 'lock', percentage: lockPct, unlockBlock, unlockDate });
    allocatedPct += lockPct;
  }

  const ownerPct = 100 - allocatedPct;
  if (ownerPct < 0) {
    console.error(chalk.red(`❌ Allocations exceed 100% (got ${allocatedPct}%)`));
    return;
  }

  startLocalFacilitator(FACILITATOR_PORT);

  const app = express();
  app.use(express.json());
  app.use(express.text());

  let vaultState = loadVaultState();

  app.get('/', (_req, res) => {
    res.json({
      name: options.description || 'stackspay vault',
      protocol: 'x402-stacks',
      version: 2,
      price: `${options.price} ${token}`,
      payTo: wallet.address,
      network: wallet.network,
      vault: {
        rules: rules.map(r => ({
          type: r.type,
          percentage: r.percentage,
          ...(r.name && { name: r.name }),
          ...(r.address && { address: r.address }),
          ...(r.unlockBlock && { unlockBlock: r.unlockBlock, unlockDate: r.unlockDate }),
        })),
        ownerShare: `${ownerPct}%`,
        stats: vaultState,
      },
    });
  });

  app.get('/vault', (_req, res) => {
    res.json({
      address: wallet.address,
      totalReceived: `${vaultState.totalReceived.toFixed(6)} STX`,
      totalSplit: `${vaultState.totalSplit.toFixed(6)} STX`,
      totalLocked: `${vaultState.totalLocked.toFixed(6)} STX`,
      totalReserve: `${vaultState.totalReserve.toFixed(6)} STX`,
      ownerEarned: `${(vaultState.totalReceived - vaultState.totalSplit - vaultState.totalLocked - vaultState.totalReserve).toFixed(6)} STX`,
      recentPayments: vaultState.payments.slice(0, 5),
    });
  });

  app.post(
    '/run',
    paymentMiddleware({
      amount: totalAmount,
      payTo: wallet.address,
      network: wallet.network,
      facilitatorUrl: FACILITATOR_URL,
      description: options.description || `Vault: ${options.cmd}`,
      asset: 'STX',
    }),
    async (req: any, res: any) => {
      const payment = getPayment(req);
      const input = req.body;

      console.log(chalk.green(`\n⚡ Payment received — executing vault rules`));
      console.log(chalk.gray(`   From   : ${payment?.payer || 'unknown'}`));
      console.log(chalk.gray(`   Amount : ${options.price} ${token}`));
      console.log(chalk.gray(`   TX     : ${payment?.transaction || 'pending'}`));

      const cmdWithInput = typeof input === 'string' && input
        ? `echo '${input.replace(/'/g, "'\\''")}' | ${options.cmd}`
        : options.cmd;

      exec(cmdWithInput, { timeout: 30000 }, async (error, stdout) => {
        if (error) return res.status(500).json({ success: false, error: error.message });

        const output = stdout.trim();
        console.log(chalk.cyan(`   Output : ${output}`));

        const paymentRecord = {
          txid: payment?.transaction || 'pending',
          amount: priceFloat,
          timestamp: new Date().toISOString(),
          splits: [] as any[],
        };

        res.json({
          success: true,
          output,
          payment: {
            payer: payment?.payer,
            transaction: payment?.transaction,
            amount: `${options.price} ${token}`,
          },
          vault: {
            rules: rules.map(r => ({
              type: r.type,
              percentage: r.percentage,
              amount: `${(priceFloat * r.percentage / 100).toFixed(6)} STX`,
              ...(r.name && { to: r.name }),
              ...(r.address && !r.name && { to: r.address }),
              ...(r.unlockBlock && { unlocksAt: r.unlockDate }),
            })),
            ownerShare: `${(priceFloat * ownerPct / 100).toFixed(6)} STX`,
          },
        });

        console.log(chalk.yellow(`\n   Executing vault rules...`));

        for (const rule of rules) {
          const ruleAmount = BigInt(Math.floor(Number(totalAmount) * rule.percentage / 100));
          const ruleSTX = (Number(ruleAmount) / 1_000_000).toFixed(6);
          const displayTo = rule.name || (rule.address ? rule.address.slice(0, 16) + '...' : '');

          if (rule.type === 'split' && rule.address) {
            try {
              const txid = await sendSTX(wallet.privateKey, rule.address, ruleAmount, wallet.network, 'x402:split');
              console.log(chalk.green(`   ✅ SPLIT: ${ruleSTX} STX → ${displayTo} (${rule.percentage}%)`));
              console.log(chalk.blue(`      TX: https://explorer.hiro.so/txid/${txid}?chain=${wallet.network}`));
              vaultState.totalSplit += Number(ruleAmount) / 1_000_000;
              paymentRecord.splits.push({ type: 'split', to: displayTo, amount: ruleSTX, txid });
            } catch (err: any) {
              console.log(chalk.red(`   ❌ Split failed → ${displayTo}: ${err.message}`));
            }
          } else if (rule.type === 'lock') {
            console.log(chalk.magenta(`   🔒 LOCK: ${ruleSTX} STX until block #${rule.unlockBlock}`));
            console.log(chalk.magenta(`      Unlocks: ${rule.unlockDate}`));
            vaultState.totalLocked += Number(ruleAmount) / 1_000_000;
            paymentRecord.splits.push({ type: 'lock', amount: ruleSTX, unlockBlock: rule.unlockBlock });
          } else if (rule.type === 'reserve') {
            console.log(chalk.cyan(`   💰 RESERVE: ${ruleSTX} STX saved (${rule.percentage}%)`));
            vaultState.totalReserve += Number(ruleAmount) / 1_000_000;
            paymentRecord.splits.push({ type: 'reserve', amount: ruleSTX });
          }
        }

        if (ownerPct > 0) {
          console.log(chalk.green(`   💵 OWNER: ${(priceFloat * ownerPct / 100).toFixed(6)} STX → you (${ownerPct}%)`));
        }

        vaultState.totalReceived += priceFloat;
        vaultState.payments.unshift(paymentRecord);
        if (vaultState.payments.length > 50) vaultState.payments = vaultState.payments.slice(0, 50);
        saveVaultState(vaultState);
        console.log(chalk.bold.green(`\n   Vault total received: ${vaultState.totalReceived.toFixed(6)} STX`));
      });
    }
  );

  app.listen(port, () => {
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  🏦 stackspay — Programmable Payment Vault'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Command  :'), chalk.white(options.cmd));
    console.log(chalk.cyan('  Price    :'), chalk.green.bold(`${options.price} ${token}`));
    console.log(chalk.cyan('  Wallet   :'), chalk.white(wallet.address));
    console.log(chalk.cyan('  Network  :'), chalk.white(wallet.network));
    console.log('');
    console.log(chalk.bold.yellow('  Vault Rules:'));
    rules.forEach(r => {
      const amt = (priceFloat * r.percentage / 100).toFixed(6);
      const display = r.name || r.address || '';
      if (r.type === 'split') {
        console.log(chalk.gray(`      SPLIT   ${r.percentage}% (${amt} STX) → ${display}`));
      } else if (r.type === 'lock') {
        console.log(chalk.gray(`     LOCK    ${r.percentage}% (${amt} STX) until ${r.unlockDate}`));
      } else if (r.type === 'reserve') {
        console.log(chalk.gray(`     RESERVE ${r.percentage}% (${amt} STX) saved`));
      }
    });
    if (ownerPct > 0) {
      console.log(chalk.gray(`     OWNER   ${ownerPct}% (${(priceFloat * ownerPct / 100).toFixed(6)} STX) → you`));
    }
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
    console.log(chalk.yellow('  To call this service:'));
    console.log(chalk.gray(`  npm run dev -- pay http://localhost:${port}/run`));
    console.log(chalk.gray(`  Vault stats: http://localhost:${port}/vault`));
    console.log(chalk.gray('  Waiting for payments... Press Ctrl+C to stop'));
  });
}