import { EncryptedData } from "@cryptuoso/user-state";
import * as crypto from "crypto";
import { createKey } from "@cryptuoso/helpers";

const pwd = process.env.ENCRYPTION_PWD;

export function decrypt(userId: string, encryptedData: EncryptedData): string {
    const key = createKey(userId, pwd);
    const iv = Buffer.from(encryptedData.iv, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encryptedData.data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
