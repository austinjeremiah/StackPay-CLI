import chalk from 'chalk';
import https from 'https';
import { loadWallet } from '../utils/wallet';

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

async function fetchLatestTxs(address: string, host: string): Promise<any[]> {
  try {
    const data = await httpsGet(host, `/extended/v1/address/${address}/transactions?limit=10`);
    return (data.results || []).filter((tx: any) =>
      tx.tx_type === 'token_transfer' &&
      tx.token_transfer?.recipient_address === address &&
      tx.tx_status === 'success'
    );
  } catch { return []; }
}

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function renderDashboard(
  wallet: any,
  payments: any[],
  totalEarned: number,
  startTime: Date,
  newCount: number
) {
  clearScreen();
  const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
  const mins = Math.floor(uptime / 60).toString().padStart(2, '0');
  const secs = (uptime % 60).toString().padStart(2, '0');

  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.green('  ⚡ stackspay — Live Payment Dashboard'));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('  Wallet  :'), chalk.white(wallet.address));
  console.log(chalk.cyan('  Network :'), chalk.white(wallet.network));
  console.log(chalk.cyan('  Uptime  :'), chalk.gray(`${mins}:${secs}`));
  console.log(chalk.cyan('  Earned  :'), chalk.green.bold(`${totalEarned.toFixed(6)} STX`));
  console.log(chalk.cyan('  Payments:'), chalk.white.bold(`${payments.length} total`), newCount > 0 ? chalk.green.bold(` (+${newCount} new!)`) : '');
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');

  if (payments.length === 0) {
    console.log(chalk.gray('  Waiting for payments...'));
    console.log(chalk.gray('  Run: stackspay serve --cmd "echo hello" --price 0.001 --token STX'));
  } else {
    console.log(chalk.bold.yellow('  Recent Payments:'));
    console.log('');
    payments.slice(0, 8).forEach((tx: any, i: number) => {
      const amount = (parseInt(tx.token_transfer.amount) / 1_000_000).toFixed(6);
      const from = tx.sender_address;
      const txid = tx.tx_id;
      const memo = tx.token_transfer.memo
        ? Buffer.from(tx.token_transfer.memo.replace('0x', ''), 'hex').toString('utf8').replace(/\0/g, '').trim()
        : '';
      const isX402 = memo.startsWith('x402:');
      const time = new Date(tx.burn_block_time_iso || Date.now()).toLocaleTimeString();

      console.log(
        chalk.gray(`  ${(i + 1).toString().padStart(2, ' ')}.`),
        chalk.green.bold(`+${amount} STX`),
        isX402 ? chalk.cyan('[x402]') : '',
        chalk.gray(`@ ${time}`)
      );
      console.log(chalk.gray(`      From: ${from.slice(0, 20)}...`));
      console.log(chalk.blue(`      TX  : https://explorer.hiro.so/txid/${txid}?chain=${wallet.network}`));
      console.log('');
    });
  }

  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.gray(`  Refreshing every 10s... Press Ctrl+C to stop`));
}

export async function watchCommand() {
  let wallet: any;
  try {
    wallet = loadWallet();
  } catch (err: any) {
    console.error(chalk.red(err.message));
    return;
  }

  const host = wallet.network === 'mainnet' ? 'api.hiro.so' : 'api.testnet.hiro.so';
  const startTime = new Date();
  let knownTxIds = new Set<string>();
  let allPayments: any[] = [];
  let totalEarned = 0;

  console.log(chalk.gray('Loading payment history...'));

  // Initial load
  const initial = await fetchLatestTxs(wallet.address, host);
  initial.forEach(tx => knownTxIds.add(tx.tx_id));
  allPayments = initial;
  totalEarned = initial.reduce((sum, tx) => sum + parseInt(tx.token_transfer.amount) / 1_000_000, 0);

  renderDashboard(wallet, allPayments, totalEarned, startTime, 0);

  // Poll every 10 seconds
  setInterval(async () => {
    const latest = await fetchLatestTxs(wallet.address, host);
    const newTxs = latest.filter(tx => !knownTxIds.has(tx.tx_id));

    if (newTxs.length > 0) {
      newTxs.forEach(tx => {
        knownTxIds.add(tx.tx_id);
        totalEarned += parseInt(tx.token_transfer.amount) / 1_000_000;
      });
      allPayments = [...newTxs, ...allPayments];

      // Play a bell sound on new payment
      process.stdout.write('\u0007');
    }

    renderDashboard(wallet, allPayments, totalEarned, startTime, newTxs.length);
  }, 10000);
}