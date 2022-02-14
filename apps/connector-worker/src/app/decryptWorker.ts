import { expose } from "threads";
import { decrypt } from "@cryptuoso/ccxt-private";

export type Decrypt = typeof decrypt;

expose(decrypt);
