import log from "@cryptuoso/logger";
import Monitoring from "./monitoring";

/**
 * For using set `process.env.ENABLE_APP_METRICS = "true"`
 */
export async function startSeveralFunctions(func: { (): Promise<any> }, copiesCount = 10) {
    const argArr = [];
    const errors: Error[] = [];
    for (let i = 0; i < copiesCount; ++i)
        argArr.push(
            func().catch((e) => {
                //console.log("Function Error: ", e.message);
                errors.push(e);
                return e;
            })
        );
    const results = await Promise.all(argArr);
    return { copiesCount, results, errors };
}

/**
 * For using set `process.env.ENABLE_APP_METRICS = "true"`
 */
export async function measureFunction(
    name: string,
    func: { (...args: any): Promise<any> },
    args: any[],
    copiesCount = 10
) {
    /* log.info("Call GC");
    global.gc(); */
    const monitor = new Monitoring();

    log.info(`${name} starts`);

    monitor.clear();
    monitor.start();

    const res = await startSeveralFunctions(async () => {
        return await func(...args);
    }, copiesCount);

    monitor.stop();
    log.info(`${name} ends`);
    return { name, args, ...res, ...monitor.getMetricks() };
}
