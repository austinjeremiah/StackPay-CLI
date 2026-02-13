import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateKeypair, privateKeyToAccount } from 'x402-stacks';

const WALLET_DIR = path.join(os.homedir(), '.stackspay');
const WALLET_FILE = path.join(WALLET_DIR, 'wallet.json');
const BUYER_WALLET_FILE = path.join(WALLET_DIR, 'buyer-wallet.json');

export interface WalletData {
  address: string;
  privateKey: string;
  network: 'testnet' | 'mainnet';
  createdAt: string;
}

export function walletExists(filePath?: string): boolean {
  return fs.existsSync(filePath || WALLET_FILE);
}

export function saveWallet(wallet: WalletData, filePath?: string): void {
  if (!fs.existsSync(WALLET_DIR)) {
    fs.mkdirSync(WALLET_DIR, { recursive: true });
  }
  const target = filePath || WALLET_FILE;
  fs.writeFileSync(target, JSON.stringify(wallet, null, 2));
  fs.chmodSync(target, 0o600);
}

export function loadWallet(filePath?: string): WalletData {
  const target = filePath || WALLET_FILE;
  if (!fs.existsSync(target)) {
    throw new Error(`No wallet found at ${target}. Run: stackspay wallet create`);
  }
  return JSON.parse(fs.readFileSync(target, 'utf-8'));
}

export function createWallet(network: 'testnet' | 'mainnet' = 'testnet'): WalletData {
  const keypair = generateKeypair(network);
  return {
    address: keypair.address,
    privateKey: keypair.privateKey,
    network,
    createdAt: new Date().toISOString(),
  };
}

export function getAccount(wallet: WalletData) {
  return privateKeyToAccount(wallet.privateKey, wallet.network);
}

export { WALLET_FILE, BUYER_WALLET_FILE, WALLET_DIR };