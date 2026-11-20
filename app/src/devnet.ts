import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes,
  createSolanaRpc, createTransactionMessage, getBase64EncodedWireTransaction,
  getSignatureFromTransaction, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  type Address, type Instruction, type Option, type Rpc, type SolanaRpcApi,
} from '@solana/kit';
import {
  fetchAllToken, findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS, type Extension,
} from '@solana-program/token-2022';

export const fixture = {
  name: 'Solana Deed Two Demo', symbol: 'DEED2',
  uri: 'data:application/json,%7B%22name%22%3A%22Solana%20Deed%20Two%20Demo%22%2C%22symbol%22%3A%22DEED2%22%7D',
  decimals: 0, basisPoints: 250, maxFee: 30n, amount: 1_000n, fee: 25n,
} as const;
export const finalized = { commitment: 'finalized' } as const;
const devnetGenesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export async function connect() {
  const key = process.env.HELIUS_API_KEY;
  const rpc = createSolanaRpc(key
    ? `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`
    : 'https://api.devnet.solana.com');
  assert.equal(await rpc.getGenesisHash().send({ abortSignal: AbortSignal.timeout(15_000) }), devnetGenesis,
    'Refusing to sign: RPC is not Solana devnet.');
  const payer = await loadDevnetKeypair('DEVNET_PAYER_KEYPAIR');

  async function sign(instructions: readonly Instruction[]) {
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    return signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 'legacy' }),
      message => setTransactionMessageFeePayerSigner(payer, message),
      message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      message => appendTransactionMessageInstructions(instructions, message),
    ));
  }

  async function send(step: string, instructions: readonly Instruction[]) {
    const tx = await sign(instructions);
    const signature = getSignatureFromTransaction(tx);
    // Print before submission so an interrupted send can be reconciled without retrying it.
    console.log(`${step} signature: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    assert.equal(await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), {
      encoding: 'base64', preflightCommitment: 'confirmed',
    }).send({ abortSignal: AbortSignal.timeout(15_000) }), signature);
    const signal = AbortSignal.timeout(90_000);
    for (;;) {
      const { value: [status] } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send({ abortSignal: signal });
      if (status) {
        assert.equal(status.err, null, `${step} failed: ${JSON.stringify(status.err, bigintJson)}`);
        if (status.confirmationStatus === 'finalized') break;
      }
      await delay(2_000, undefined, { signal });
    }
    console.log(`${step}: finalized`);
  }
  return { payer, rpc, sign, send };
}

export async function loadDevnetKeypair(variable: 'DEVNET_PAYER_KEYPAIR' | 'DEVNET_NEW_AUTHORITY_KEYPAIR') {
  const path = process.env[variable];
  assert(path, `Set ${variable} to a dedicated devnet-only keypair file.`);
  try {
    const bytes: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (Array.isArray(bytes) && bytes.length === 64 && bytes.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
    }
  } catch {
    // Parse and import errors may contain input bytes.
  }
  throw new Error(`Could not load ${variable} as a 64-byte Solana keypair.`);
}

export const bigintJson = (_key: string, value: unknown) => typeof value === 'bigint' ? value.toString() : value;

export function args(usage: string, count: number) {
  const values = process.argv.slice(2);
  assert.equal(values.length, count, `Usage: ${usage}`);
  return values.map(value => address(value));
}

export async function ata(mint: Address, owner: Address) {
  const [account] = await findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return account;
}

export function getExtension<K extends Extension['__kind']>(extensions: Option<Extension[]>, kind: K) {
  const item = extensions.__option === 'Some' && extensions.value.find(
    (entry): entry is Extract<Extension, { __kind: K }> => entry.__kind === kind,
  );
  assert(item, `Missing ${kind} extension`);
  return item;
}

export async function balances({ rpc }: { rpc: Rpc<SolanaRpcApi> }, mint: Address, owners: Address[]) {
  const accounts = await Promise.all(owners.map(owner => ata(mint, owner)));
  const tokens = await fetchAllToken(rpc, accounts, finalized);
  return tokens.map((token, i) => {
    assert.equal(token.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
    assert.equal(token.data.mint, mint);
    assert.equal(token.data.owner, owners[i]);
    return { amount: token.data.amount, withheld: getExtension(token.data.extensions, 'TransferFeeAmount').withheldAmount };
  });
}

export async function run(main: () => Promise<void>) {
  try {
    await main();
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    const key = process.env.HELIUS_API_KEY;
    if (key) message = message.replaceAll(key, '[redacted]').replaceAll(encodeURIComponent(key), '[redacted]');
    console.error(message);
    process.exitCode = 1;
  }
}
