#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { walletCreate, walletBalance, walletInfo, walletFund, walletCreateBuyer } from './commands/wallet';
import { serveCommand } from './commands/serve';
import { historyCommand } from './commands/history';
import { proxyCommand } from './commands/proxy';
import { payCommand } from './commands/pay';
import { watchCommand } from './commands/watch';
import { requestCommand } from './commands/request';
import { splitCommand } from './commands/split';
import { vaultCommand } from './commands/vault';

const program = new Command();

const orange = chalk.hex('#FF8C00');
const BANNER = `
${orange.bold('  ███████╗████████╗ █████╗  ██████╗██╗  ██╗███████╗██████╗  █████╗ ██╗   ██╗')}
${orange.bold('  ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗██╔══██╗╚██╗ ██╔╝')}
${orange.bold('  ███████╗   ██║   ███████║██║     █████╔╝ ███████╗██████╔╝███████║ ╚████╔╝ ')}
${orange.bold('  ╚════██║   ██║   ██╔══██║██║     ██╔═██╗ ╚════██║██╔═══╝ ██╔══██║  ╚██╔╝  ')}
${orange.bold('  ███████║   ██║   ██║  ██║╚██████╗██║  ██╗███████║██║     ██║  ██║   ██║   ')}
${orange.bold('  ╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ')}
`;

program
  .name('stackspay')
  .description(`${chalk.bold('stackspay')} — ${chalk.cyan('Monetize any CLI script with x402-stacks')}`)
  .version('1.0.0')
  .addHelpText('beforeAll', BANNER);

// ─── wallet command group ────────────────────────────────────────────────────
const wallet = program
  .command('wallet')
  .description('Manage your Stacks wallet');

wallet
  .command('create')
  .description('Create a new Stacks wallet')
  .option('-n, --network <network>', 'Network (testnet|mainnet)', 'testnet')
  .option('-f, --force', 'Overwrite existing wallet')
  .action((opts) => walletCreate(opts));

wallet
  .command('balance')
  .description('Check your STX balance')
  .action(() => walletBalance());

wallet
  .command('info')
  .description('Show wallet details and explorer link')
  .action(() => walletInfo());

wallet
  .command('fund')
  .description('Request testnet STX from faucet')
  .action(() => walletFund());
wallet
  .command('create-buyer')
  .description('Create a separate buyer wallet for paying services')
  .option('-f, --force', 'Overwrite existing buyer wallet')
  .action((opts) => walletCreateBuyer(opts));

// ─── serve command ────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Wrap any command behind an x402 paywall')
  .requiredOption('-c, --cmd <command>', 'Command to execute when paid')
  .requiredOption('-p, --price <amount>', 'Price per call (e.g. 0.001)')
  .option('-t, --token <token>', 'Token type: STX or SBTC', 'STX')
  .option('--port <port>', 'Port to listen on', '3000')
  .option('-d, --description <text>', 'Service description')
  .action((opts) => serveCommand(opts))
  .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('$ stackspay serve --cmd "python3 summarize.py" --price 0.001 --token STX')}
  ${chalk.cyan('$ stackspay serve --cmd "node analyze.js" --price 0.005 --token STX --port 4000')}
  ${chalk.cyan('$ stackspay serve --cmd "bash process.sh" --price 0.0001 --token SBTC')}
