import crypto from "crypto";
import { UserState } from "@cryptuoso/user-state";

async function checkTgLogin(
    loginData: {
        id: number;
        first_name?: string;
        last_name?: string;
        username?: string;
        photo_url?: string;
        auth_date: number;
        hash: string;
    },
    token: string
) {
    const secret = crypto
        .createHash("sha256")
        .update(token)
        .digest();
    const inputHash = loginData.hash;
    let data: { [key: string]: any } = loginData;
    delete data.hash;
    let array = [];
    for (let key in data) {
        array.push(key + "=" + data[key]);
    }
    array = array.sort();
    const checkString = array.join("\n");
    const checkHash = crypto
        .createHmac("sha256", secret)
        .update(checkString)
        .digest("hex");
    if (checkHash === inputHash) {
        return data;
    } else {
        return false;
    }
}

function roleToAccesValue(role: UserState.UserRoles) {
    switch (role) {
        case UserState.UserRoles.anonymous:
            return 20;
        case UserState.UserRoles.user:
            return 15;
        case UserState.UserRoles.vip:
            return 10;
        case UserState.UserRoles.admin:
            return 5;
        default:
            return 20;
    }
}

function getAccessValue(user: {
    roles: {
        allowedRoles: UserState.UserRoles[];
    };
}): number {
    const {
        roles: { allowedRoles }
    } = user;
    const accessValues = allowedRoles.map(role => roleToAccesValue(role));
    return Math.min(...accessValues);
}

function formatTgName(
    userName?: string,
    firstName?: string,
    lastName?: string
) {
    let name = "";
    if (firstName || lastName)
        name = `${firstName || ""} ${lastName || ""}`.trim();
    else if (userName) name = userName;
    return name;
}

export {
    checkTgLogin,
    roleToAccesValue,
    getAccessValue,
    formatTgName
};
