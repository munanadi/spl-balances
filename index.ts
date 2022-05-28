/**
 * Hack to make dotenv work with ES6
 * https://github.com/motdotla/dotenv/pull/362/files#diff-86a9903e156e927494bb34e6a8a5af426ba2201cec729680b9cd916609be5718
 */
import "./utils/env";
import {
  PublicKey,
  Connection,
  TransactionResponse,
  ConfirmedTransactionMeta,
  ParsedTransactionMeta,
  ParsedTransactionWithMeta,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import axios from "axios";

if (!process.env.RPC_ENDPOINT) {
  console.log("RPC not given");
  process.exit(0);
}

const connection = new Connection(process.env.RPC_ENDPOINT, {
  commitment: "finalized",
});

// console.log(
//   connection.getRecentPerformanceSamples().then((data) => console.log(data))
// );

const accountToCheck = "3m38Q4moooXLU5yb5MynZ9jS8iyV7YpEvp7McxiDt3GZ";
// Map to store txns that are fetched
const fetchedTxns = new Map<string, boolean>();

// Arr to keep track of all mints fetched related to this account
const mintAdds = new Set<string>();

enum TxnType {
  DIFF,
  POST,
  PRE,
}

(async function () {
  // const solTokensList = await fetchSolanaTokenList();

  const tokenBalances: {
    [mint: string]: {
      amt: number;
      diff: number;
      solChange: number;
      blockTime: number;
      date: string;
      txnHash: string;
      type: TxnType;
    }[];
  } = {};

  console.log("fetching signatures");

  const signatures = await fetchConfirmedSignaturesForAdd(
    accountToCheck,
    undefined,
    1 // This will fetch 2000 txns (failed + successful)
  );

  console.log(signatures.length, " number of signatures that are found");

  if (signatures.length == 0) {
    console.log("No signatures found, exiting");
    process.exit(0);
  }

  const txnResults = await connection.getParsedTransactions(signatures);

  // Construct query to write to hasura
  let queryParam = ``;

  for (const txnResult of txnResults) {
    // console.log(JSON.stringify(txnResult, null, 2));

    const { slot, transaction, blockTime, meta } =
      txnResult as ParsedTransactionWithMeta;

    // To differentiate if blockTime was not set
    let _blockTime = -1;
    let _meta: ParsedTransactionMeta | null = null;

    if (blockTime) {
      _blockTime = blockTime;
    }

    if (!meta) {
      console.log("meta not found for ", transaction.signatures[0]);
      // Didn't fetch properly will need to refetch this.
      continue;
    }

    const {
      fee,
      preTokenBalances,
      postTokenBalances,
      preBalances,
      postBalances,
      err,
      innerInstructions,
      logMessages,
    } = meta;
    const { message, signatures } = transaction;

    if (!preTokenBalances || !postTokenBalances) {
      console.log("------------ Failed to fetch pre post token balances");
      // Need to refetch this too
      continue;
    }

    // If here then the txn was fetched properly
    signatures.forEach((signature) => fetchedTxns.set(signature, true));

    const postTokenBalancesOwner = postTokenBalances.filter(
      (a) => a.owner === accountToCheck
    );
    const preTokenBalancesOwner = preTokenBalances.filter(
      (a) => a.owner === accountToCheck
    );

    const indexesChecked: number[] = [];

    // Finish with post tokens balances completely
    for (const tokenData of postTokenBalancesOwner) {
      // update mint add
      mintAdds.add(tokenData.mint);

      const index = tokenData.accountIndex;
      indexesChecked.push(index);
      const preTokenData = preTokenBalancesOwner.find(
        (r) => r.accountIndex == index
      );

      // Init
      if (!tokenBalances[tokenData.mint]) {
        tokenBalances[tokenData.mint] = [];
      }

      // If found the corresponding pre token data, then subtract from post
      if (preTokenData) {
        tokenBalances[tokenData.mint].push({
          amt: preTokenData.uiTokenAmount.uiAmount ?? 0,
          diff:
            (tokenData.uiTokenAmount.uiAmount ?? 0) -
            (preTokenData.uiTokenAmount.uiAmount ?? 0),
          solChange:
            (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL,
          blockTime: _blockTime,
          date: new Date(_blockTime * 1000).toLocaleString(),
          txnHash: signatures[0],
          type: TxnType.DIFF,
        });

        queryParam += `{
          mint: "${tokenData.mint.toString()}", 
          amt: "${preTokenData.uiTokenAmount.uiAmount ?? 0}", 
          blocktime: "${_blockTime.toString()}", 
          diff: "${
            (tokenData.uiTokenAmount.uiAmount ?? 0) -
            (preTokenData.uiTokenAmount.uiAmount ?? 0)
          }", 
          sol_change: "${
            (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL
          }", 
          txn_hash: "${signatures[0].toString()}"
        }`;

        continue;
      }

      tokenBalances[tokenData.mint].push({
        amt: tokenData.uiTokenAmount.uiAmount ?? 0,
        diff: tokenData.uiTokenAmount.uiAmount ?? 0,
        solChange: postBalances[index] / LAMPORTS_PER_SOL,
        blockTime: _blockTime,
        date: new Date(_blockTime * 1000).toLocaleString(),
        txnHash: signatures[0],
        type: TxnType.POST,
      });

      queryParam += `{
        mint: "${tokenData.mint.toString()}", 
        amt: "${tokenData.uiTokenAmount.uiAmount ?? 0}", 
        blocktime: "${_blockTime.toString()}", 
        diff: "${tokenData.uiTokenAmount.uiAmount ?? 0}", 
        sol_change: "${postBalances[index] / LAMPORTS_PER_SOL}", 
        txn_hash: "${signatures[0].toString()}"
      }`;
    }

    // interate over pre tokens balances
    for (const tokenData of preTokenBalancesOwner) {
      // update mint add
      mintAdds.add(tokenData.mint);

      // slip if already handled in prev loop
      const index = tokenData.accountIndex;
      const skip = indexesChecked.includes(index);

      if (skip) {
        console.log("SKIPPING as Dup");
        continue;
      }

      // Init
      if (!tokenBalances[tokenData.mint]) {
        tokenBalances[tokenData.mint] = [];
      }

      // Add the pre tokens balances
      tokenBalances[tokenData.mint].push({
        amt: tokenData.uiTokenAmount.uiAmount ?? 0,
        diff: -(tokenData.uiTokenAmount.uiAmount ?? 0),
        solChange: preBalances[index] / LAMPORTS_PER_SOL,
        blockTime: _blockTime,
        date: new Date(_blockTime * 1000).toLocaleString(),
        txnHash: signatures[0],
        type: TxnType.PRE,
      });

      queryParam += `{
        mint: "${tokenData.mint.toString()}", 
        amt: "${tokenData.uiTokenAmount.uiAmount ?? 0}", 
        blocktime: "${_blockTime.toString()}", 
        diff: "${-(tokenData.uiTokenAmount.uiAmount ?? 0)}", 
        sol_change: "${preBalances[index] / LAMPORTS_PER_SOL}", 
        txn_hash: "${signatures[0].toString()}"
      }`;
    }

    console.log(
      new Date(_blockTime * 1000).toLocaleString(),
      signatures.map((s) => `${s}`)
      // programIds
    );
    // console.table(preTokenBalancesMap ?? "");
    // console.table(postTokenBalancesMap ?? "");
    // console.table(preTokensMap);
    // console.table(postTokensMap);

    // console.log("-------");
  }

  const sortedTokenBalances: typeof tokenBalances = {};

  // // Sort according to blockTime
  // for (const tokenAdd of Object.keys(tokenBalances)) {
  //   const arrData = tokenBalances[tokenAdd];
  //   const sortedArr = arrData.sort((a, b) => a.blockTime - b.blockTime); // Ascending sorted
  //   sortedTokenBalances[tokenAdd] = sortedArr;
  // }

  // console.log("sortedBalances", sortedTokenBalances);

  // Get ATA for mints
  const mintATAs = new Array<string>();
  const mintTxns: string[] = [];

  for (const mintAdd of mintAdds) {
    const mintAta = await getAssociatedTokenAddress(
      new PublicKey(mintAdd),
      new PublicKey(accountToCheck)
    );
    mintATAs.push(mintAta.toString());
    console.log(mintAta.toString(), mintAdd);

    const data = await connection.getConfirmedSignaturesForAddress2(
      mintAta,
      { limit: 1000 },
      "finalized"
    );

    let signatures = data.filter((ele) => !ele.err).map((ele) => ele.signature);

    // console.log("before", signatures.length);

    // Filter off the already fetched txns
    signatures = signatures.filter((s) => (fetchedTxns.has(s) ? false : true));

    // console.log("after", signatures.length);

    mintTxns.push(...signatures);
  }

  // Fetch the txns data of ATA's

  const ataDatas = await connection.getParsedTransactions(mintTxns);

  for (const txnResult of ataDatas) {
    const { slot, transaction, blockTime, meta } =
      txnResult as ParsedTransactionWithMeta;

    // To differentiate if blockTime was not set
    let _blockTime = -1;

    if (blockTime) {
      _blockTime = blockTime;
    }

    if (!meta) {
      console.log("meta not found for ", transaction.signatures[0]);
      // Didn't fetch properly will need to refetch this.
      continue;
    }

    const { preTokenBalances, postTokenBalances, preBalances, postBalances } =
      meta;
    const { signatures } = transaction;

    if (!preTokenBalances || !postTokenBalances) {
      console.log("------------ Failed to fetch pre post token balances");
      // Need to refetch this too
      continue;
    }

    // If here then the txn was fetched properly
    signatures.forEach((signature) => fetchedTxns.set(signature, true));

    const postTokenBalancesOwner = postTokenBalances.filter(
      (a) => a.owner === accountToCheck
    );
    const preTokenBalancesOwner = preTokenBalances.filter(
      (a) => a.owner === accountToCheck
    );

    const indexesChecked: number[] = [];

    // Finish with post tokens balances completely
    for (const tokenData of postTokenBalancesOwner) {
      // update mint add
      mintAdds.add(tokenData.mint);

      const index = tokenData.accountIndex;
      indexesChecked.push(index);
      const preTokenData = preTokenBalancesOwner.find(
        (r) => r.accountIndex == index
      );

      // Init
      if (!tokenBalances[tokenData.mint]) {
        tokenBalances[tokenData.mint] = [];
      }

      // If found the corresponding pre token data, then subtract from post
      if (preTokenData) {
        tokenBalances[tokenData.mint].push({
          amt: preTokenData.uiTokenAmount.uiAmount ?? 0,
          diff:
            (tokenData.uiTokenAmount.uiAmount ?? 0) -
            (preTokenData.uiTokenAmount.uiAmount ?? 0),
          solChange:
            (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL,
          blockTime: _blockTime,
          date: new Date(_blockTime * 1000).toLocaleString(),
          txnHash: signatures[0],
          type: TxnType.DIFF,
        });

        queryParam += `{
          mint: "${tokenData.mint.toString()}", 
          amt: "${preTokenData.uiTokenAmount.uiAmount ?? 0}", 
          blocktime: "${_blockTime.toString()}", 
          diff: "${
            (tokenData.uiTokenAmount.uiAmount ?? 0) -
            (preTokenData.uiTokenAmount.uiAmount ?? 0)
          }", 
          sol_change: "${
            (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL
          }", 
          txn_hash: "${signatures[0].toString()}"
        }`;

        continue;
      }

      tokenBalances[tokenData.mint].push({
        amt: tokenData.uiTokenAmount.uiAmount ?? 0,
        diff: tokenData.uiTokenAmount.uiAmount ?? 0,
        solChange:
          (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL,
        blockTime: _blockTime,
        date: new Date(_blockTime * 1000).toLocaleString(),
        txnHash: signatures[0],
        type: TxnType.POST,
      });

      queryParam += `{
        mint: "${tokenData.mint.toString()}", 
        amt: "${tokenData.uiTokenAmount.uiAmount ?? 0}", 
        blocktime: "${_blockTime.toString()}", 
        diff: "${tokenData.uiTokenAmount.uiAmount ?? 0}", 
        sol_change: "${
          (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL
        }", 
        txn_hash: "${signatures[0].toString()}"
      }`;
    }

    // interate over pre tokens balances
    for (const tokenData of preTokenBalancesOwner) {
      // update mint add
      mintAdds.add(tokenData.mint);

      // slip if already handled in prev loop
      const index = tokenData.accountIndex;
      const skip = indexesChecked.includes(index);

      if (skip) {
        console.log("SKIPPING as Dup");
        continue;
      }

      // Init
      if (!tokenBalances[tokenData.mint]) {
        tokenBalances[tokenData.mint] = [];
      }

      // Add the pre tokens balances
      tokenBalances[tokenData.mint].push({
        amt: tokenData.uiTokenAmount.uiAmount ?? 0,
        diff: -(tokenData.uiTokenAmount.uiAmount ?? 0),
        solChange:
          (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL,
        blockTime: _blockTime,
        date: new Date(_blockTime * 1000).toLocaleString(),
        txnHash: signatures[0],
        type: TxnType.PRE,
      });

      queryParam += `{
        amt: "${tokenData.uiTokenAmount.uiAmount ?? 0},
        diff: "${-(tokenData.uiTokenAmount.uiAmount ?? 0)},
        solChange: "${
          (postBalances[index] - preBalances[index]) / LAMPORTS_PER_SOL
        },
        blockTime: "${_blockTime},
        date: "${new Date(_blockTime * 1000).toLocaleString()},
        txnHash: "${signatures[0]}
      }`;
    }

    console.log(
      new Date(_blockTime * 1000).toLocaleString(),
      signatures.map((s) => `${s}`)
    );
  }

  // Add data to hasura
  const POST_URL = "http://localhost:8080/v1/graphql";

  const graphqlHeaders = {
    "Content-Type": "application/json",
  };

  const query = `
  mutation MyMutation {
    insert_tokens(objects: [${queryParam}], on_conflict: {constraint: tokens_pkey} ) {
      affected_rows
      returning {
        txn_hash
      }
    }
  }
  `;

  try {
    const resp = await axios.post(
      POST_URL,
      {
        query,
      },
      {
        headers: graphqlHeaders,
      }
    );
    console.log(resp?.data);

    console.log(
      `Inserted ${resp?.data?.data?.insert_tokens.affected_rows} rows of data`
    );
  } catch (e) {
    console.log("Something went wrong");
    console.log(e);
    // TODO: What happens when it doesn't write here?
    process.exit(1);
  }

  // Sort according to blockTime
  for (const tokenAdd of Object.keys(tokenBalances)) {
    const arrData = tokenBalances[tokenAdd];
    const sortedArr = arrData.sort((a, b) => a.blockTime - b.blockTime); // Ascending sorted
    sortedTokenBalances[tokenAdd] = sortedArr;
  }

  console.log("sortedBalances", sortedTokenBalances);

  const cachedValues = sortedTokenBalances;
})();

/** Signature that need to be fetched */
const SIGNATURES: string[] = [];
let lastFetchedSignature: string;

/**
 * This will return all successful signatures for a given adddress
 * would even call itself to add all signatures that would be present
 * @param address address to fetch signature for
 * @param lastFetched fetches txns hash from here
 * @param repeat number of times fns runs
 */
async function fetchConfirmedSignaturesForAdd(
  address: string,
  lastFetched: string | undefined,
  repeat: number
): Promise<string[]> {
  // console.log(`Fetching from ${lastFetched ?? "starting"}`);

  if (repeat == 0) {
    // Done fething all signatures for this address
    console.log(
      "Done fetcheing all signature that are there for this ",
      address
    );
    return SIGNATURES;
  }

  const data = await connection.getConfirmedSignaturesForAddress2(
    new PublicKey(address),
    {
      limit: 1000,
      before: lastFetched,
    },
    "finalized"
  );

  const signatures = data.filter((ele) => !ele.err).map((ele) => ele.signature);

  // Add to global array of SIGNATURES
  SIGNATURES.push(...signatures);

  lastFetchedSignature = data[data.length - 1].signature;

  if (data.length === 1000) {
    // More signatures are present
    console.log(
      "More signatures are present, ",
      lastFetchedSignature,
      " is the last fetched signature"
    );
    await fetchConfirmedSignaturesForAdd(
      address,
      lastFetchedSignature,
      repeat - 1
    );
  }

  // console.log("Done fetcheing all signature that are there for this ", address);
  return SIGNATURES;
}
