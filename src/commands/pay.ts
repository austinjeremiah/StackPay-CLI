import axios from 'axios';
import chalk from 'chalk';
import ora from 'ora';
import { wrapAxiosWithPayment, decodePaymentResponse } from 'x402-stacks';
import { loadWallet, getAccount, BUYER_WALLET_FILE, WALLET_FILE } from '../utils/wallet';
import fs from 'fs';

export async function payCommand(
  url: string,
  options: {
    data?: string;
    file?: string;
    raw?: boolean;
    wallet?: string;
  }
) {
  // Priority: --wallet flag > buyer-wallet.json > wallet.json
  let walletFile = options.wallet || BUYER_WALLET_FILE;
  if (!fs.existsSync(walletFile)) walletFile = WALLET_FILE;

  let wallet: any;
  try {
    wallet = loadWallet(walletFile);
  } catch (err: any) {
    console.error(chalk.red(err.message));
    console.log(chalk.yellow('\nCreate a buyer wallet: stackspay wallet create-buyer'));
    return;
  }

  // Warn if buyer and seller are the same wallet
  if (fs.existsSync(WALLET_FILE)) {
    const seller = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
    if (seller.address === wallet.address) {
      console.log(chalk.red.bold('\n❌ Buyer and seller are the SAME wallet!'));
      console.log(chalk.yellow('   Stacks will reject self-payments.'));
      console.log(chalk.yellow('   Fix: stackspay wallet create-buyer'));
      console.log(chalk.yellow('   Then fund the buyer wallet from the faucet\n'));
      return;
    }
  }

  console.log(chalk.gray(`  Buyer wallet: ${wallet.address}`));

  let inputData: any = undefined;
  if (options.file) {
    try {
      inputData = fs.readFileSync(options.file, 'utf-8');
      console.log(chalk.gray(`  File: ${options.file}`));
    } catch {
      console.error(chalk.red(`Cannot read file: ${options.file}`));
      return;
    }
  } else if (options.data) {
    try { inputData = JSON.parse(options.data); }
    catch { inputData = options.data; }
  }

  const spinner = ora(`Connecting to ${url}...`).start();

  try {
    // Get service info (free endpoint)
    const baseUrl = url.replace('/run', '');
    let serviceInfo: any = null;
    try {
      const infoRes = await axios.get(baseUrl, { timeout: 5000 });
      serviceInfo = infoRes.data;
    } catch { /* ignore */ }

    const account = getAccount(wallet);
    const api = wrapAxiosWithPayment(axios.create({ timeout: 60000 }), account);

    if (serviceInfo) {
      spinner.stop();
      console.log('');
      console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.bold.cyan('  📡 Service Details'));
      console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.cyan('  Name    :'), chalk.white(serviceInfo.name || 'x402 service'));
      console.log(chalk.cyan('  Price   :'), chalk.green.bold(serviceInfo.price || 'unknown'));
      console.log(chalk.cyan('  Network :'), chalk.white(serviceInfo.network || wallet.network));
      console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      spinner.start('Processing x402 payment...');
    }

    const startTime = Date.now();
    const response = await api.post(url, inputData || {}, {
      headers: { 'Content-Type': 'application/json' },
    });
    const elapsed = Date.now() - startTime;

    const paymentInfo = decodePaymentResponse(response.headers['payment-response']);
    spinner.succeed(chalk.green('Payment successful!'));

    console.log('');
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.green('  ✅ x402 Payment Complete'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  From    :'), chalk.white(wallet.address));
    if (paymentInfo) {
      console.log(chalk.cyan('  TX      :'), chalk.blue(paymentInfo.transaction));
      console.log(chalk.cyan('  Network :'), chalk.white(paymentInfo.network));
    }
    console.log(chalk.cyan('  Time    :'), chalk.gray(`${elapsed}ms`));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    const responseData = response.data;
    console.log('');
    console.log(chalk.bold.yellow('  📦 Response:'));
    console.log('');

    if (options.raw) {
      console.log(typeof responseData === 'string' ? responseData : JSON.stringify(responseData, null, 2));
    } else if (responseData?.output) {
      console.log(chalk.white(responseData.output));
    } else {
      console.log(chalk.white(JSON.stringify(responseData, null, 2)));
    }
    console.log('');

    if (paymentInfo?.transaction && paymentInfo.transaction !== 'mempool') {
      console.log(chalk.gray(`🔍 View TX: https://explorer.hiro.so/txid/${paymentInfo.transaction}?chain=${wallet.network}`));
    }

  } catch (err: any) {
    spinner.fail(chalk.red('Payment failed'));
    if (err.code === 'ECONNREFUSED') {
      console.log(chalk.red(`\n❌ Cannot connect to ${url}`));
    } else {
      console.error(chalk.red(`\n${err.message}`));
      if (err.response?.data) console.log(chalk.gray(JSON.stringify(err.response.data, null, 2)));
    }
  }
}