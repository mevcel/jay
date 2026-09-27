# Fees

## V1
- Pool fee: **1%** on every swap (Uniswap V3 fee tier 10000).
- Launch fee: **0.0005 ETH**.
- Fee split for tokens launched through the active factory: **70% creator / 30% protocol**.
- Tokens launched through the legacy factory keep the original **90% creator / 10% protocol** split.
- Protocol share use: **80%** funds automated TWAP buybacks, **20%** infrastructure and team.

## V2
- Fees are always charged on the **quote leg** (ETH or the pair token), never in the memecoin, from the very first trade.
- Split between protocol, creator, and a buyback vault. Optional creator tax (capped) goes entirely to the creator.
- Hard caps: curve fee ≤ 10%, creator tax ≤ 10%, total trade fee ≤ 20%.
- The fee policy is snapshotted per launch, so later policy changes never affect an existing token.
- Bought-back supply is not burned. It vests linearly over five years in the Pons buyback vault.
