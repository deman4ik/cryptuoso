import * as crypto from "crypto";

export const createKey = (userId: string, pwd: string) => {
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
};
