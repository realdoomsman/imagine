/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/imagine.json`.
 */
export type Imagine = {
  "address": "imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa",
  "metadata": {
    "name": "imagine",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "IMAGINE: time-weighted lock-to-earn vaults for Raydium LaunchLab coins, paid in each coin's pair asset"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "pendingAdmin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "ownerQuoteAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimCreator",
      "discriminator": [
        231,
        240,
        197,
        249,
        244,
        10,
        21,
        59
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "creatorQuoteAccount",
          "docs": [
            "WSOL."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimTreasury",
      "discriminator": [
        78,
        107,
        230,
        224,
        191,
        237,
        4,
        163
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Permissionless crank: anyone may push the platform's share to the",
            "treasury recorded on the pool."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "treasuryQuoteAccount",
          "docs": [
            "WSOL."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "collectCreatorFee",
      "discriminator": [
        20,
        22,
        86,
        123,
        198,
        28,
        219,
        132
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Permissionless crank. Funds any missing reward-vault token account and",
            "is refunded the rent of the transient WSOL account."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "docs": [
            "The LaunchLab (and CPMM) creator of the coin; signs the claims."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "vaultQuoteAccount",
          "docs": [
            "the handler: the pool's reward token account, or for a WSOL quote a",
            "transient WSOL account unwrapped into the vault's lamports."
          ],
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "creatorFeeVault",
          "docs": [
            "vault; LaunchLab validates it. Skipped while empty or not yet created."
          ],
          "writable": true
        },
        {
          "name": "creatorFeeVaultAuthority"
        },
        {
          "name": "launchlabProgram",
          "address": "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "compound",
      "discriminator": [
        165,
        208,
        251,
        78,
        242,
        160,
        141,
        47
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "The owner, or for a lock with auto-compound on, the IMAGINE keeper",
            "(`KEEPER_AUTHORITY`). Pays the fees and fronts the rent of the",
            "transient WSOL account (refunded)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenVault",
          "docs": [
            "Receives the coins bought."
          ],
          "writable": true
        },
        {
          "name": "rewardVault",
          "docs": [
            "Signs the buy: it holds the quote being spent."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "vaultQuoteAccount",
          "docs": [
            "the handler: the pool's reward token account, or for a WSOL quote a",
            "transient WSOL account the spent lamports are wrapped into."
          ],
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "launchlabPool",
          "docs": [
            "price (owner and discriminator verified there) and traded on while the",
            "coin is on its curve."
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "minTokensOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositReward",
      "discriminator": [
        245,
        216,
        9,
        179,
        237,
        49,
        165,
        181
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "payerQuoteAccount",
          "docs": [
            "required unless the quote is WSOL. The token program enforces mint and",
            "authority."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "kind",
          "type": "u8"
        }
      ]
    },
    {
      "name": "earlyUnlock",
      "discriminator": [
        188,
        197,
        139,
        16,
        103,
        65,
        139,
        108
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "docs": [
            "principal, rewards and rent."
          ],
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "ownerQuoteAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "ownerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "extend",
      "discriminator": [
        228,
        127,
        0,
        1,
        227,
        154,
        54,
        168
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "ownerQuoteAccount",
          "docs": [
            "WSOL. Receives the rewards settled before the change."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "launchlabPool",
          "docs": [
            "coin's price (owner and discriminator verified there)."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "durationSecs",
          "type": "u32"
        }
      ]
    },
    {
      "name": "found",
      "discriminator": [
        55,
        155,
        110,
        228,
        56,
        231,
        243,
        97
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "launchlabPool",
          "docs": [
            "founding lock's value (owner and discriminator verified there)."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "creatorTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initialLockAmount",
          "type": "u64"
        },
        {
          "name": "initialLockDuration",
          "type": "u32"
        }
      ]
    },
    {
      "name": "harvest",
      "discriminator": [
        228,
        241,
        31,
        182,
        53,
        169,
        59,
        199
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "docs": [
            "the rewards."
          ],
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "ownerQuoteAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "increase",
      "discriminator": [
        254,
        95,
        127,
        165,
        140,
        103,
        125,
        124
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "ownerQuoteAccount",
          "docs": [
            "WSOL. Receives the rewards settled before the change."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "launchlabPool",
          "docs": [
            "coin's price (owner and discriminator verified there)."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    },
    {
      "name": "launch",
      "discriminator": [
        153,
        241,
        93,
        225,
        22,
        69,
        74,
        61
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "mint",
          "docs": [
            "The new coin. LaunchLab creates it (Token-2022, metadata in the mint,",
            "whole supply minted to the curve, mint authority revoked)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "extensions checked in the handler, pinned to the curve by LaunchLab."
          ]
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "docs": [
            "System-owned PDA: holds SOL rewards and is the LaunchLab pool's creator."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "docs": [
            "here; required unless the quote is WSOL."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "globalConfig"
        },
        {
          "name": "launchlabPlatform"
        },
        {
          "name": "launchlabAuthority"
        },
        {
          "name": "launchlabPool",
          "docs": [
            "the handler reads it back."
          ],
          "writable": true
        },
        {
          "name": "launchlabBaseVault",
          "writable": true
        },
        {
          "name": "launchlabQuoteVault",
          "writable": true
        },
        {
          "name": "launchlabEventAuthority"
        },
        {
          "name": "launchlabProgram",
          "address": "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022: every LaunchLab coin here is a Token-2022 mint."
          ],
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "launchArgs"
            }
          }
        }
      ]
    },
    {
      "name": "lock",
      "discriminator": [
        21,
        19,
        208,
        43,
        237,
        62,
        255,
        87
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "optional": true
        },
        {
          "name": "launchlabPool",
          "docs": [
            "coin's price (owner and discriminator verified there)."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "durationSecs",
          "type": "u32"
        }
      ]
    },
    {
      "name": "lockForever",
      "discriminator": [
        241,
        4,
        17,
        77,
        120,
        95,
        174,
        203
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "rewardVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "optional": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "renounce",
      "discriminator": [
        241,
        157,
        138,
        210,
        8,
        235,
        187,
        123
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "rewardVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "optional": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setAutoCompound",
      "discriminator": [
        101,
        22,
        46,
        161,
        189,
        86,
        250,
        244
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "sync",
      "discriminator": [
        4,
        219,
        40,
        164,
        21,
        157,
        189,
        88
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "transferAdmin",
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "unlock",
      "discriminator": [
        101,
        155,
        40,
        21,
        158,
        189,
        56,
        203
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "docs": [
            "principal, rewards and rent."
          ],
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "quoteMint",
          "optional": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Required unless the quote is WSOL."
          ],
          "optional": true
        },
        {
          "name": "ownerQuoteAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.index",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "ownerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    }
  ],
  "events": [
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "compounded",
      "discriminator": [
        187,
        212,
        188,
        187,
        183,
        29,
        107,
        152
      ]
    },
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "creatorClaimed",
      "discriminator": [
        118,
        206,
        30,
        219,
        62,
        164,
        54,
        200
      ]
    },
    {
      "name": "feeDeposited",
      "discriminator": [
        164,
        21,
        194,
        236,
        248,
        44,
        35,
        30
      ]
    },
    {
      "name": "locked",
      "discriminator": [
        188,
        53,
        118,
        62,
        64,
        12,
        198,
        84
      ]
    },
    {
      "name": "lockedForever",
      "discriminator": [
        117,
        111,
        159,
        18,
        249,
        238,
        90,
        246
      ]
    },
    {
      "name": "poolCreated",
      "discriminator": [
        202,
        44,
        41,
        88,
        104,
        220,
        157,
        82
      ]
    },
    {
      "name": "poolLaunched",
      "discriminator": [
        163,
        247,
        64,
        16,
        107,
        160,
        183,
        210
      ]
    },
    {
      "name": "positionExtended",
      "discriminator": [
        61,
        203,
        137,
        60,
        22,
        214,
        17,
        37
      ]
    },
    {
      "name": "positionIncreased",
      "discriminator": [
        73,
        58,
        247,
        181,
        100,
        237,
        249,
        81
      ]
    },
    {
      "name": "renounced",
      "discriminator": [
        76,
        252,
        249,
        226,
        216,
        83,
        173,
        85
      ]
    },
    {
      "name": "rewardCapped",
      "discriminator": [
        190,
        141,
        177,
        54,
        72,
        111,
        212,
        132
      ]
    },
    {
      "name": "rewardsSynced",
      "discriminator": [
        66,
        57,
        28,
        213,
        120,
        33,
        234,
        123
      ]
    },
    {
      "name": "treasuryClaimed",
      "discriminator": [
        59,
        99,
        64,
        13,
        118,
        14,
        251,
        106
      ]
    },
    {
      "name": "unlocked",
      "discriminator": [
        219,
        104,
        74,
        123,
        174,
        92,
        182,
        120
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6001,
      "name": "invalidParameter",
      "msg": "Parameter outside the allowed range"
    },
    {
      "code": 6002,
      "name": "invalidDuration",
      "msg": "Lock duration outside this pool's allowed range"
    },
    {
      "code": 6003,
      "name": "amountTooSmall",
      "msg": "Amount below this pool's minimum lock"
    },
    {
      "code": 6004,
      "name": "notAnExtension",
      "msg": "New unlock time must be later than the current one"
    },
    {
      "code": 6005,
      "name": "stillLocked",
      "msg": "Position is still locked"
    },
    {
      "code": 6006,
      "name": "alreadyUnlocked",
      "msg": "Position has already unlocked; use unlock instead"
    },
    {
      "code": 6007,
      "name": "paused",
      "msg": "Launches are paused for new pools"
    },
    {
      "code": 6008,
      "name": "notPendingAdmin",
      "msg": "Signer is not the pending admin"
    },
    {
      "code": 6009,
      "name": "treasuryMismatch",
      "msg": "Treasury account does not match the pool's treasury"
    },
    {
      "code": 6010,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6011,
      "name": "unsupportedMintExtension",
      "msg": "Mint uses a token extension that is incompatible with custody"
    },
    {
      "code": 6012,
      "name": "freezeAuthoritySet",
      "msg": "Mint has a freeze authority; vault funds could be frozen"
    },
    {
      "code": 6013,
      "name": "vaultAccountingMismatch",
      "msg": "Vault balance does not match pool accounting"
    },
    {
      "code": 6014,
      "name": "positionMatured",
      "msg": "Position has matured; extend it or open a new one"
    },
    {
      "code": 6015,
      "name": "notPositionOwner",
      "msg": "Only the position owner may do this"
    },
    {
      "code": 6016,
      "name": "notUpgradeAuthority",
      "msg": "Only the program upgrade authority may initialise the config"
    },
    {
      "code": 6017,
      "name": "notPoolCreator",
      "msg": "Only the pool's creator may do this"
    },
    {
      "code": 6018,
      "name": "invalidLaunchLabAccount",
      "msg": "Account is not this coin's LaunchLab or CPMM pool"
    },
    {
      "code": 6019,
      "name": "priceUnavailable",
      "msg": "Coin price unavailable: pass the CPMM pool state and both vaults for a migrated coin"
    },
    {
      "code": 6020,
      "name": "positionRenounced",
      "msg": "This lock gave up its earnings; it cannot earn again"
    },
    {
      "code": 6021,
      "name": "notFounded",
      "msg": "Pool has not been founded yet"
    },
    {
      "code": 6022,
      "name": "quoteAccountMismatch",
      "msg": "Quote accounts missing or not this pool's quote"
    },
    {
      "code": 6023,
      "name": "quoteTransferFee",
      "msg": "Quote mint charges a transfer fee or can be made to"
    },
    {
      "code": 6024,
      "name": "quoteHookActive",
      "msg": "Quote mint has an active transfer hook"
    },
    {
      "code": 6025,
      "name": "quoteNotTransferable",
      "msg": "Quote mint is not freely transferable"
    },
    {
      "code": 6026,
      "name": "platformMismatch",
      "msg": "LaunchLab platform is not the configured IMAGINE platform"
    },
    {
      "code": 6027,
      "name": "invalidMetadataUri",
      "msg": "Metadata URI is not this coin's IMAGINE metadata document"
    },
    {
      "code": 6028,
      "name": "positionLockedForever",
      "msg": "This lock is locked forever; it can never be unlocked, grown or extended"
    },
    {
      "code": 6029,
      "name": "compoundNotEnabled",
      "msg": "This lock has not turned on auto-compound; only its owner may compound it"
    },
    {
      "code": 6030,
      "name": "compoundTooSmall",
      "msg": "Rewards to compound are below the minimum"
    },
    {
      "code": 6031,
      "name": "compoundSlippage",
      "msg": "Compound bought fewer coins than the slippage guard allows"
    },
    {
      "code": 6032,
      "name": "notKeeper",
      "msg": "Only the lock's owner or the IMAGINE keeper may compound it"
    }
  ],
  "types": [
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "lifetimeClaimed",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "compounded",
      "docs": [
        "A lock's rewards bought more of its coin, added to the lock (`compound`).",
        "`quote_in` counts as paid to the lock (toward its cap), like a claim."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "quoteIn",
            "type": "u64"
          },
          {
            "name": "tokensOut",
            "type": "u64"
          },
          {
            "name": "newAmount",
            "type": "u64"
          },
          {
            "name": "newWeight",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Platform-wide settings. Only ever read when a *new* pool is created: live",
        "pools carry their own frozen copy of the terms, so nothing an admin does",
        "later can change the deal an existing locker agreed to."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Destination stamped into new pools' `treasury` field."
            ],
            "type": "pubkey"
          },
          {
            "name": "launchlabPlatform",
            "docs": [
              "IMAGINE's LaunchLab `PlatformConfig`. `launch` creates every coin under",
              "it, so its creator fee (paid to each coin's reward vault) applies."
            ],
            "type": "pubkey"
          },
          {
            "name": "tradeFeeBps",
            "docs": [
              "App fee charged by the front-end on routed swaps, in bps of the quote",
              "leg. Advisory: it is enforced when our API builds the transaction, not",
              "by this program. Stored here so the UI and indexer share one source of",
              "truth."
            ],
            "type": "u16"
          },
          {
            "name": "defaultTreasuryShareBps",
            "type": "u16"
          },
          {
            "name": "maxCreatorShareBps",
            "type": "u16"
          },
          {
            "name": "defaultMinLockSecs",
            "type": "u32"
          },
          {
            "name": "defaultMaxLockSecs",
            "type": "u32"
          },
          {
            "name": "defaultMaxMultiplierBps",
            "type": "u32"
          },
          {
            "name": "defaultEarlyUnlockPenaltyBps",
            "type": "u16"
          },
          {
            "name": "defaultMinLockAmount",
            "type": "u64"
          },
          {
            "name": "defaultRewardStreamSecs",
            "type": "u32"
          },
          {
            "name": "defaultDurationCurve",
            "type": "u8"
          },
          {
            "name": "defaultSizeTierBps",
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "defaultSizeBonusBps",
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "poolCreationFee",
            "type": "u64"
          },
          {
            "name": "paused",
            "docs": [
              "Blocks new launches only. Never blocks lock, claim, or unlock."
            ],
            "type": "bool"
          },
          {
            "name": "poolCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "launchlabPlatform",
            "docs": [
              "IMAGINE's LaunchLab `PlatformConfig`; new launches are created under it."
            ],
            "type": "pubkey"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "defaultTreasuryShareBps",
            "type": "u16"
          },
          {
            "name": "maxCreatorShareBps",
            "type": "u16"
          },
          {
            "name": "defaultMinLockSecs",
            "type": "u32"
          },
          {
            "name": "defaultMaxLockSecs",
            "type": "u32"
          },
          {
            "name": "defaultMaxMultiplierBps",
            "type": "u32"
          },
          {
            "name": "defaultEarlyUnlockPenaltyBps",
            "type": "u16"
          },
          {
            "name": "defaultMinLockAmount",
            "type": "u64"
          },
          {
            "name": "defaultRewardStreamSecs",
            "type": "u32"
          },
          {
            "name": "defaultDurationCurve",
            "type": "u8"
          },
          {
            "name": "defaultSizeTierBps",
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "defaultSizeBonusBps",
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "poolCreationFee",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "launchlabPlatform",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "creatorClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeDeposited",
      "docs": [
        "`kind`: 0 = buy fee, 1 = sell fee, 2 = creator share, 3 = donation.",
        "`amount` is quote base units."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launchArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "supply",
            "docs": [
              "Curve shape; LaunchLab validates the combination against the quote's",
              "GlobalConfig (and the platform's curve rule, if it has one)."
            ],
            "type": "u64"
          },
          {
            "name": "totalSell",
            "type": "u64"
          },
          {
            "name": "fundRaising",
            "type": "u64"
          },
          {
            "name": "creatorShareBps",
            "docs": [
              "Slice of post-treasury inflow routed to the creator, forever."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "locked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "weight",
            "type": "u128"
          },
          {
            "name": "multiplierBps",
            "type": "u32"
          },
          {
            "name": "lockEnd",
            "type": "i64"
          },
          {
            "name": "totalLocked",
            "type": "u64"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lockedForever",
      "docs": [
        "A lock was locked forever: its tokens can never leave the vault and its",
        "earnings go to the other lockers. Irreversible."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "lockEnd",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pool",
      "docs": [
        "One lock-to-earn vault, keyed by mint.",
        "",
        "Rewards are paid in the coin's LaunchLab quote (\"pair asset\"): native",
        "lamports on `reward_vault` for a WSOL-quoted coin, otherwise quote tokens in",
        "`reward_token_account`, the vault PDA's associated token account. Amounts",
        "below are quote base units either way.",
        "",
        "Reward accounting is the MasterChef accumulator: every unit that lands in",
        "the vault is detected by balance diff, split, and spread over",
        "`total_weight`. No instruction can move quote or coins out of a pool except",
        "to the locker, creator, or treasury that earned it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "tokenVault",
            "docs": [
              "Set by `found`; default until then."
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "docs": [
              "System-owned PDA `[\"vault\", pool]`. It is the LaunchLab pool's creator,",
              "so the coin's on-chain creator fee is collected here (or in its token",
              "account for a non-SOL quote)."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "Token program that owns `mint` (Token-2022 for LaunchLab coins)."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "docs": [
              "The coin's LaunchLab quote: what lockers are paid in."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "rewardTokenAccount",
            "docs": [
              "`ATA(reward_vault, quote_mint, quote_token_program)` for a token quote;",
              "default for WSOL, whose rewards are native lamports on `reward_vault`."
            ],
            "type": "pubkey"
          },
          {
            "name": "launchlabPool",
            "docs": [
              "The coin's LaunchLab `PoolState`, priced for each lock's earnings cap."
            ],
            "type": "pubkey"
          },
          {
            "name": "terms",
            "type": {
              "defined": {
                "name": "poolTerms"
              }
            }
          },
          {
            "name": "totalLocked",
            "type": "u64"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "accRewardPerWeight",
            "type": "u128"
          },
          {
            "name": "rewardRemainder",
            "docs": [
              "Quote received but too small to divide across `total_weight` yet."
            ],
            "type": "u64"
          },
          {
            "name": "lastVaultBalance",
            "docs": [
              "Distributable vault balance as of the last sync (see `reward_balance`)."
            ],
            "type": "u64"
          },
          {
            "name": "vaultReserve",
            "docs": [
              "Lamports parked in `reward_vault` so it stays rent-exempt; never",
              "distributable."
            ],
            "type": "u64"
          },
          {
            "name": "undistributed",
            "docs": [
              "Lockers' quote that has arrived but is still streaming out."
            ],
            "type": "u64"
          },
          {
            "name": "streamRate",
            "docs": [
              "Release rate in `quote units * SCALE` per second."
            ],
            "type": "u128"
          },
          {
            "name": "streamEnd",
            "docs": [
              "When the current release window ends."
            ],
            "type": "i64"
          },
          {
            "name": "lastStreamAt",
            "docs": [
              "Last timestamp the stream was advanced to."
            ],
            "type": "i64"
          },
          {
            "name": "creatorClaimable",
            "type": "u64"
          },
          {
            "name": "treasuryClaimable",
            "type": "u64"
          },
          {
            "name": "lifetimeInflow",
            "type": "u64"
          },
          {
            "name": "lifetimeRewards",
            "type": "u64"
          },
          {
            "name": "lifetimeCreator",
            "type": "u64"
          },
          {
            "name": "lifetimeTreasury",
            "type": "u64"
          },
          {
            "name": "lifetimeBurned",
            "type": "u64"
          },
          {
            "name": "openPositions",
            "type": "u64"
          },
          {
            "name": "positionsCreated",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "founded",
            "docs": [
              "The creator's founding lock is in. Locks, deposits and syncs wait for it."
            ],
            "type": "bool"
          },
          {
            "name": "rewardCapacity",
            "docs": [
              "Quote the open locks can still earn in total: the sum of every",
              "`Position::reward_cap`, less what has been paid and what is already",
              "credited to them. Fees beyond it go to the treasury the moment they",
              "arrive or release."
            ],
            "type": "u64"
          },
          {
            "name": "shortfall",
            "docs": [
              "Quote that left the vault without this program (a quote issuer's",
              "permanent delegate or clawback) and that the treasury's share, the",
              "stream and the remainder could not cover: what the pool owes beyond",
              "what it holds. Repaid first from the next arrivals. See `absorb_loss`."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                56
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolCreated",
      "docs": [
        "The creator's founding lock opened the pool."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "treasuryShareBps",
            "type": "u16"
          },
          {
            "name": "creatorShareBps",
            "type": "u16"
          },
          {
            "name": "minLockSecs",
            "type": "u32"
          },
          {
            "name": "maxLockSecs",
            "type": "u32"
          },
          {
            "name": "maxMultiplierBps",
            "type": "u32"
          },
          {
            "name": "earlyUnlockPenaltyBps",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "poolLaunched",
      "docs": [
        "A coin was created on LaunchLab under the IMAGINE platform with this pool's",
        "reward vault as its creator. The pool opens for locks once `found` runs."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "launchlabPool",
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "poolTerms",
      "docs": [
        "Immutable economic terms, copied into every pool at creation."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasuryShareBps",
            "type": "u16"
          },
          {
            "name": "creatorShareBps",
            "type": "u16"
          },
          {
            "name": "minLockSecs",
            "type": "u32"
          },
          {
            "name": "maxLockSecs",
            "type": "u32"
          },
          {
            "name": "maxMultiplierBps",
            "type": "u32"
          },
          {
            "name": "earlyUnlockPenaltyBps",
            "type": "u16"
          },
          {
            "name": "minLockAmount",
            "type": "u64"
          },
          {
            "name": "rewardStreamSecs",
            "docs": [
              "Window over which arriving fees are released to lockers.",
              "",
              "Fees are not handed out at the instant they land. They stream in",
              "linearly over this window, so a reward share is earned by weight *held",
              "over time* rather than by weight held at one chosen instant. Without it,",
              "anyone could watch fees pile up in the vault, lock a large bag,",
              "trigger the accounting, claim a slice of a backlog they were not present",
              "for, and leave."
            ],
            "type": "u32"
          },
          {
            "name": "durationCurve",
            "docs": [
              "`CURVE_LINEAR` or `CURVE_SQRT`; see `math::duration_multiplier_bps`."
            ],
            "type": "u8"
          },
          {
            "name": "sizeTierBps",
            "docs": [
              "Ascending thresholds in bps of total supply. Zero disables a tier."
            ],
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "sizeBonusBps",
            "docs": [
              "Bonus applied on top of the duration multiplier at each tier, in bps."
            ],
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "position",
      "docs": [
        "A single lock. A wallet may hold many, each with its own term and weight."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "weight",
            "type": "u128"
          },
          {
            "name": "multiplierBps",
            "type": "u32"
          },
          {
            "name": "lockStart",
            "type": "i64"
          },
          {
            "name": "lockEnd",
            "type": "i64"
          },
          {
            "name": "rewardDebt",
            "docs": [
              "Credit line already settled, in `SCALE`-scaled units, not quote units.",
              "",
              "Keeping the sub-unit residue here is what makes the pool solvent:",
              "rounding it to whole units would let positions round up",
              "independently until the pool owed more than it holds."
            ],
            "type": "u128"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "rewardCap",
            "docs": [
              "The most this lock may ever be paid, in quote base units: its tokens'",
              "quote value when locked (and when grown or extended) times its",
              "multiplier. Compared against `claimed`."
            ],
            "type": "u64"
          },
          {
            "name": "renounced",
            "docs": [
              "The owner gave up this lock's earnings for good: it keeps its tokens",
              "locked to its end date but holds no weight, so every unit it would",
              "have earned goes to the other lockers. Irreversible."
            ],
            "type": "bool"
          },
          {
            "name": "forever",
            "docs": [
              "The owner locked these tokens for good (`lock_forever`): the lock can",
              "never be unlocked, broken, grown or extended, and it is renounced, so",
              "its earnings go to the other lockers. Irreversible."
            ],
            "type": "bool"
          },
          {
            "name": "autoCompound",
            "docs": [
              "The owner opted in to `compound`: anyone may then turn this lock's",
              "rewards into more of the coin, added to the lock. Off unless the owner",
              "sets it; cleared when the lock is renounced."
            ],
            "type": "bool"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                29
              ]
            }
          }
        ]
      }
    },
    {
      "name": "positionExtended",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "lockEnd",
            "type": "i64"
          },
          {
            "name": "multiplierBps",
            "type": "u32"
          },
          {
            "name": "weight",
            "type": "u128"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "positionIncreased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "added",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "weight",
            "type": "u128"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "renounced",
      "docs": [
        "A lock gave up its earnings for good: its weight left the pool and what it",
        "had accrued went back to the stream for the other lockers."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "forfeitedRewards",
            "type": "u64"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rewardCapped",
      "docs": [
        "A lock was paid up to its cap and the rest of what it had accrued went to",
        "the treasury."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "toTreasury",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "rewardCap",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rewardsSynced",
      "docs": [
        "Emitted on every sync that absorbed new quote, whatever its source: routed",
        "app fees, the on-chain LaunchLab / CPMM creator fee collected by",
        "`collect_creator_fee`, or plain donations. Amounts",
        "are quote base units."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "inflow",
            "type": "u64"
          },
          {
            "name": "toLockers",
            "type": "u64"
          },
          {
            "name": "toCreator",
            "type": "u64"
          },
          {
            "name": "toTreasury",
            "type": "u64"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "accRewardPerWeight",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "treasuryClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "unlocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "returned",
            "type": "u64"
          },
          {
            "name": "burned",
            "type": "u64"
          },
          {
            "name": "forfeitedRewards",
            "type": "u64"
          },
          {
            "name": "early",
            "type": "bool"
          },
          {
            "name": "totalLocked",
            "type": "u64"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "compoundSlippageBps",
      "docs": [
        "How far below the venue's spot price, before the buy, a compound may fill:",
        "the trade's own fees and price impact must fit inside it."
      ],
      "type": "u64",
      "value": "300"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "metadataUriPrefix",
      "docs": [
        "The only metadata URI `launch` accepts for a coin is",
        "`METADATA_URI_PREFIX + base58(mint) + METADATA_URI_SUFFIX`: the document",
        "the IMAGINE API hosts for that mint, whose website is the coin's IMAGINE",
        "page (`https://imagine.fun/coins/<mint>`)."
      ],
      "type": "string",
      "value": "\"https://api.imagine.fun/files/meta/\""
    },
    {
      "name": "metadataUriSuffix",
      "type": "string",
      "value": "\".json\""
    },
    {
      "name": "minCompoundQuote",
      "docs": [
        "The least `compound` will spend, in quote base units (0.001 SOL for a SOL",
        "quote; the same base-unit floor for any other), so a crank never pays more",
        "in fees than it buys."
      ],
      "type": "u64",
      "value": "1000000"
    },
    {
      "name": "poolSeed",
      "type": "bytes",
      "value": "[112, 111, 111, 108]"
    },
    {
      "name": "positionSeed",
      "type": "bytes",
      "value": "[112, 111, 115, 105, 116, 105, 111, 110]"
    },
    {
      "name": "tokenVaultSeed",
      "type": "bytes",
      "value": "[116, 111, 107, 101, 110, 45, 118, 97, 117, 108, 116]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
