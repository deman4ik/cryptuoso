import { expose, isWorkerRuntime } from "threads";
import { EncryptedData } from "@cryptuoso/user-state";
import * as crypto from "crypto";

const pwd = process.env.ENCRYPTION_PWD;

//console.log(process.env.ENCRYPTION_PWD, crypto.scryptSync);

function createKey(userId: string) {
    const userKeys = userId.split("-");
    const pwdKeys = pwd.split("-");
    const pass = [
        pwdKeys[2],
        userKeys[4],
        pwdKeys[3],
        userKeys[1],
        userKeys[0],
        pwdKeys[0],
        pwdKeys[1],
        userKeys[2],
        pwdKeys[4],
        userKeys[3]
    ].join("");

    return (crypto as any).scryptSync(pass, "salt", 32);
}

function encrypt(userId: string, data: string): EncryptedData {
    const key = createKey(userId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let crypted = cipher.update(data, "utf8", "hex");
    crypted += cipher.final("hex");

    return { iv: iv.toString("hex"), data: crypted } as any;
}

export type Encrypt = typeof encrypt;

//if(isWorkerRuntime())
expose(encrypt);
