import assert from 'node:assert/strict';
import { test } from 'node:test';
import { address } from '@solana/kit';
import {
  getInitializeMint2Instruction,
  parseInitializeMint2Instruction,
} from '@solana-program/token-2022';

test('the SDK builds and parses a Token-2022 mint instruction offline', () => {
  // Public fixture addresses; no wallets, keys, RPC calls or submission.
  const mint = address('So11111111111111111111111111111111111111112');
  const mintAuthority = address('11111111111111111111111111111111');
  const instruction = getInitializeMint2Instruction({ mint, mintAuthority, decimals: 6 });

  assert.equal(instruction.programAddress, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  const parsed = parseInitializeMint2Instruction(instruction);
  assert.equal(parsed.accounts.mint.address, mint);
  assert.equal(parsed.data.mintAuthority, mintAuthority);
  assert.equal(parsed.data.decimals, 6);
});
