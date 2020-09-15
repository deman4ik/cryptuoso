import crypto from "crypto";

export function makeTgHash(
    loginData: {
        id: number;
        first_name?: string;
        last_name?: string;
        username?: string;
        photo_url?: string;
        auth_date: number;
    },
    token: string
) {
    const secret = crypto.createHash("sha256").update(token).digest();
    const data: { [key: string]: any } = loginData;
    delete data.hash;
    let array = [];
    for (const key in data) {
        array.push(key + "=" + data[key]);
    }
    array = array.sort();
    const checkString = array.join("\n");
    const checkHash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");

    return checkHash;
}
