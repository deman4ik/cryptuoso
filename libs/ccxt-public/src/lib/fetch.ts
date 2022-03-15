import urlib from "url";
import createHttpsProxyAgent, { HttpsProxyAgentOptions } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export function createProxyAgent(proxy: string) {
    const proxyHost = urlib.parse(`http://${proxy}`);
    const proxyOptions: HttpsProxyAgentOptions = {
        ...proxyHost,
        host: proxyHost.host,
        port: +proxyHost.port
    };

    return createHttpsProxyAgent(proxyOptions);
}

export function createSocksProxyAgent(proxy: string) {
    const proxyHost = urlib.parse(`socks://${proxy}`);
    const proxyOptions: HttpsProxyAgentOptions = {
        ...proxyHost,
        host: proxyHost.host,
        port: +proxyHost.port
    };

    return new SocksProxyAgent(proxyOptions);
}
