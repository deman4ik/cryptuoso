import { expose } from "threads/worker";

export const worker = {
    async run() {
        return;
    }
};
export type Worker = typeof worker;
expose(worker);
