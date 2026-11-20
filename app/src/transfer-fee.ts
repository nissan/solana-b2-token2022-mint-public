import assert from 'node:assert/strict';
import { getCreateAssociatedTokenIdempotentInstructionAsync, getTransferCheckedWithFeeInstruction } from '@solana-program/token-2022';
import { args, ata, balances, bigintJson, connect, fixture, run } from './devnet.js';

await run(async () => {
  const [mint, holderB] = args('pnpm transfer-fee <mint> <holder-B-owner>', 2);
  const ctx = await connect();
  const { payer } = ctx;
  assert.notEqual(holderB, payer.address, 'Holder B must be distinct from holder A.');
  const [source, destination] = await Promise.all([ata(mint, payer.address), ata(mint, holderB)]);
  const [before] = await balances(ctx, mint, [payer.address]);
  assert.deepEqual(before, { amount: fixture.amount, withheld: 0n });
  await ctx.send('transfer-fee', [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: holderB, mint }),
    getTransferCheckedWithFeeInstruction({ source, mint, destination, authority: payer,
      amount: fixture.amount, decimals: fixture.decimals, fee: fixture.fee }),
  ]);
  const [a, b] = await balances(ctx, mint, [payer.address, holderB]);
  assert.deepEqual(a, { amount: 0n, withheld: 0n });
  assert.deepEqual(b, { amount: fixture.amount - fixture.fee, withheld: fixture.fee });
  console.log('Holder A:', source, JSON.stringify(a, bigintJson));
  console.log('Holder B:', destination, JSON.stringify(b, bigintJson));
});
