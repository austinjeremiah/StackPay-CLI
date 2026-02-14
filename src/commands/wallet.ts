import chalk from 'chalk';
import ora from 'ora';
import https from 'https';
import fs from 'fs';
import { createWallet, saveWallet, loadWallet, walletExists, BUYER_WALLET_FILE } from '../utils/wallet';
import { lookupBNS } from '../utils/bns';

export async function walletCreate(options: { network?: string; force?: boolean }) {
  const network = (options.network as 'testnet' | 'mainnet') || 'testnet';
  if (walletExists() && !options.force) {
    const existing = loadWallet();
    console.log(chalk.yellow('⚠️  Wallet already exists!'));
    console.log(chalk.gray(`   Address: ${existing.address}`));
    console.log(chalk.gray('   Use --force to overwrite'));
    return;
  }
  const spinner = ora('Creating Stacks wallet...').start();
  try {
    const wallet = createWallet(network);
    saveWallet(wallet);
    spinner.succeed(chalk.green('Wallet created!'));
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  ✅ stackspay Wallet'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Address  :'), chalk.white(wallet.address));
    console.log(chalk.cyan('  Network  :'), chalk.white(wallet.network));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    if (network === 'testnet') {
      console.log(chalk.yellow('\n💡 Fund your wallet:'));
      console.log(chalk.gray('   https://explorer.hiro.so/sandbox/faucet?chain=testnet'));
    }
    console.log(chalk.red.bold('\n⚠️  Back up ~/.stackspay/wallet.json securely!'));
  } catch (err: any) {
    spinner.fail('Failed');
    console.error(chalk.red(err.message));
  }
}

export async function walletCreateBuyer(options: { force?: boolean }) {
  if (fs.existsSync(BUYER_WALLET_FILE) && !options.force) {
    const existing = loadWallet(BUYER_WALLET_FILE);
    console.log(chalk.yellow('⚠️  Buyer wallet already exists!'));
    console.log(chalk.gray(`   Address: ${existing.address}`));
    console.log(chalk.gray('   Use --force to overwrite'));
    return;
  }
  const spinner = ora('Creating buyer wallet...').start();
  const wallet = createWallet('testnet');
  saveWallet(wallet, BUYER_WALLET_FILE);
  spinner.succeed(chalk.green('Buyer wallet created!'));
  console.log('');
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.green('  ✅ Buyer Wallet'));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('  Address  :'), chalk.white(wallet.address));
  console.log(chalk.cyan('  Saved at :'), chalk.gray('~/.stackspay/buyer-wallet.json'));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.yellow('\n💡 Fund this wallet:'));
  console.log(chalk.gray('   https://explorer.hiro.so/sandbox/faucet?chain=testnet'));
  console.log(chalk.gray(`   Address: ${wallet.address}`));
}

export async function walletBalance() {
  let wallet: any;
  try { wallet = loadWallet(); } catch (err: any) { console.error(chalk.red(err.message)); return; }
  const spinner = ora('Fetching balance...').start();
  try {
    const [balance, bnsName] = await Promise.all([
      fetchBalance(wallet.address, wallet.network),
      lookupBNS(wallet.address),
    ]);
    spinner.succeed('Balance fetched!');
    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.cyan('  💰 Wallet Balance'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Address :'), chalk.white(wallet.address));
    if (bnsName) console.log(chalk.cyan('  BNS     :'), chalk.green.bold(`⚡ ${bnsName}`));
    console.log(chalk.cyan('  Network :'), chalk.white(wallet.network));
    console.log(chalk.cyan('  STX     :'), chalk.green.bold(`${balance.stx} STX`));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  } catch (err: any) {
    spinner.fail('Failed');
    console.error(chalk.red(err.message));
  }
}

export async function walletInfo() {
  let wallet: any;
  try { wallet = loadWallet(); } catch (err: any) { console.error(chalk.red(err.message)); return; }
  const spinner = ora('Looking up BNS name...').start();
  const bnsName = await lookupBNS(wallet.address);
  spinner.stop();
  console.log('');
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  🔑 Wallet Info'));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('  Address  :'), chalk.white(wallet.address));
  if (bnsName) {
    console.log(chalk.cyan('  BNS Name :'), chalk.green.bold(`⚡ ${bnsName}`));
  } else {
    console.log(chalk.cyan('  BNS Name :'), chalk.gray('none — register at btc.us'));
  }
  console.log(chalk.cyan('  Network  :'), chalk.white(wallet.network));
  console.log(chalk.cyan('  Created  :'), chalk.gray(new Date(wallet.createdAt).toLocaleString()));
  console.log(chalk.cyan('  Explorer :'), chalk.blue(`https://explorer.hiro.so/address/${wallet.address}?chain=${wallet.network}`));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
}

export async function walletFund() {
  let wallet: any;
  try { wallet = loadWallet(); } catch (err: any) { console.error(chalk.red(err.message)); return; }
  if (wallet.network !== 'testnet') {
    console.log(chalk.red('❌ Faucet only available on testnet'));
    return;
  }
  const spinner = ora('Requesting testnet STX...').start();
  try {
    const result = await requestFaucet(wallet.address);
    spinner.succeed(chalk.green('Faucet request sent!'));
    console.log(chalk.gray(`   TX: https://explorer.hiro.so/txid/${result.txid}?chain=testnet`));
  } catch {
    spinner.stop();
    console.log(chalk.yellow('\n💡 Request manually:'));
    console.log(chalk.gray('   https://explorer.hiro.so/sandbox/faucet?chain=testnet'));
    console.log(chalk.gray(`   Address: ${wallet.address}`));
  }
}

async function fetchBalance(address: string, network: string): Promise<{ stx: string }> {
  return new Promise((resolve, reject) => {
    const host = network === 'mainnet' ? 'api.hiro.so' : 'api.testnet.hiro.so';
    https.get({
      hostname: host,
      path: `/v2/accounts/${address}`,
      headers: { Accept: 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ stx: (parseInt(json.balance, 16) / 1_000_000).toFixed(6) });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function requestFaucet(address: string): Promise<{ txid: string }> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ address });
    const req = https.request({
      hostname: 'api.testnet.hiro.so',
      path: '/extended/v1/faucets/stx',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.txId || json.txid) resolve({ txid: json.txId || json.txid });
          else reject(new Error(json.error || 'Faucet failed'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}