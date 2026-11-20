import assert from 'node:assert/strict';
import { getBase64EncodedWireTransaction } from '@solana/kit';
import {
  AuthorityType, fetchMint, getMintToCheckedInstruction, getSetAuthorityInstruction,
  TOKEN_2022_ERROR__FIXED_SUPPLY, TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { args, ata, balances, connect, finalized, getExtension, loadDevnetKeypair, run } from './devnet.js';

await run(async () => {
  const [mint, successor] = args('pnpm handover <mint> <new-fee-authority>', 2);
  const ctx = await connect();
  const { payer, rpc } = ctx;
  assert.notEqual(successor, payer.address, 'The new authority must differ from the creator.');
  assert.notEqual(successor, mint, 'The mint cannot be its own fee authority.');

  async function readMint() {
    const account = await fetchMint(rpc, mint, finalized);
    assert.equal(account.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
    const { data } = account;
    const fees = getExtension(data.extensions, 'TransferFeeConfig');
    return {
      data,
      authorities: {
        mint: data.mintAuthority.__option === 'Some' ? data.mintAuthority.value : null,
        feeConfig: fees.transferFeeConfigAuthority,
        withdrawWithheld: fees.withdrawWithheldAuthority,
      },
      feeSchedule: { older: fees.olderTransferFee, newer: fees.newerTransferFee },
    };
  }

  const before = await readMint();
  const desired = { mint: null, feeConfig: successor, withdrawWithheld: successor };
  const current = before.authorities;
  console.log(`Mint: ${mint}\nSupply: ${before.data.supply} base units`);
  if (current.mint === null && current.feeConfig === successor && current.withdrawWithheld === successor) {
    console.table(current);
    console.log('Already handed over. No transaction submitted.');
    return;
  }
  console.log('Before:');
  console.table(current);
  assert.deepEqual(current, { mint: payer.address, feeConfig: payer.address, withdrawWithheld: payer.address },
    'Refusing partial or foreign authority state. All three authorities must start on the creator.');
  const replacement = await loadDevnetKeypair('DEVNET_NEW_AUTHORITY_KEYPAIR');
  assert.equal(replacement.address, successor, 'The replacement keypair does not match the requested authority.');
  assert(before.data.supply > 0n, 'Mint the initial supply before revoking mint authority.');
  const [creatorBalance] = await balances(ctx, mint, [payer.address]);
  const destination = await ata(mint, payer.address);

  // All three updates commit together. Revocation is last and cannot be undone.
  await ctx.send('handover', [
    getSetAuthorityInstruction({ owned: mint, owner: payer, authorityType: AuthorityType.TransferFeeConfig, newAuthority: successor }),
    getSetAuthorityInstruction({ owned: mint, owner: payer, authorityType: AuthorityType.WithheldWithdraw, newAuthority: successor }),
    getSetAuthorityInstruction({ owned: mint, owner: payer, authorityType: AuthorityType.MintTokens, newAuthority: null }),
  ]);
  const after = await readMint();
  assert.deepEqual(after.authorities, desired);
  assert.equal(after.data.supply, before.data.supply);
  assert.deepEqual(after.feeSchedule, before.feeSchedule);
  assert.deepEqual(after.data.freezeAuthority, before.data.freezeAuthority);
  console.log('After:');
  console.table(after.authorities);

  const attempt = await ctx.sign([getMintToCheckedInstruction({
    mint, token: destination, mintAuthority: payer, amount: 1n, decimals: after.data.decimals,
  })]);
  const { value } = await rpc.simulateTransaction(getBase64EncodedWireTransaction(attempt), {
    encoding: 'base64', commitment: 'confirmed', sigVerify: true,
  }).send({ abortSignal: AbortSignal.timeout(15_000) });
  assert.deepEqual(value.err, { InstructionError: [0n, { Custom: BigInt(TOKEN_2022_ERROR__FIXED_SUPPLY) }] });
  assert.deepEqual(await readMint(), after);
  assert.deepEqual(await balances(ctx, mint, [payer.address]), [creatorBalance]);
  console.log('Signed mint attempt rejected in devnet simulation: FixedSupply (5). Supply and creator balance unchanged.');
});
