import assert from 'node:assert/strict';
import { flattenInstructionPlan, generateKeyPairSigner } from '@solana/kit';
import { extension, fetchMint, getCreateMintInstructionPlan, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { args, bigintJson, connect, finalized, fixture, getExtension, run } from './devnet.js';

await run(async () => {
  args('pnpm create-mint', 0);
  const { payer, rpc, send } = await connect();
  const newMint = await generateKeyPairSigner();
  const mint = newMint.address;
  const rate = { epoch: 0n, maximumFee: fixture.maxFee, transferFeeBasisPoints: fixture.basisPoints };
  const plan = await getCreateMintInstructionPlan({
    getMinimumBalance: space => rpc.getMinimumBalanceForRentExemption(BigInt(space), finalized).send(),
  }, {
    payer, newMint, decimals: fixture.decimals, mintAuthority: payer,
    extensions: [
      extension('TransferFeeConfig', {
        transferFeeConfigAuthority: payer.address, withdrawWithheldAuthority: payer.address,
        withheldAmount: 0n, olderTransferFee: rate, newerTransferFee: rate,
      }),
      extension('MetadataPointer', { authority: payer.address, metadataAddress: mint }),
      extension('TokenMetadata', {
        updateAuthority: payer.address, mint, name: fixture.name, symbol: fixture.symbol,
        uri: fixture.uri, additionalMetadata: new Map(),
      }),
    ],
  });
  console.log(`Mint: ${mint}`);
  await send('create-mint', flattenInstructionPlan(plan).map(leaf => {
    if (leaf.kind !== 'single') throw new Error('Expected a static mint instruction');
    return leaf.instruction;
  }));
  const account = await fetchMint(rpc, mint, finalized);
  assert.equal(account.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
  const { data } = account;
  assert.equal(data.supply, 0n);
  assert.equal(data.decimals, fixture.decimals);
  assert.deepEqual(data.mintAuthority, { __option: 'Some', value: payer.address });
  const { name, symbol, uri } = getExtension(data.extensions, 'TokenMetadata');
  const pointer = getExtension(data.extensions, 'MetadataPointer');
  const config = getExtension(data.extensions, 'TransferFeeConfig');
  assert.deepEqual(pointer.metadataAddress, { __option: 'Some', value: mint });
  assert.equal(config.transferFeeConfigAuthority, payer.address);
  assert.equal(config.withdrawWithheldAuthority, payer.address);
  const { transferFeeBasisPoints: basisPoints, maximumFee: maxFee } = config.newerTransferFee;
  const expected = { name, symbol, uri, basisPoints, maxFee };
  assert.deepEqual(expected, { name: fixture.name, symbol: fixture.symbol, uri: fixture.uri, basisPoints: fixture.basisPoints, maxFee: fixture.maxFee });
  console.log('Finalized mint readback:', JSON.stringify(expected, bigintJson));
});
