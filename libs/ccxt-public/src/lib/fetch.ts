import urllib from "url";
import socks from "@luminati-io/socksv5";

export function createSocksProxyAgent(proxy: string) {
    const proxyParams = urllib.parse(proxy);
    return new socks.HttpsAgent({
        proxyHost: proxyParams.hostname,
        proxyPort: 1080,
        auths: [socks.auth.UserPassword(proxyParams.auth.split(":")[0], proxyParams.auth.split(":")[1])]
    });
}
