import { parse as urllibParse } from "url";

export function parseURL(url: string) {
    let parsed = urllibParse(url, true, true);

    if (!parsed.slashes && url[0] !== "/") {
        url = "//" + url;
        parsed = urllibParse(url, true, true);
    }

    const result: any = { tls: true };
    if (parsed.auth) {
        const index = parsed.auth.indexOf(":");
        result.username = index === -1 ? parsed.auth : parsed.auth.slice(0, index);
        result.password = index === -1 ? "" : parsed.auth.slice(index + 1);
    }

    if (parsed.host) {
        result.host = parsed.hostname;
    }
    if (parsed.port) {
        result.port = parsed.port;
    }

    return result;
}
