/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/vise.json`.
 */
export type Vise = {
  "address": "VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb",
  "metadata": {
    "name": "vise",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "VISE — time-weighted lock-to-earn vaults for pump.fun coins"
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createPool",
      "discriminator": [
        233,
        146,
        209,
        142,
        207,
        104,
        64,
        188
      ],
      "accounts": [
        {
          "name": "creator",
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
          "name": "treasury",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "bondingCurve",
          "docs": [
            "the handler to prove the signer is the coin's real creator; owner and",
            "PDA derivation are both verified there."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100,
                  105,
                  110,
                  103,
                  45,
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                1,
                86,
                224,
                246,
                147,
                102,
                90,
                207,
                68,
                219,
                21,
                104,
                191,
                23,
                91,
                170,
                81,
                137,
                203,
                151,
                245,
                210,
                255,
                59,
                101,
                93,
                43,
                182,
                253,
                109,
                24,
                176
              ]
            }
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
                "path": "mint"
              }
            ]
          }
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
          "name": "rewardVault",
          "docs": [
            "lamports can leave only through a signed system transfer."
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
          "name": "args",
          "type": {
            "defined": {
              "name": "createPoolArgs"
            }
          }
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
          "address": "VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb"
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
      "msg": "Launchpad is paused for new pools"
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
      "msg": "Token vault balance does not match pool accounting"
    },
    {
      "code": 6014,
      "name": "vaultReserveMissing",
      "msg": "Reward vault is missing its rent reserve"
    },
    {
      "code": 6015,
      "name": "positionMatured",
      "msg": "Position has matured; extend it or open a new one"
    },
    {
      "code": 6016,
      "name": "notPositionOwner",
      "msg": "Only the position owner may do this"
    },
    {
      "code": 6017,
      "name": "notUpgradeAuthority",
      "msg": "Only the program upgrade authority may initialise the config"
    },
    {
      "code": 6018,
      "name": "notCoinCreator",
      "msg": "Signer is not the coin's creator on pump.fun"
    },
    {
      "code": 6019,
      "name": "invalidBondingCurve",
      "msg": "Bonding curve account is not a readable pump.fun curve"
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
            "name": "tradeFeeBps",
            "docs": [
              "App fee charged by the front-end on routed swaps, in bps of the SOL leg.",
              "Advisory: it is enforced when our API builds the transaction, not by this",
              "program. Stored here so the UI and indexer share one source of truth."
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
              "Blocks new pool creation only. Never blocks lock, claim, or unlock."
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
      "name": "createPoolArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creatorShareBps",
            "docs": [
              "Slice of post-treasury inflow routed to the creator, forever."
            ],
            "type": "u16"
          },
          {
            "name": "initialLockAmount",
            "docs": [
              "The creator's own founding lock. Required: it guarantees the pool has",
              "non-zero weight from its first slot, so no later locker can scoop an",
              "accumulated remainder, and it puts the creator's tokens at risk first."
            ],
            "type": "u64"
          },
          {
            "name": "initialLockDuration",
            "type": "u32"
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
        "`kind`: 0 = buy fee, 1 = sell fee, 2 = pump creator-fee sweep, 3 = donation."
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
      "name": "pool",
      "docs": [
        "One lock-to-earn vault, keyed by mint.",
        "",
        "Reward accounting is the MasterChef accumulator: every lamport that lands in",
        "`reward_vault` is detected by balance diff, split, and spread over",
        "`total_weight`. No instruction can move SOL or tokens out of a pool except",
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
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "Token program that owns `mint` (SPL Token or Token-2022)."
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
              "Lamports received but too small to divide across `total_weight` yet."
            ],
            "type": "u64"
          },
          {
            "name": "lastVaultBalance",
            "docs": [
              "`reward_vault.lamports - vault_reserve` as of the last sync."
            ],
            "type": "u64"
          },
          {
            "name": "vaultReserve",
            "docs": [
              "Rent-exempt minimum parked in `reward_vault`; never distributable."
            ],
            "type": "u64"
          },
          {
            "name": "undistributed",
            "docs": [
              "Lockers' lamports that have arrived but are still streaming out."
            ],
            "type": "u64"
          },
          {
            "name": "streamRate",
            "docs": [
              "Release rate in `lamports * SCALE` per second."
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
          }
        ]
      }
    },
    {
      "name": "poolCreated",
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
              "anyone could watch lamports pile up in the vault, lock a large bag,",
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
              "Credit line already settled, in `SCALE`-scaled units, not lamports.",
              "",
              "Keeping the sub-lamport residue here is what makes the pool solvent:",
              "rounding it to whole lamports would let positions round up",
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
      "name": "rewardsSynced",
      "docs": [
        "Emitted on every sync that absorbed new lamports, whatever their source:",
        "routed app fees, pump.fun creator-fee distributions, or plain donations."
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
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
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
