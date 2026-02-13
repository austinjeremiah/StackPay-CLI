import chalk from 'chalk';
import https from 'https';
import { loadWallet } from '../utils/wallet';

interface Payment {
  tx_id: string;
  sender: string;
  amount: string;
  timestamp: string;
  memo: string;
}

async function fetchTransactions(address: string, network: string): Promise<Payment[]> {
  return new Promise((resolve) => {
    const host = network === 'mainnet' ? 'api.hiro.so' : 'api.testnet.hiro.so';
    https.get({
      hostname: host,
      path: `/extended/v1/address/${address}/transactions?limit=20`,
      headers: { Accept: 'application/json' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const payments: Payment[] = (json.results || [])
            .filter((tx: any) =>
              tx.tx_type === 'token_transfer' &&
              tx.token_transfer?.recipient_address === address
            )
            .map((tx: any) => ({
              tx_id: tx.tx_id,
              sender: tx.sender_address,
              amount: (parseInt(tx.token_transfer.amount) / 1_000_000).toFixed(6),
              timestamp: new Date(tx.burn_block_time_iso || tx.receipt_time_iso || Date.now()).toLocaleString(),
              memo: tx.token_transfer.memo
                ? Buffer.from(tx.token_transfer.memo.replace('0x', ''), 'hex').toString('utf8').replace(/\0/g, '').trim()
                : '',
            }));
          resolve(payments);
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

export async function historyCommand(options: { limit?: string }) {
  let wallet: any;
  try {
    wallet = loadWallet();
  } catch (err: any) {
    console.error(chalk.red(err.message));
    return;
  }

  console.log(chalk.gray(`\nFetching payments for ${wallet.address}...`));

  const payments = await fetchTransactions(wallet.address, wallet.network);

  if (payments.length === 0) {
    console.log(chalk.yellow('\n  No payments received yet.'));
    console.log(chalk.gray(`  Run: stackspay serve --cmd "echo hello" --price 0.001 --token STX\n`));
    return;
  }

  const limit = parseInt(options.limit || '10');
  const shown = payments.slice(0, limit);
  const totalSTX = shown.reduce((sum, p) => sum + parseFloat(p.amount), 0);

  console.log('');
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan(`  💰 Payment History — ${wallet.address.slice(0, 12)}...`));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  shown.forEach((p, i) => {
    const isX402 = p.memo.startsWith('x402:');
    console.log('');
    console.log(
      chalk.gray(`  #${i + 1}`),
      isX402 ? chalk.green.bold(`+${p.amount} STX`) : chalk.green(`+${p.amount} STX`),
      isX402 ? chalk.cyan('[x402]') : '',
    );
    console.log(chalk.gray(`      From : ${p.sender}`));
    console.log(chalk.gray(`      When : ${p.timestamp}`));
    if (p.memo) console.log(chalk.gray(`      Memo : ${p.memo}`));
    console.log(chalk.blue(`      TX   : https://explorer.hiro.so/txid/${p.tx_id}?chain=${wallet.network}`));
  });

  console.log('');
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.green(`  Total received: ${totalSTX.toFixed(6)} STX`), chalk.gray(`(last ${shown.length} payments)`));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');
}