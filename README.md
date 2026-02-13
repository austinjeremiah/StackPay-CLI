# stackspay ⚡

> **Monetize any CLI script with x402-stacks in 30 seconds. Powered by Bitcoin.**

stackspay is a terminal-native x402 payment toolkit for the Stacks blockchain. Any developer can wrap any script, command, or binary behind an HTTP 402 paywall and start earning STX or sBTC — with zero frontend, zero database, and zero infrastructure.

**Built for the [x402 Stacks Challenge](https://x402stacks.xyz) — Feb 9–16, 2026.**

---

## The Problem

Every builder who wants to monetize a CLI tool, script, or backend service has to:
- Build a web frontend with wallet integration
- Set up a database (Supabase, Postgres, etc.)
- Write custom x402 verification logic from scratch
- Reinvent the entire payment stack every single time

**stackspay eliminates all of that.**

---

## The Solution

```bash
# 1. Create your wallet
stackspay wallet create

# 2. Fund it (testnet)
stackspay wallet fund

# 3. Monetize ANY command in one line
stackspay serve --cmd "python3 summarize.py" --price 0.001 --token STX

# 4. Anyone pays and gets results instantly
stackspay pay http://your-server.com/run --file document.txt
```

**That's it. Your script is now a Bitcoin-powered paid API.**

---

## How It Works

stackspay uses the `x402-stacks` library to implement the full **Coinbase x402 v2 protocol** on Stacks:

```
Buyer                    stackspay serve              Stacks Blockchain
  │                           │                              │
  ├──── POST /run ────────────►│                              │
  │                           │◄── 402 Payment Required ─────│
  │◄── 402 + payment details ─┤    (amount, payTo, network)  │
  │                           │                              │
  ├──── POST /run ────────────►│                              │
  │    [payment-signature]    │                              │
  │                           ├──── settle tx ──────────────►│
  │                           │◄─── confirmed ───────────────┤
  │◄── 200 + command output ──┤                              │
```

**Payment flow:**
1. Client requests `/run` — server responds with `402 + CAIP-2 payment requirements`
2. `wrapAxiosWithPayment` intercepts, signs STX transaction automatically
3. Retries with `payment-signature` header
4. Server settles via x402-stacks facilitator on Stacks testnet/mainnet
5. Command executes, output returned to client

---

## Installation

```bash
# Install globally
npm install -g stackspay

# Or run directly
npx stackspay --help
```

---

## Commands

### `stackspay wallet`

```bash
stackspay wallet create             # Create new Stacks wallet (saved to ~/.stackspay/)
stackspay wallet balance            # Check STX balance
stackspay wallet info               # Show address, network, explorer link
stackspay wallet fund               # Request testnet STX from faucet
```

### `stackspay serve`

Wrap any command behind an x402 paywall:

```bash
stackspay serve \
  --cmd "python3 summarize.py" \   # Command to run when paid
  --price 0.001 \                  # Price in STX
  --token STX \                    # STX or SBTC
  --port 3000 \                    # Port (default: 3000)
  --description "PDF Summarizer"   # Service description

# Free endpoints auto-created:
# GET /         → service info, price, wallet address
# GET /health   → status + earnings stats
# POST /run     → x402-protected, runs your command
```

### `stackspay pay`

Call any x402 endpoint and auto-pay:

```bash
stackspay pay http://localhost:3000/run
stackspay pay http://localhost:3000/run --data '{"text": "hello"}'
stackspay pay http://localhost:3000/run --file ./document.txt
stackspay pay http://api.example.com/premium --raw
```

---

## Real-World Use Cases

### AI API Monetization
```bash
# Wrap an AI script
stackspay serve --cmd "python3 gpt_summarize.py" --price 0.05 --token STX -d "GPT-4 Summarizer"

# Client pays per use — no subscription, no API key
stackspay pay http://your-server/run --file bigdoc.txt
```

### Data Feed Pay-Per-Query
```bash
stackspay serve --cmd "python3 crypto_price.py" --price 0.001 --token STX -d "Live BTC Price"
```

### Developer Tool Monetization
```bash
# Any open source tool becomes a paid service
stackspay serve --cmd "npx prettier --write" --price 0.002 --token STX -d "Code Formatter"
```

### sBTC (Bitcoin) Payments
```bash
# Accept actual Bitcoin via sBTC
stackspay serve --cmd "node analyze.js" --price 0.00001 --token SBTC -d "BTC-Powered Analytics"
```

---

## x402-stacks Integration

stackspay is a **pure x402-stacks implementation**:

| x402-stacks Feature | stackspay Usage |
|---|---|
| `paymentMiddleware` | Protects `/run` endpoint |
| `wrapAxiosWithPayment` | Auto-payment in `pay` command |
| `privateKeyToAccount` | Wallet management |
| `generateKeypair` | `wallet create` |
| `STXtoMicroSTX` / `BTCtoSats` | Price conversion |
| `decodePaymentResponse` | TX confirmation display |
| CAIP-2 network IDs | `stacks:1` / `stacks:2147483648` |
| x402 v2 headers | Full spec compliance |
| Facilitator pattern | Via `https://x402-backend-7eby.onrender.com` |

---

## Architecture

```
stackspay/
├── src/
│   ├── index.ts              # CLI entry (commander.js)
│   ├── commands/
│   │   ├── wallet.ts         # create, balance, info, fund
│   │   ├── serve.ts          # x402 payment server
│   │   └── pay.ts            # x402 payment client
│   └── utils/
│       └── wallet.ts         # Wallet file management
```

**Tech stack:**
- TypeScript + Node.js
- `x402-stacks` — HTTP 402 protocol on Stacks
- `express` — HTTP server for `serve` command
- `commander` — CLI framework
- `axios` — HTTP client with x402 interceptor
- `chalk` + `ora` — Terminal UX

---

## Why stackspay Wins the x402 Stacks Challenge

| Challenge Goal | stackspay |
|---|---|
| Drive x402-stacks adoption | Any dev can adopt in 30 seconds |
| New monetization models | **First ever pay-per-CLI-command model** |
| Functional MVPs | Fully working testnet demo |
| Real-world needs | Devs need this to monetize tools NOW |
| Lower barriers | No frontend, no database, no infrastructure |
| Developer resources | Open-source SDK others can build on |

While other submissions build web apps, stackspay opens up an **entirely new surface area** — the terminal. Every developer already lives in the terminal. stackspay turns their existing tools into Bitcoin-powered paid services.

---

## Demo

### Terminal 1 — Start a paid service
```
$ stackspay serve --cmd "echo 'Hello from Bitcoin!'" --price 0.001 --token STX

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🚀 stackspay — x402 Service Live
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Command  : echo 'Hello from Bitcoin!'
  Price    : 0.001 STX
  Wallet   : ST2KVC3KD070X4WCY60032CCH3MZCX0GTXXMQ19NN
  Network  : testnet
  Endpoint : http://localhost:3000/run
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Waiting for payments...
```

### Terminal 2 — Pay and use the service
```
$ stackspay pay http://localhost:3000/run

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📡 Service Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Name    : stackspay service
  Price   : 0.001 STX
  Network : testnet
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✔ Payment successful!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ x402 Payment Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  From    : ST1ABC...
  TX      : 0xabc123...
  Network : stacks:2147483648
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📦 Response:

Hello from Bitcoin!
```

---

## Setup for Development

```bash
git clone https://github.com/yourusername/stackspay
cd stackspay
npm install
npm run build
node dist/index.js wallet create
node dist/index.js wallet fund
```

---

## License

MIT — Build freely, earn Bitcoin.

---

*Built with ❤️ for the x402 Stacks Challenge · Powered by [x402-stacks](https://www.npmjs.com/package/x402-stacks)*
