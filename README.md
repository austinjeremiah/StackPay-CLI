# Stackspay

<img width="931" height="207" alt="image" src="https://github.com/user-attachments/assets/31ce9bf2-7e58-4216-88ff-3e294e7a0e92" />



> Monetize any CLI script with x402-stacks in 30 seconds. Powered by Bitcoin.

stackspay is a terminal-native x402 payment toolkit for the Stacks blockchain. Any developer can wrap any script, command, binary, or upstream HTTP API behind an HTTP 402 paywall and start earning STX or sBTC — with zero frontend, zero database, and zero infrastructure. Revenue distribution, vault locking, BNS name resolution, multi-party splits, and a live dashboard are all built in.

Built for the [x402 Stacks Challenge](https://x402stacks.xyz) 

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands Reference](#commands-reference)
- [x402 Protocol Internals](#x402-protocol-internals)
- [Stacks Blockchain Architecture](#stacks-blockchain-architecture)
- [BNS Integration](#bns-integration)
- [Vault and Lock Mechanics](#vault-and-lock-mechanics)
- [Revenue Split Architecture](#revenue-split-architecture)
- [Proxy Mode](#proxy-mode)
- [sBTC Payments](#sbtc-payments)
- [x402-stacks Integration Map](#x402-stacks-integration-map)
- [File Architecture](#file-architecture)
- [Demos](#demos)
- [Real-World Use Cases](#real-world-use-cases)
- [Development Setup](#development-setup)
- [License](#license)

---

## The Problem

Every builder who wants to monetize a CLI tool, script, or backend service has to:

- Build a web frontend with wallet integration
- Set up a database (Supabase, Postgres, etc.)
- Write custom x402 verification logic from scratch
- Reinvent the entire payment stack every single time

stackspay eliminates all of that.

---

## The Solution

```bash
# 1. Install globally
npm install -g @austinjeremiah/stackspay

# 2. Create your wallet
stackspay wallet create

# 3. Fund it on testnet
stackspay wallet fund

# 4. Monetize ANY command in one line
stackspay serve --cmd "python3 summarize.py" --price 0.001 --token STX

# 5. Anyone pays and gets results instantly
stackspay pay http://your-server.com/run --file document.txt
```

Your script is now a Bitcoin-powered paid API with no frontend, no database, and no custom server code.

---

## Installation

```powershell
npm install -g @austinjeremiah/stackspay
stackspay --version
```

Verify the install worked after the registry propagates. If you see the version string, the binary is correctly linked on your PATH.

---

## Quick Start

```bash
# Create and fund a wallet
stackspay wallet create
stackspay wallet fund
stackspay wallet info

# Start a paid service (Terminal 1)
stackspay serve --cmd "echo Hello from Bitcoin!" --price 0.001 --token STX --port 3000

# Pay and call it (Terminal 2)
stackspay pay http://localhost:3000/run
```

---

## Commands Reference

### `stackspay wallet`

Manages your local Stacks keypair stored at `~/.stackspay/wallet.json`.

```bash
stackspay wallet create    # Generates a new secp256k1 keypair via generateKeypair()
stackspay wallet balance   # Queries the Stacks node RPC for STX and sBTC balances
stackspay wallet info      # Prints address, network (mainnet/testnet), and explorer link
stackspay wallet fund      # POSTs to the Stacks testnet faucet for STX drip
```

Wallet files are JSON-encoded and stored at `~/.stackspay/`. The private key is encoded as a compressed WIF hex string compatible with the Stacks secp256k1 curve. The corresponding Stacks address is a c32check-encoded address derived from the SHA256+RIPEMD160 hash of the compressed public key, prefixed with the network version byte (`0x1a` for mainnet, `0x15` for testnet).

---

### `stackspay serve`

Wraps any shell command or script behind an x402 paywall. Internally spins up an Express HTTP server with `paymentMiddleware` from `x402-stacks` guarding the `/run` endpoint.

```bash
stackspay serve \
  --cmd "python3 summarize.py" \       # Shell command executed on successful payment
  --price 0.001 \                       # Price denominated in STX (converted to microSTX internally)
  --token STX \                         # STX or SBTC
  --port 3000 \                         # Listening port (default: 3000)
  --description "PDF Summarizer"        # Human-readable label shown on GET /
```

**BNS receiver override:**

```bash
stackspay serve \
  --cmd "echo Hello from Bitcoin!" \
  --price 0.001 \
  --receiver muneeb.id \               # BNS name; resolved to c32 address on-chain
  --port 3000
```

**Auto-created endpoints:**

| Endpoint | Description |
|---|---|
| `GET /` | Service info: name, price, payTo address, network, token |
| `GET /health` | Server status, uptime, total payments, cumulative earnings |
| `POST /run` | x402-protected; runs `--cmd` on successful payment and returns stdout |

---

### `stackspay pay`

Calls any x402-compliant endpoint, handles the 402 challenge automatically, signs the STX transaction, and retries with the payment signature header.

```bash
stackspay pay http://localhost:3000/run
stackspay pay http://localhost:3000/run --data '{"text": "hello"}'
stackspay pay http://localhost:3000/run --file ./document.txt
stackspay pay http://api.example.com/premium --raw
```

Internally uses `wrapAxiosWithPayment` from `x402-stacks`, which intercepts the 402 response, constructs and signs a post-condition-enforced STX transfer, and appends the base64url-encoded payment object as the `X-PAYMENT` header on the retry.

---

### `stackspay proxy`

Proxies any upstream HTTP API behind an x402 paywall. Each inbound request that clears the payment layer is forwarded to `--target` and the upstream response is returned verbatim to the caller.

```bash
stackspay proxy \
  --target "https://httpbin.org/post" \   # Upstream URL to forward to
  --price 0.001 \                          # Price per proxied request
  --token STX \
  --port 4000
```

Useful for wrapping third-party APIs, internal microservices, or any HTTP endpoint that does not natively support x402.

---

### `stackspay vault`

Advanced serve mode with on-chain reserve locking, time-locked fund release, and percentage-based revenue splits paid to BNS names or Stacks addresses.

```bash
stackspay vault \
  --cmd "echo Revenue distributed!" \
  --price 0.003 \
  --token STX \
  --port 3000 \
  --split muneeb.id:30 \           # 30% of gross revenue routed to muneeb.id
  --reserve 10 \                   # 10% held in contract reserve
  --lock 1h                        # Reserve locked for 1 hour; unlockable after TTL
```

Split percentages and the reserve percentage must sum to 100 or less. The remaining percentage after splits and reserve accrues to the server wallet. Splits are executed as post-condition-enforced STX transfers on the same Stacks transaction that settles the payment, providing atomic revenue distribution.

---

### `stackspay split`

Multi-party revenue split without vault locking. Accepts both BNS names and raw c32 Stacks addresses as recipients.

```bash
stackspay split \
  --cmd "echo Collaboration paid!" \
  --price 0.002 \
  --token STX \
  --port 3000 \
  --split muneeb.id:50 \
  --split ST2NV73HYXQFRSAYEX59BDJPRRX63YBS0YPE32MVQ:50
```

The `--split` flag may be passed multiple times. Percentages must sum to exactly 100. Each split recipient receives their allocated microSTX atomically within the settlement transaction.

---

### `stackspay watch`

Opens a live terminal dashboard rendering:

- Active services and their current port bindings
- Real-time payment stream (TX ID, amount, sender address, timestamp)
- Per-service earnings totals
- Mempool confirmation status for pending transactions

```bash
stackspay watch
```

Polls `GET /health` on all locally running stackspay server processes and renders an auto-refreshing dashboard using `blessed` or `ink`.

---

### `stackspay request`

Spins up a browser-accessible payment request page at `http://localhost:<port>`. Renders a minimal HTML UI with the payment QR code, price, description, and wallet connect button for non-CLI users.

```bash
stackspay request \
  --price 0.05 \
  --token STX \
  --description "Pay for premium access" \
  --port 5000

# Open browser: http://localhost:5000
```

---

### `stackspay history`

Displays a paginated log of all transactions sent and received by the local wallet, fetched from the Stacks API transaction history endpoint. Includes TX ID, block height, confirmation count, amount, and counterparty address.

```bash
stackspay history
```

---

## x402 Protocol Internals

stackspay implements the full Coinbase x402 v2 protocol on Stacks. The flow below describes exactly what happens at the HTTP and blockchain layer for every paid request.

```
Buyer (stackspay pay)        stackspay serve              Stacks L1 / Facilitator
        |                           |                              |
        |---- POST /run ----------->|                              |
        |                           |                              |
        |<--- HTTP 402 -------------|                              |
        |     headers:              |                              |
        |       X-PAYMENT-REQUIRED  |                              |
        |       X-ACCEPTS-PAYMENT   |                              |
        |       CAIP-2 network ID   |                              |
        |       amount (microSTX)   |                              |
        |       payTo (c32 address) |                              |
        |       token contract ID   |                              |
        |                           |                              |
        | [wrapAxiosWithPayment]     |                              |
        | - Builds STX transfer tx  |                              |
        | - Attaches post-condition |                              |
        | - Signs with private key  |                              |
        | - Base64url-encodes obj   |                              |
        |                           |                              |
        |---- POST /run ----------->|                              |
        |     X-PAYMENT: <encoded>  |                              |
        |                           |---- settle tx -------------->|
        |                           |     via x402-stacks          |
        |                           |     facilitator endpoint     |
        |                           |<--- txid confirmed ----------|
        |                           |                              |
        |<--- HTTP 200 -------------|                              |
        |     stdout of --cmd       |                              |
```

### 402 Response Headers

The `paymentMiddleware` from `x402-stacks` emits the following headers on a 402:

| Header | Value |
|---|---|
| `X-PAYMENT-REQUIRED` | `true` |
| `X-ACCEPTS-PAYMENT` | `stacks-v2` |
| `X-PAYMENT-AMOUNT` | Amount in microSTX (1 STX = 1,000,000 microSTX) |
| `X-PAYMENT-PAYTO` | c32check-encoded Stacks address of the receiver |
| `X-PAYMENT-NETWORK` | CAIP-2 network ID (`stacks:1` mainnet, `stacks:2147483648` testnet) |
| `X-PAYMENT-TOKEN` | `STX` or sBTC Clarity contract principal |

### Payment Signature Header

On the retry, the buyer sends `X-PAYMENT` containing a base64url-encoded JSON object:

```json
{
  "scheme": "stacks-v2",
  "networkId": "stacks:2147483648",
  "payload": {
    "txHex": "0x0000000001...",
    "signature": "...",
    "publicKey": "03...",
    "nonce": 42,
    "fee": 1000,
    "postConditions": [...]
  }
}
```

The server's `paymentMiddleware` decodes this object, submits the serialized transaction hex to the Stacks node broadcast endpoint, and waits for mempool acceptance before proceeding. Finality is provided by the Stacks Bitcoin anchor block mechanism.

### Post-Conditions

Every payment transaction includes a `STX_TRANSFER_FUNGIBLE_CONDITION` post-condition asserting that exactly `price * 1,000,000 microSTX` leaves the sender's account. This is enforced by the Stacks VM at the consensus layer, making overpayment and underpayment impossible regardless of the server's behavior.

---

## Stacks Blockchain Architecture

Stacks is a Layer 1 blockchain that settles every block to Bitcoin via a cryptographic commitment written into a Bitcoin `OP_RETURN` output. This means:

- Every STX payment made through stackspay is anchored to Bitcoin within one Bitcoin block (~10 minutes for finality, mempool acceptance is immediate).
- The Stacks VM (Clarity) executes smart contracts with read-only access to Bitcoin state, enabling trustless BTC-conditional logic.
- Stacks uses a Proof-of-Transfer (PoX) consensus mechanism: Stacks miners commit BTC to participate in block production, and STX stackers receive BTC yield in return.

For stackspay, the relevant Stacks primitives are:

**Accounts:** Stacks addresses are c32check-encoded compressed secp256k1 public key hashes. c32check is a Stacks-specific base32 encoding with a version byte and checksum that prevents address confusion with Bitcoin addresses.

**Transactions:** Stacks transactions are serialized using a custom binary encoding (not RLP like Ethereum). A standard STX transfer serializes to approximately 200–250 bytes and costs ~0.001 STX in fees at typical fee market conditions.

**Nonces:** Each Stacks account has a monotonically increasing nonce. `wrapAxiosWithPayment` fetches the current nonce from the Stacks node before signing to prevent replay attacks.

**Microblock streams:** Between anchor blocks, Stacks miners produce microblocks that confirm transactions within seconds. stackspay's facilitator accepts mempool confirmation (effectively immediate) rather than waiting for anchor block finality, giving sub-second payment UX.

---

## BNS Integration

The Bitcoin Name System (BNS) is a decentralized naming protocol built into the Stacks blockchain as a Clarity smart contract (`SP000000000000000000002Q6VF78.bns`). BNS names are human-readable identifiers (e.g., `muneeb.id`) that resolve to Stacks addresses via an on-chain name registry.

stackspay uses BNS for `--receiver` in `serve` and for split recipients in `split` and `vault` commands. Resolution works as follows:

1. stackspay calls the BNS contract's `name-resolve` read-only function via the Stacks RPC endpoint.
2. The contract returns the owner's c32 Stacks address.
3. stackspay substitutes this address wherever a BNS name was specified.
4. The resolved address is included in the 402 `X-PAYMENT-PAYTO` header so the buyer's client sends payment directly to the correct beneficiary.

BNS resolution is cached in memory for the lifetime of the server process to avoid repeated RPC calls on each payment.

---

## Vault and Lock Mechanics

The `vault` command extends standard serve behavior with time-locked reserve accounting:

**Reserve holding:** A configurable percentage of each payment is tracked as "locked reserve" in the vault's local state file (`~/.stackspay/vault.json`). The actual STX lands in the server wallet immediately (Stacks has no native escrow without a Clarity contract), but vault tracks the reserve balance and prevents manual withdrawal commands until the lock TTL expires.

**Lock TTL:** The `--lock` flag accepts duration strings (`1h`, `30m`, `7d`). Until the TTL elapses, `stackspay wallet balance` will show the vault reserve as "locked" and prevent transfers of that portion.

**Revenue splits:** Split payments are executed as separate STX transfer transactions broadcast atomically within the settlement flow. Each split recipient gets a discrete transaction, confirmed in the same microblock round as the primary payment.

---

## Revenue Split Architecture

The `split` command supports mixed BNS and raw address recipients:

```
Gross payment (e.g., 0.002 STX = 2000 microSTX)
    |
    +-- muneeb.id (50%)    --> 1000 microSTX STX transfer tx to resolved c32 address
    |
    +-- ST2NV73... (50%)   --> 1000 microSTX STX transfer tx to raw c32 address
```

Both transfers are signed by the server wallet (which receives the gross payment first) and broadcast sequentially with incrementing nonces. The client receives their `200 OK` response only after both split transfers have been accepted into the mempool, providing a consistent view of successful multi-party distribution.

If a split transfer fails (e.g., fee estimation fails, node is unreachable), the error is logged to `~/.stackspay/split-errors.log` and the primary command output is still returned to the caller. The split failure does not block the buyer from receiving their result.

---

## Proxy Mode

`stackspay proxy` implements x402 at the HTTP middleware layer without running any local command:

```
stackspay proxy                       Upstream API
(x402 paywall at :4000)          (https://httpbin.org/post)
        |                                   |
        |<-- POST /proxy -------------------|
        |    [cleared by paymentMiddleware] |
        |                                   |
        |---- forward original request ---->|
        |<---- upstream response -----------|
        |                                   |
        |--> 200 + upstream body ---------->|
             to original caller
```

The proxy strips the `X-PAYMENT` and `X-PAYMENT-REQUIRED` headers before forwarding upstream and reattaches the upstream response body and status code verbatim. Any upstream headers in a configurable passlist are forwarded to the caller.

---

## sBTC Payments

sBTC is a 1:1 Bitcoin-backed fungible token on Stacks defined by the Clarity SIP-010 fungible token standard. sBTC is custodied by the decentralized sBTC signer network, which holds the corresponding BTC in a threshold-multisig Bitcoin script.

When `--token SBTC` is specified:

- The 402 response includes the sBTC Clarity contract principal (`SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`) in the `X-PAYMENT-TOKEN` header.
- `wrapAxiosWithPayment` constructs a `contract-call` transaction invoking the `transfer` function of the SIP-010 interface rather than a native STX transfer.
- Post-conditions assert that exactly the specified sats worth of sBTC (converted via `BTCtoSats`) debit the sender's sBTC balance.
- The facilitator verifies the SIP-010 transfer event in the transaction receipt rather than a native STX transfer event.

sBTC pricing uses `BTCtoSats` from `x402-stacks` to convert human-readable BTC amounts to the integer satoshi denomination stored in the sBTC contract's balance map.

---

## x402-stacks Integration Map

| x402-stacks Export | stackspay Usage |
|---|---|
| `paymentMiddleware` | Guards `POST /run` and `POST /proxy` in `serve` and `proxy` |
| `wrapAxiosWithPayment` | Intercepts 402 responses and auto-pays in the `pay` command |
| `privateKeyToAccount` | Reconstructs the Stacks account from the saved private key |
| `generateKeypair` | Called by `wallet create` to produce a fresh secp256k1 keypair |
| `STXtoMicroSTX` | Converts `--price` decimal STX values to microSTX integers |
| `BTCtoSats` | Converts `--price` decimal BTC values to satoshi integers for sBTC |
| `decodePaymentResponse` | Decodes the base64url payment object for TX ID display |
| CAIP-2 network IDs | `stacks:1` (mainnet) and `stacks:2147483648` (testnet) |
| x402 v2 headers | Full header spec compliance on both server and client |
| Facilitator pattern | Settlement via `https://x402-backend-7eby.onrender.com` |

---

## File Architecture

```
stackspay/
├── src/
│   ├── index.ts                 # CLI entry point (commander.js)
│   ├── commands/
│   │   ├── wallet.ts            # create, balance, info, fund
│   │   ├── serve.ts             # x402 command server
│   │   ├── pay.ts               # x402 payment client
│   │   ├── proxy.ts             # x402 reverse proxy
│   │   ├── vault.ts             # serve + reserve locking + splits
│   │   ├── split.ts             # multi-party revenue split
│   │   ├── watch.ts             # live terminal dashboard
│   │   ├── request.ts           # browser payment request page
│   │   └── history.ts           # wallet transaction history
│   └── utils/
│       ├── wallet.ts            # Keypair file management (~/.stackspay/)
│       ├── bns.ts               # BNS name resolution via Stacks RPC
│       ├── split.ts             # Split percentage parsing and execution
│       └── vault.ts             # Vault state file management
├── dist/                        # Compiled JavaScript output
├── package.json
└── tsconfig.json
```

Tech stack: TypeScript + Node.js, `x402-stacks` for the HTTP 402 protocol, `express` for the HTTP server, `commander` for CLI parsing, `axios` with x402 interceptor for the payment client, `chalk` and `ora` for terminal UX.

---

## Demos

### Demo 1 — Wallet Info

```powershell
stackspay wallet info
stackspay wallet balance
```

`wallet info` prints the c32check Stacks address, the CAIP-2 network ID, and a Stacks Explorer deep link for the account. `wallet balance` calls the Stacks node's `/v2/accounts/<address>` RPC endpoint and returns the STX balance in both microSTX and formatted STX, plus any sBTC SIP-010 token balance if the account has previously received sBTC.

---

### Demo 2 — Basic Serve + Pay

```powershell
# Terminal 1
stackspay serve --cmd "echo Hello from Bitcoin!" --price 0.001 --token STX --port 3000

# Terminal 2
stackspay pay http://localhost:3000/run
```

Terminal 1 starts an Express server with `paymentMiddleware` bound to `POST /run`. The middleware emits a `402` with CAIP-2 network ID `stacks:2147483648` (testnet), amount `1000 microSTX`, and the server wallet's c32 address in `X-PAYMENT-PAYTO`.

Terminal 2 calls `wrapAxiosWithPayment`, which intercepts the 402, builds and signs a 200-byte STX transfer transaction with a `STX_TRANSFER_FUNGIBLE_CONDITION` post-condition, base64url-encodes it, and retries the POST with the `X-PAYMENT` header. The server submits the transaction to the facilitator at `https://x402-backend-7eby.onrender.com`, waits for mempool acceptance, then executes `echo Hello from Bitcoin!` and returns the stdout in the response body.

---

### Demo 3 — BNS Serve

```powershell
# Terminal 1
stackspay serve --cmd "echo Hello from Bitcoin!" --price 0.001 --receiver muneeb.id --port 3000

# Terminal 2
stackspay pay http://localhost:3000/run
```

Before starting the Express server, stackspay calls the BNS contract's `name-resolve` read-only function on the Stacks RPC node to resolve `muneeb.id` to its owner c32 address. This resolved address is then passed as the `payTo` parameter to `paymentMiddleware`, so the 402 challenge instructs the buyer to pay directly to `muneeb.id`'s underlying Stacks address. No STX flows through the server wallet.

---

### Demo 4 — Proxy Any API

```powershell
# Terminal 1
stackspay proxy --target "https://httpbin.org/post" --price 0.001 --token STX --port 4000

# Terminal 2
stackspay pay http://localhost:4000/proxy
```

The proxy command wraps the upstream `https://httpbin.org/post` endpoint behind a 402 paywall. After `paymentMiddleware` clears the payment, the server forwards the original request body (including any `--data` or `--file` passed to `stackspay pay`) to `https://httpbin.org/post` using axios, and returns the upstream JSON response verbatim to the caller. The `X-PAYMENT` and `X-PAYMENT-REQUIRED` headers are stripped before forwarding to the upstream.

---

### Demo 5 — Vault with BNS Split

```powershell
# Terminal 1
stackspay vault --cmd "echo Revenue distributed!" --price 0.003 --token STX --port 3000 --split muneeb.id:30 --reserve 10 --lock 1h

# Terminal 2
stackspay pay http://localhost:3000/run
```

On each payment of 3000 microSTX:

- 900 microSTX (30%) is transferred to `muneeb.id`'s resolved c32 address as a discrete STX transfer transaction.
- 300 microSTX (10%) is recorded as locked reserve in `~/.stackspay/vault.json` with a 1-hour TTL.
- 1800 microSTX (60%) remains in the server wallet as net revenue.

The vault lock prevents the 300 microSTX reserve from being sent out via `stackspay wallet` commands until the 1-hour TTL has elapsed, simulating a holdback period for refunds or dispute resolution.

---

### Demo 6 — Split with BNS Names

```powershell
# Terminal 1
stackspay split --cmd "echo Collaboration paid!" --price 0.002 --token STX --port 3000 --split muneeb.id:50 --split ST2NV73HYXQFRSAYEX59BDJPRRX63YBS0YPE32MVQ:50

# Terminal 2
stackspay pay http://localhost:3000/run
```

On each payment of 2000 microSTX, two STX transfer transactions are broadcast with consecutive nonces:

- Nonce N: 1000 microSTX to `muneeb.id` (BNS-resolved to its owner c32 address)
- Nonce N+1: 1000 microSTX to `ST2NV73HYXQFRSAYEX59BDJPRRX63YBS0YPE32MVQ` (raw c32 address, used directly)

Both transactions carry `STX_TRANSFER_FUNGIBLE_CONDITION` post-conditions. The command output is returned to the buyer after both transactions are accepted into the Stacks mempool.

---

### Demo 7 — Watch Dashboard

```powershell
stackspay watch
```

Renders a terminal dashboard that polls all locally running stackspay server processes (detected via `~/.stackspay/servers.json`, written on `serve`/`vault`/`split`/`proxy` startup) and displays:

- Service name, port, price, and token type
- Live payment stream with TX ID, sender c32 address, amount, and relative timestamp
- Total payments received and cumulative earnings per service
- Mempool confirmation status fetched from the Stacks API

The dashboard auto-refreshes every 2 seconds.

---

### Demo 8 — Payment Request Page

```powershell
# Terminal 1
stackspay request --price 0.05 --token STX --description "Pay for premium access" --port 5000

# Open browser: http://localhost:5000
```

Serves a static HTML page with:

- A QR code encoding the Stacks address and payment amount in the Stacks URI scheme (`stacks:<address>?amount=<microSTX>`)
- The price, description, and server wallet address rendered as human-readable text
- A Hiro Wallet deep link button for one-click payment from a browser wallet extension
- A polling loop that checks `GET /health` every 3 seconds and displays a "Payment Received" confirmation once a matching transaction appears in the mempool

---

### Demo 9 — History

```powershell
stackspay history
```

Fetches the transaction history for the local wallet address from the Stacks API `GET /extended/v1/address/<address>/transactions` endpoint. Displays a paginated table of:

- TX ID (truncated, with full link to Stacks Explorer)
- Block height and confirmation count
- Transaction type (STX transfer, contract call for sBTC)
- Amount in STX or sBTC
- Counterparty c32 address

---

## Real-World Use Cases

### AI API Monetization

```bash
# Wrap an AI script — no API key, no subscription
stackspay serve --cmd "python3 gpt_summarize.py" --price 0.05 --token STX -d "GPT-4 Summarizer"

# Client pays per use
stackspay pay http://your-server/run --file bigdoc.txt
```

### Data Feed Pay-Per-Query

```bash
stackspay serve --cmd "python3 crypto_price.py" --price 0.001 --token STX -d "Live BTC Price"
```

### Developer Tool Monetization

```bash
# Any open-source tool becomes a paid service
stackspay serve --cmd "npx prettier --write" --price 0.002 --token STX -d "Code Formatter"
```

### sBTC (Bitcoin-Native) Payments

```bash
# Accept actual Bitcoin value via sBTC SIP-010 token
stackspay serve --cmd "node analyze.js" --price 0.00001 --token SBTC -d "BTC-Powered Analytics"
```

### Multi-Developer Revenue Share

```bash
# Distribute revenue among open-source contributors
stackspay split \
  --cmd "python3 model.py" \
  --price 0.01 --token STX \
  --split contributor1.id:40 \
  --split contributor2.id:40 \
  --split ST3FOUNDATION000000000:20
```

---

## Development Setup

```bash
git clone https://github.com/austinjeremiah/stackspay
cd stackspay
npm install
npm run build
node dist/index.js wallet create
node dist/index.js wallet fund
```

To run without installing globally:

```bash
node dist/index.js serve --cmd "echo test" --price 0.001 --token STX
```

---

## Why stackspay

| Challenge Goal | stackspay |
|---|---|
| Drive x402-stacks adoption | Any dev can adopt in 30 seconds with zero infrastructure |
| New monetization models | First pay-per-CLI-command model on Stacks |
| Functional MVPs | Fully working testnet demo across all 9 command types |
| Real-world needs | Devs need to monetize tools without building frontends |
| Lower barriers | No frontend, no database, no custom smart contract |
| Developer resources | Open-source SDK others can fork and extend |
| BNS integration | Human-readable payment addresses via Bitcoin Name System |
| Multi-party splits | Atomic revenue distribution in a single payment flow |
| sBTC support | Real Bitcoin-denominated payments via SIP-010 |


---

## License

MIT — Build freely, earn Bitcoin.

Built for the x402 Stacks Challenge · Powered by [x402-stacks](https://www.npmjs.com/package/x402-stacks)
