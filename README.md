#### Solana Investigation Tool

---

A public blockchain is what it is 'public', So the movement of funds to different wallets documented gives it an extra layer of transparency and security. Especially tools like this is the need of the hour when things like Luna happen.

Currently there aren't tools like [breadcrumbs](https://www.breadcrumbs.app/) on the solana chain, Indexers are still a hassle to get your hands on in this space.

Given the complicated accounts model of solana and inherent problems with the chain, there isn't a robust solution that is readily available, and teams rather end up putting together a hacky solution that maybe just works.

So this script runs for a particular wallet and indexes all the spl token transactions that happened, It also provides a graphql layer on top to queries relevant data.

PS. Also, with modification to this script, you can really put out data from the transaction parsed as you please.
ex. You could find to which address the tokens were transferred to, etc.

##### Setup

---

1. Run hasura locally in a docker container using docker compose
   `docker-compose up -d`
2. Get an RPC endpoint and enter the same under `RPC_ENDPOINT` in `.env`
3. Run `index.ts` after swapping out `accountToCheck` to fetch transactions for the same.
4. Run queries against hasura to get records as required.

The tables that get populated currently looks like show below

| mint         | blocktime  | amt    | diff  | sol_change | txn_hash     |
| ------------ | ---------- | ------ | ----- | ---------- | ------------ |
| Ejdfa..uhe3n | 1231232112 | 12.045 | 10.00 | 0          | aDdsaf..asdf |

The returned data looks like [this](https://gist.github.com/pisomanik/651e6420939163efbcbf17f3183da226) for a particular token address of a given wallet.
As shown below in the result returned from hasura, we can see the wallet had `199.817177` and there was a `200` credit to this account at said date ( `blocktime` ) and it's corresponding hash (`txn_hash`), The updated balance is `399.817177` in the following transaction and it goes on...

```json
 {
        "amt": 199.817177,
        "diff": 200.00000000000003,
        "sol_change": 0,
        "blocktime": 1639582020,
        "txn_hash": "4rodPm1e6FWAa3YNUJB3tkeEQ8NBzvtpdxK6AMxYzY3m7vZ3xvqeycU4VEE5VB82BrcKiyFAo3wCyaksKewdjmcY"
      },
      {
        "amt": 399.817177,
        "diff": -200.00000000000003,
        "sol_change": 0,
        "blocktime": 1639582169,
        "txn_hash": "4X2cw9JbM85cUk8pRBCcb7TCsxpLb5qLr6HPjZTCRQ6sigdDmhsGGigzaSgJthhXzacpzXrHZAFPg4a6RJ9hq7ub"
      },
```

#### Challenges I ran into

---

This is a hacky solution that pulls data from an RPC node. This would definitely require more testing to be robust and be really used in production.

There are times when a transaction gets repeatedly returned basically leading to duplicate calls. This can be troublesome as it can lead to huge RPC loads that could even lead to your app getting blacklisted because of spam.

Also, this is a one-time setup to modify the script to pull data of your interest from the fetched parsed transaction, In this case, it is focused more on just the funds moving in and out of a given wallet address.

> This is still a WIP and needs refinement for mainstream adoption.
