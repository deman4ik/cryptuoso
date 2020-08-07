import { cpz } from "../../../../@types";
import crypto from "crypto";

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

function roleToAccesValue(role: cpz.UserRoles) {
  switch (role) {
    case cpz.UserRoles.anonymous:
      return 20;
    case cpz.UserRoles.user:
      return 15;
    case cpz.UserRoles.vip:
      return 10;
    case cpz.UserRoles.admin:
      return 5;
    default:
      return 20;
  }
}

function getAccessValue(user: {
  roles: {
    allowedRoles: cpz.UserRoles[];
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

export { checkTgLogin, roleToAccesValue, getAccessValue, formatTgName };
