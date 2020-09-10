import Service from "../app/service";
import {
    StatsCalcJob,
    StatsCalcJobType,
    StatsCalcRunnerEvents,
    StatsCalcRunnerSchema
} from "@cryptuoso/stats-calc-events";
import { makeServiceRequest } from "@cryptuoso/test-helpers";
import { sleep } from '@cryptuoso/helpers';

describe("Testing stats-calc-runner service", () => {
    //const CONFIG = { port: 5678 };
    const service = new Service(/* CONFIG */);
    
    test("Testing request", async () => {
        await service.startService();

        const res = await makeServiceRequest({
            //port: CONFIG.port,
            actionName: "wrong",
            userId: "user-id",
            input: {
                calcAll: true,
                userId: "asffd",
                robotId: "asfds"
            }
        });

        console.warn(res);
        
        await sleep(1000);
    });
});
