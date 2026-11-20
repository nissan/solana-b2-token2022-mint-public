import assert from 'node:assert/strict';
import { fetchMint, getCreateAssociatedTokenIdempotentInstructionAsync, getMintToCheckedInstruction, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { args, ata, balances, bigintJson, connect, finalized, fixture, run } from './devnet.js';

await run(async () => {
  const [mint] = args('pnpm mint-holder <mint>', 1);
  const ctx = await connect();
  const { payer } = ctx;
  const account = await fetchMint(ctx.rpc, mint, finalized);
  assert.equal(account.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
  assert.equal(account.data.supply, 0n, 'Use a fresh demo mint.');
  const holder = await ata(mint, payer.address);
  await ctx.send('mint-holder', [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: payer.address, mint }),
    getMintToCheckedInstruction({ mint, token: holder, mintAuthority: payer, amount: fixture.amount, decimals: fixture.decimals }),
  ]);
  const [a] = await balances(ctx, mint, [payer.address]);
  assert.deepEqual(a, { amount: fixture.amount, withheld: 0n });
  console.log('Holder A:', holder, JSON.stringify(a, bigintJson));
});
