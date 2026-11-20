import assert from 'node:assert/strict';
import { generateKeyPairSigner, getBase64EncodedWireTransaction, type Instruction } from '@solana/kit';
import {
  getCreateAssociatedTokenIdempotentInstructionAsync, getSetTransferFeeInstruction,
  getWithdrawWithheldTokensFromAccountsInstruction, TOKEN_2022_ERROR__OWNER_MISMATCH,
} from '@solana-program/token-2022';
import { args, ata, balances, bigintJson, connect, finalized, fixture, run } from './devnet.js';

await run(async () => {
  const [mint, holderB, treasuryOwner] = args('pnpm withdraw-fees <mint> <holder-B-owner> <treasury-owner>', 3);
  const ctx = await connect();
  const { payer, rpc } = ctx;
  assert.equal(new Set([payer.address, holderB, treasuryOwner]).size, 3, 'Owners A, B and treasury must be distinct.');
  const [a, b, treasury] = await Promise.all([ata(mint, payer.address), ata(mint, holderB), ata(mint, treasuryOwner)]);
  const [beforeB] = await balances(ctx, mint, [holderB]);
  assert.deepEqual(beforeB, { amount: fixture.amount - fixture.fee, withheld: fixture.fee });
  // Provision a real destination so the wrong authority, not a missing account, rejects the withdraw.
  await ctx.send('create-treasury', [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: treasuryOwner, mint })]);
  const snapshot = async () => (await rpc.getMultipleAccounts([mint, a, b, treasury], { ...finalized, encoding: 'base64' }).send()).value;
  const prior = await snapshot();
  assert(prior.every(account => account !== null), 'All fixture accounts must exist.');
  const stranger = await generateKeyPairSigner();
  const withdraw = (authority: typeof payer) => getWithdrawWithheldTokensFromAccountsInstruction({
    mint, feeReceiver: treasury, withdrawWithheldAuthority: authority, sources: [b], numTokenAccounts: 1,
  });
  async function rejectWrongAuthority(label: string, instruction: Instruction) {
    const signed = await ctx.sign([instruction]);
    const { value } = await rpc.simulateTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: 'base64', commitment: 'confirmed', sigVerify: true,
    }).send();
    // The RPC returns an instruction error, not a network or signature failure.
    assert.deepEqual(value.err, { InstructionError: [0n, { Custom: BigInt(TOKEN_2022_ERROR__OWNER_MISMATCH) }] });
    assert.deepEqual(await snapshot(), prior, `${label} changed fixture accounts`);
    console.log(`${label}: signed devnet simulation rejected with OwnerMismatch (4); mint and token accounts unchanged`);
  }
  await rejectWrongAuthority('wrong withdraw authority', withdraw(stranger));
  await rejectWrongAuthority('wrong fee authority', getSetTransferFeeInstruction({
    mint, transferFeeConfigAuthority: stranger, transferFeeBasisPoints: 500, maximumFee: 50n,
  }));
  await ctx.send('withdraw-fees', [withdraw(payer)]);
  const [afterB, afterTreasury] = await balances(ctx, mint, [holderB, treasuryOwner]);
  assert.deepEqual(afterB, { amount: beforeB.amount, withheld: 0n });
  assert.deepEqual(afterTreasury, { amount: fixture.fee, withheld: 0n });
  console.log('Holder B:', b, JSON.stringify(afterB, bigintJson));
  console.log('Treasury:', treasury, JSON.stringify(afterTreasury, bigintJson));
});
