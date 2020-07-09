import urllib from "url";
import fetch, { RequestInit, RequestInfo } from "node-fetch";
import createHttpsProxyAgent, { HttpsProxyAgentOptions } from "https-proxy-agent";
import https from "https";

export function createProxyAgent(proxy: string) {
    const proxyHost = urllib.parse(proxy);
    const proxyOptions: HttpsProxyAgentOptions = {
        ...proxyHost,
        host: proxyHost.host,
        port: +proxyHost.port
    };

    const agent = new https.Agent();
    Object.assign(agent, createHttpsProxyAgent(proxyOptions));
    return agent;
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