`);

// ─── pay command ──────────────────────────────────────────────────────────────
program
  .command('history')
  .description('Show payment history received by your wallet')
  .option('-l, --limit <n>', 'Number of payments to show', '10')
  .action((opts) => historyCommand(opts));

program
  .command('vault')
  .description('Programmable payment vault — split, lock, and reserve earnings automatically')
  .requiredOption('--cmd <command>', 'Command to execute on payment')
  .requiredOption('--price <amount>', 'Price per call in STX')
  .option('--token <token>', 'Token to accept (STX)', 'STX')
  .option('--port <port>', 'Port to listen on', '3000')
  .option('--split <address:pct>', 'Split % to address (ADDRESS:PERCENTAGE)', (v, acc: string[]) => [...acc, v], [])
  .option('--lock <duration>', 'Lock % of earnings for duration (e.g. 7d, 24h, 30m)')
  .option('--reserve <percentage>', 'Reserve % of earnings in wallet')
  .option('--description <desc>', 'Service description')
  .action((opts) => vaultCommand(opts));

program
  .command('proxy')
  .description('Put any HTTP API behind an x402 paywall')
  .requiredOption('--target <url>', 'Target API URL to proxy')
  .option('--price <amount>', 'Price per request in STX', '0.01')
  .option('--token <token>', 'Token to accept (STX)', 'STX')
  .option('--port <port>', 'Local port to listen on', '4000')
  .option('--path <path>', 'Proxy endpoint path', '/proxy')
  .option('--description <desc>', 'Service description')
  .action((opts) => proxyCommand(opts));

program
  .command('watch')
  .description('Live dashboard — monitor incoming payments in real-time')
  .action(() => watchCommand());

program
  .command('request')
  .description('Generate a payment request page with QR code')
  .option('--price <amount>', 'Amount to request in STX', '0.01')
  .option('--token <token>', 'Token (STX)', 'STX')
  .option('--port <port>', 'Port for payment page', '5000')
  .option('--description <desc>', 'Payment description')
  .option('--save <file>', 'Save payment page as HTML file')
  .action((opts) => requestCommand(opts));

program
  .command('split')
  .description('Serve a command with automatic revenue splitting')
  .requiredOption('--cmd <command>', 'Command to execute')
  .requiredOption('--price <amount>', 'Total price in STX')
  .option('--token <token>', 'Token (STX)', 'STX')
  .option('--port <port>', 'Port to listen on', '3000')
  .option('--split <address:pct>', 'Split recipient (ADDRESS:PERCENTAGE)', (val, acc: string[]) => [...acc, val], [])
  .option('--description <desc>', 'Service description')
  .action((opts) => splitCommand(opts));
  
program
  .command('pay')
  .description('Call an x402 endpoint and auto-pay with STX')
  .argument('<url>', 'x402 endpoint URL (e.g. http://localhost:3000/run)')
  .option('-d, --data <json>', 'JSON data to send as request body')
  .option('-f, --file <path>', 'Send file contents as request body')
  .option('-r, --raw', 'Print raw response without formatting')
  .action((url, opts) => payCommand(url, opts))
  .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('$ stackspay pay http://localhost:3000/run')}
  ${chalk.cyan('$ stackspay pay http://localhost:3000/run --data \'{"text": "hello world"}\'')}
  ${chalk.cyan('$ stackspay pay http://localhost:3000/run --file ./document.txt')}
  ${chalk.cyan('$ stackspay pay http://api.example.com/premium --raw')}
`);

// ─── fallback ─────────────────────────────────────────────────────────────────
program.on('command:*', () => {
  console.error(chalk.red(`\nUnknown command: ${program.args.join(' ')}`));
  console.log(chalk.gray('Run stackspay --help to see available commands'));
  process.exit(1);
});

program.parse(process.argv);

if (process.argv.length < 3) {
  console.log(BANNER);
  console.log(chalk.bold('  Terminal-native x402 payments on Stacks'));
  console.log(chalk.gray('  Monetize any script in 30 seconds. Powered by Bitcoin.\n'));
  console.log(chalk.bold('  Quick start:'));
  console.log(chalk.cyan('    stackspay wallet create'));
  console.log(chalk.cyan('    stackspay wallet fund'));
  console.log(chalk.cyan('    stackspay serve --cmd "echo hello" --price 0.001'));
  console.log(chalk.cyan('    stackspay pay http://localhost:3000/run'));
  console.log('');
  program.outputHelp();
}
