### SPL Token balances indexer

This runs a local hasura docker setup that store txns data of spl tokens that goes through a given wallet address

The data would looks something like this, served over a graphql endpoint this can be queries as required.

| mint         | blocktime  | amt    | diff  | sol_change | txn_hash     |
| ------------ | ---------- | ------ | ----- | ---------- | ------------ |
| Ejdfa..uhe3n | 1231232112 | 12.045 | 10.00 | 0          | aDdsaf..asdf |

### Steps

### TODO
