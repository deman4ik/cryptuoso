import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";

export type ExwatcherRunnerServiceConfig = HTTPServiceConfig;

export default class ExwatcherRunnerService extends HTTPService {
    constructor(config?: ExwatcherRunnerServiceConfig) {
        super(config);
    }
}
