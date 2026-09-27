# Troubleshooting

- **Transaction failed right after a launch:** anti-snipe protection covers the first two blocks (only the creator's initial buy on the launch block, then 5.5% per-buy and 5% per-wallet caps). Retry after a few blocks.
- **"Insufficient funds" / cannot pay gas:** the wallet needs ETH on Robinhood Chain (chain id 4663), not on Ethereum mainnet.
- **Token not showing in wallet:** import it manually using the token contract address from the token page or explorer.
- **Swap reverted / slippage:** volatile tokens can move between quote and execution. Raise slippage modestly or reduce size. Never raise slippage on a token you do not trust.
- **Wrong network:** switch the wallet to Robinhood Chain (chain id 4663, RPC https://rpc.mainnet.chain.robinhood.com).
- **Pending transaction stuck:** check it on https://robinhoodchain.blockscout.com. If it never broadcast, the wallet can speed it up or cancel it with the same nonce.
- **Site not loading / wallet not connecting:** refresh, disconnect and reconnect the wallet, try another browser, and confirm the URL is exactly ponsfamily.com.
- **Graduation bar not moving:** V1 progress only counts ETH locked in the pool, not the price.
- **Claimable fees are zero:** see "Creator rewards and claiming".
