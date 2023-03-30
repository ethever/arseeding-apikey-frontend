import { atom, useAtom, Provider } from "jotai";
import { atomsWithQuery } from "jotai-tanstack-query";
import Everpay, { ChainType } from "everpay";
import detectEthereumProvider from "@metamask/detect-provider";
import { ethers, providers } from "ethers";
import { orderBy } from "lodash";
import isString from "is-string";
import * as E from "fp-ts/Either";
import { flow, pipe, absurd } from "fp-ts/function";
import * as TE from "fp-ts/lib/TaskEither";
import {
  ACCOUNT_STATUS_QUERY_KEY,
  ARSEEDING_BUNDLER_ADDRESS,
  BALANCES_KEY,
} from "../constants";
import fetchStatusFn from "../fetch-status";

type ArrayElement<ArrayType extends readonly unknown[]> =
  ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

export const accountsAtom = atom<string[]>([]);
export const arseedingBundlerAddressAtom = atom<string>(
  "uDA8ZblC-lyEFfsYXKewpwaX-kkNDDw8az3IW9bDL68"
);

// get bundler address here:
// https://arseed.web3infra.dev/bundle/bundler
export const [statusAtom] = atomsWithQuery((get) => ({
  queryKey: [ACCOUNT_STATUS_QUERY_KEY, get(accountsAtom)],
  queryFn: fetchStatusFn,
  refetchInterval: 2000,
  retry: true,
  retryDelay: 2000,
}));

export const [arseedBundlerAddressAtom] = atomsWithQuery(() => ({
  queryKey: [ARSEEDING_BUNDLER_ADDRESS],
  queryFn: async () => {
    const res = await fetch(`https://arseed.web3infra.dev/bundle/bundler`);
    return (
      (await res.json()) as {
        bundler: string;
      }
    ).bundler;
  },
  retry: true,
  retryDelay: 2000,
}));

export const metamaskProviderAtom = atom(
  async (): Promise<providers.ExternalProvider> => {
    const p = await detectEthereumProvider({
      mustBeMetaMask: true,
    });
    if (!p) {
      throw new Error("can not find metamask");
    }
    return p;
  }
);

export const providerAtom = atom(async (get) => {
  const metamaskProvider = await get(metamaskProviderAtom);
  return new ethers.providers.Web3Provider(metamaskProvider);
});
export const signerAtom = atom(async (get) => {
  const provider = await get(providerAtom);
  return provider.getSigner();
});

export const everpayAtom = atom(async (get) => {
  // TODO: supporting select account.
  // TODO: check lenght
  const accounts = get(accountsAtom);
  const signer = await get(signerAtom);
  const everpay = new Everpay({
    account: accounts[0],
    chainType: ChainType.ethereum,
    ethConnectedSigner: signer,
  });

  return everpay;
});
const sleep = (t: number) => new Promise((resolve) => setTimeout(resolve, t));

export const tokensInfoAtom = atom(async (get) => {
  // MOCK: delay
  await sleep(1000);
  const everpay = await get(everpayAtom);
  const res = await everpay.info();

  return res;
});

// get balances of current everpay account
export const [balancesAtom] = atomsWithQuery((get) => ({
  queryKey: [BALANCES_KEY],
  queryFn: async () => {
    const everpay = await get(everpayAtom);
    const balances = await everpay.balances();
    const orderKey: Array<keyof ArrayElement<typeof balances>> = [
      "balance",
      "symbol",
    ];
    const orderPat: Array<"desc" | "asc"> = ["desc", "asc"];
    return orderBy(balances, orderKey, orderPat);
  },
  refetchInterval: 2000,
  retry: true,
  retryDelay: 2000,
}));

export const getApikeyAtom = atom(async (get) => {
  const signer = await get(signerAtom);
  return async () => {
    // https://www.notion.so/permadao/123-3b62f09dcc2c4076886f40fdf7252e1d
    const curTime = ~~(new Date().getTime() / 1000);
    const signature = await signer.signMessage(curTime.toString());

    const rep = await fetch(
      `https://arseed.web3infra.dev/apikey/${curTime}/${signature}`
    );
    const res = (await rep.json()) as unknown as
      | string
      | {
          error: string;
        };

    // report error here.
    if (isString(res)) {
      return res;
    }
    throw new Error(res.error);
  };
});

export const topupTagAtom = atom<string | null>(null);
export const topupAmountAtom = atom<number | null>(null);
export const topupToApikeyAtom = atom(async (get) => {
  const tag = get(topupTagAtom);
  const amount = get(topupAmountAtom);

  const everpay = await get(everpayAtom);
  const arseedingBundlerAddress = await get(arseedBundlerAddressAtom);

  return async () => {
    if (!tag) {
      return Promise.reject(new Error("tag can not be null"));
    }
    if (!amount || amount <= 0) {
      return Promise.reject(new Error("amount error"));
    }
    return await everpay.transfer({
      tag,
      amount: amount.toString(),
      to: arseedingBundlerAddress,
      data: { appName: "arseeding", action: "apikeyPayment" },
    });
  };
});
