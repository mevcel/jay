# Graduation

## V1
- Default threshold: **4.2 ETH** paired in the locked pool.
- Progress = paired principal in the locked position ÷ threshold (0 to 100%).
- Graduation is a status, not a migration: trading continues in the **same** pool afterwards.
- Progress is based on capital actually locked in the pool, not on holder wallet balances, so price pumps from thin trades do not move it by themselves.

## V2
- Two phases, both permissionless: `graduate` drains the curve into the factory; `createGraduatedPool` seeds the Uniswap V4 pool. Seeding is retryable so reserves can never be stranded.
- The graduated V4 position is locked **permanently**. There is no withdrawal path for anyone, including Pons.
