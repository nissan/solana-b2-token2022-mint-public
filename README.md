# The Solana Deeds #2 · Token-2022 transfer fees

A TypeScript devnet demo that creates a fee-bearing mint, sends tokens, and collects the fee. See the [article](https://www.reddi.tech/blog/solana-b2-token2022-mint) and [narrated demo](https://youtu.be/aoQO8YkuVZQ).

In the recorded run, a 1,000-token [transfer](https://solscan.io/tx/52Ut51DmdXcGbxQVoGbBGDtcxRXFeAWnFcmaxL6BL2sP4LkQFgvVJmqyMcZQGj9dg88KUMXrUKVq46Pj458EixUW?cluster=devnet) credited 975 spendable tokens and set 25 aside in the recipient's token account. A separate [withdrawal](https://solscan.io/tx/2sLpviTGGuX83gzdtbAMwDXxNnv212VMZwonGsrEBHMbjmmyKPmLEjDzNm4AEViNyeFTvEkpvMWtqBQF2oFL8PT6?cluster=devnet) credited those 25 to the treasury.

## Build and test

Install [mise](https://mise.jdx.dev/). Review `mise.toml`, then run from the repository root:

```sh
mise trust mise.toml
mise install
mise exec -- pnpm --dir app install --frozen-lockfile --strict-peer-dependencies
mise exec -- pnpm --dir app test
```

The test compiles the CLI and runs an offline smoke test. No wallet or RPC is needed for that test.

## Reproduce on devnet

Use a funded devnet-only keypair outside the checkout. Set `DEVNET_PAYER_KEYPAIR` to its path, and set `HOLDER_B` and `TREASURY` to distinct devnet wallet addresses other than the payer. Do not use mainnet keys. The scripts check the network genesis before loading the payer. They default to public devnet RPC; optionally provide your own `HELIUS_API_KEY` for Helius devnet.

```sh
mise exec -- pnpm --dir app create-mint
# Set MINT to the printed address.
mise exec -- pnpm --dir app mint-holder "$MINT"
mise exec -- pnpm --dir app transfer-fee "$MINT" "$HOLDER_B"
mise exec -- pnpm --dir app withdraw-fees "$MINT" "$HOLDER_B" "$TREASURY"
```

The fixture uses zero decimals, a 2.5% fee and a cap of 30 tokens. The withdrawal command checks that signed simulations reject an unauthorized withdrawal and fee change before submitting the authorized withdrawal. If a submission times out, inspect its printed transaction signature before retrying.

## Optional: hand over fee control and stop minting

Create and fund the initial token balance on a **separate fresh demo mint** with `create-mint` and `mint-holder`. Set `DEVNET_NEW_AUTHORITY_KEYPAIR` to a second devnet-only keypair outside the checkout and `NEW_AUTHORITY` to its public address. Use the same payer.

```sh
mise exec -- pnpm --dir app handover "$MINT" "$NEW_AUTHORITY"
```

This rotates both fee authorities and permanently revokes mint authority in one transaction. A repeat with the same target reports the state without submitting. Burns can still reduce supply, and the successor can still change the fee and collect withheld tokens. This fixture is not a production custody design.

MIT. See [LICENSE](LICENSE).
