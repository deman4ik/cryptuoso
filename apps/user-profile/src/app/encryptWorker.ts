import { expose } from "threads";
import { EncryptedData } from "@cryptuoso/user-state";
import * as crypto from "crypto";
import { createKey } from "@cryptuoso/helpers";

const pwd = process.env.ENCRYPTION_PWD;

function encrypt(userId: string, data: string): EncryptedData {
    const key = createKey(userId, pwd);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let crypted = cipher.update(data, "utf8", "hex");
    crypted += cipher.final("hex");

    return { iv: iv.toString("hex"), data: crypted } as any;
}

export type Encrypt = typeof encrypt;

expose(encrypt);
