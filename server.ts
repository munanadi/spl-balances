import express from "express";
import cors from "cors";
import axios from "axios";

const POST_URL = "http://localhost:8080/v1/graphql";

const graphqlHeaders = {
  "Content-Type": "application/json",
};

(async function () {
  // const app = express();

  // app.use(cors());

  // app.get("/", (req, res) => res.send("Hello"));

  // Fetch sol tokens
  const TOKENS = await fetchSolanaTokenList();

  const LOCAL_TOKENS: {
    [tokenAdd: string]: {
      name: string | null;
      decimals: number;
      logo: string;
      symbol: string;
    };
  } = {};

  const fetchAllMints = `query fetchAllMints{
    tokens(distinct_on:mint){
      mint
    }
  }`;

  const mintKeys: string[] = [];

  try {
    const resp = await axios.post(
      POST_URL,
      {
        query: fetchAllMints,
      },
      {
        headers: graphqlHeaders,
      }
    );

    resp?.data?.data?.tokens.map((ele: any) => {
      mintKeys.push(ele.mint);

      // construct the local_sol
      if (!LOCAL_TOKENS[ele.mint]) {
        if (TOKENS[ele.mint.toString()]) {
          const { decimals, logo, name, symbol } = TOKENS[ele.mint.toString()];
          LOCAL_TOKENS[ele.mint.toString()] = {
            decimals,
            logo,
            name,
            symbol,
          };
        } else {
          LOCAL_TOKENS[ele.mint] = {
            decimals: -1, // To show this is not in the list?
            logo: "",
            name: null,
            symbol: "",
          };
        }
      }

      return ele.mint;
    });
  } catch (e) {
    console.log("Something went wrong");
    console.log(e);
    // TODO: Handle failure case
    process.exit(1);
  }

  const fetchAllTxnsForMint = (mint: string) => `query fetchAllTxnsForMint {
    tokens(where: {mint: {_eq: "${mint}"}}, order_by: {blocktime: asc}) {
      amt
      diff
      mint
      sol_change
      blocktime
      txn_hash
    }
  }`;

  let now = new Date();
  let yesterday = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10);

  console.log(
    `Fetching ${now.toLocaleString()} - ${yesterday.toLocaleString()}`
  );

  const fetch24HVolForMint = (mint: string) => `query fetchAllTxnsForMint {
    tokens(where: {mint: {_eq: "${mint}"}, blocktime: { _gt: "${
    yesterday.getTime() / 1000
  }", _lt: "${now.getTime() / 1000}" } }, order_by: {blocktime: asc}) {
      amt
      diff
      mint
      sol_change
      blocktime
      txn_hash
    }
  }`;

  for (const mintAdd of mintKeys) {
    console.log(
      `Fetching txns for ${
        LOCAL_TOKENS[mintAdd].name ? LOCAL_TOKENS[mintAdd].symbol : mintAdd
      }`
    );
    try {
      const resp = await axios.post(
        POST_URL,
        {
          query: fetch24HVolForMint(mintAdd),
        },
        {
          headers: graphqlHeaders,
        }
      );

      resp?.data?.data?.tokens.forEach((ele: any) =>
        console.log(`
      ${ele.amt}, ${ele.diff}, ${new Date(
          ele.blocktime * 1000
        ).toLocaleString()}, ${ele.txn_hash},
      `)
      );
    } catch (e) {
      console.log("Something went wrong");
      console.log(e);
      // TODO: Handle failure case
      process.exit(1);
    }
  }

  // app.listen(5000, () => console.log("Server running"));
})();

async function fetchSolanaTokenList() {
  const data = (
    await axios.get(
      "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json"
    )
  ).data;

  const tokens = data.tokens;

  const TOKENS: {
    [address: string]: {
      name: string;
      decimals: number;
      symbol: string;
      logo: string;
    };
  } = {};

  for (const token of tokens) {
    const body = {
      symbol: token.symbol,
      decimals: token.decimals,
      name: token.name,
      logo: token.logoURI,
    };

    TOKENS[token.address] = body;
  }

  return TOKENS;
}

/**
 * @description Fetch Prices for tokens
 * @example tokenPrices[TOKEN_ADD] = { usdt, priceChange }
 */
async function fetchTokenPrices(TOKENS_SET: Set<string>) {
  /**
   * @description Fetch Prices for tokens
   * @example tokenPrices[TOKEN_ADD] = { usdt, priceChange }
   */
  const tokenPrices: { [tokenAdd: string]: { usdt: any; priceChange: any } } =
    {};

  for (const tokenAdd of TOKENS_SET) {
    const priceData = (
      await axios.get(`https://public-api.solscan.io/market/token/${tokenAdd}`)
    ).data;

    tokenPrices[tokenAdd] = {
      usdt: priceData.priceUsdt,
      priceChange: priceData.priceChange24h,
    };
  }

  return tokenPrices;
}
