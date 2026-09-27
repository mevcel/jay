# Launching a token

## V1 launch (active factory)
1. Connect a wallet on ponsfamily.com and open the create flow.
2. Fill in name, ticker, logo, description and socials (stored on chain).
3. Confirm the single `launchToken` transaction. In that one transaction the factory:
   - deploys the token with CREATE2 (address is predictable before launch),
   - mints a fixed **1,000,000,000** supply,
   - opens a one-sided Uniswap V3 pool against WETH,
   - locks the liquidity position NFT in the Pons locker,
   - optionally runs a developer (creator) buy with any extra ETH sent.
4. Trading starts immediately against the WETH pool.

- Launch fee: **0.0005 ETH** (plus network gas).
- The token address is shown on the launch confirmation and on the explorer.

## Launch protection (anti-snipe)
- On the launch block, **only the creator** can buy.
- For the next **2 blocks**, buys are limited to **5.5% of supply** per transaction and **5% of supply** held per wallet.
- After that window, the token behaves like a normal ERC-20 with no limits.
- If a buy failed right after launch, it was very likely blocked by these limits. Wait a few blocks and try again.

## V2 launch (bonding curve)
- The full supply mints to a per-launch constant-product **bonding curve** that trades in the same quote asset its future pool will use (ETH or a chosen pair token).
- Anyone, including the creator, can buy from the curve immediately; price impact is the only limit.
- When the curve fills it **graduates** into a full-range Uniswap **V4** pool whose position is permanently locked.
