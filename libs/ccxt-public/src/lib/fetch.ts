import { URL } from "url";
import fetch, { RequestInit, RequestInfo } from "node-fetch";
import createHttpsProxyAgent, { HttpsProxyAgentOptions } from "https-proxy-agent";
import fs from "fs";
import path from "path";
import { SocksProxyAgent } from "socks-proxy-agent";

const ca = fs.readFileSync(path.resolve(__dirname, "assets/ca.crt"));

export function createProxyAgent(proxy: string) {
    const proxyHost = new URL(`http://${proxy}`);
    const proxyOptions: HttpsProxyAgentOptions = {
        ...proxyHost,
        host: proxyHost.host,
        port: +proxyHost.port,
        ca
    };
    return createHttpsProxyAgent(proxyOptions);
}

export function createSocksProxyAgent(proxy: string) {
    const proxyHost = new URL(`socks://${proxy}`);
    const proxyOptions: HttpsProxyAgentOptions = {
        ...proxyHost,
        host: proxyHost.host,
        port: +proxyHost.port,
        ca
    };
    return new SocksProxyAgent(proxyOptions);
}

export function createFetchMethod(proxy: string) {
    if (!proxy) return fetch;
    const agent = createProxyAgent(proxy);
    return async function fetchInterface(url: RequestInfo, options: RequestInit) {
        return fetch(url, {
            ...options,
            agent,
            headers: { ...options.headers, Connection: "keep-alive" }
        });
    };
}
