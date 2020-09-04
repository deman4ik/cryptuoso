import log from "@cryptuoso/logger";
import Monitoring from "./monitoring";

/**
 * For using set `process.env.ENABLE_APP_METRICS = "true"`
 */
export async function startSeveralFunctions(func: { (): Promise<any> }, copiesCount: number = 10) {
    const argArr = [];
    let errorsCount = 0;
    for (let i = 0; i < copiesCount; ++i)
        argArr.push(func().catch((e) => {
            //console.log("Function Error: ", e.message);
            ++errorsCount;
            return e.message;
        }));
    const errors = Array.from(new Set(await Promise.all(argArr))).filter((el) => el);
    return { copiesCount, errorsCount, errors };
}

/**
 * For using set `process.env.ENABLE_APP_METRICS = "true"`
 */
export async function measureFunction(
    name: string,
    func: { (...args: any): Promise<any> },
    args: any[],
    copiesCount: number = 10
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
