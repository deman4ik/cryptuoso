import { round } from "@cryptuoso/helpers";
import os from "os";
const appmetrics = require("appmetrics");
const monitoring = appmetrics.monitor();

const cpus = os.cpus().length;

//const round = (n: number, decimals = 0): number => +Number(`${Math.round(+`${n}e${decimals}`)}e-${decimals}`);

class Index {
    private _sum: number;
    private _count: number;
    private _max: number;
    private _min: number;

    private get min() { return this._min; }
    private get max() { return this._max; }
    private get avg() { return this._sum / this._count; }

    constructor() {
        this.clear();
    }

    clear() {
        this._sum = 0;
        this._count = 0;
        this._max = null;
        this._min = null;
    }

    add(value: number) {
        this._sum += value;
        ++this._count;

        if(this._min == null || value < this._min)
            this._min = value;

        if(this._max == null || value > this._max)
            this._max = value;
    }
    
    getResults() {
        return {
            min: round(this.min, 1),
            max: round(this.max, 1),
            avg: round(this.avg, 1),
            cnt: round(this._count, 1)
        };
    }
};

export default class Monitoring {
    private _started: boolean = false;
    private startTime: number;
    private endTime: number = null;

    private cpu: Index = new Index;
    private memory: Index = new Index;

    constructor() {
        monitoring.on('cpu', (arg: any) => {
            if(this._started)
                this.cpu.add(arg.process * cpus * 100);
        });

        monitoring.on('memory', (arg: any) => {
            if(this._started)
                this.memory.add(arg.physical / 1024 / 1024);
        });
    }

    clear() {
        this.startTime = this._started ? Date.now() : null;
        this.endTime = null;
        this.cpu.clear();
        this.memory.clear();
    }

    getMetricks() {
        return {
            time: (this._started ? Date.now() : this.endTime) - this.startTime,
            cpu: this.cpu.getResults(),
            memory: this.memory.getResults()
        };
    }

    start() {
        if(this._started)
            return;

        this._started = true;
        this.startTime = this.startTime == null ?
            Date.now() :
            Date.now() - (this.endTime - this.startTime);
        this.endTime = null;

        return this;
    }

    stop() {
        this._started = false;
        this.endTime = Date.now();

        return this;
    }
};