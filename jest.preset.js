const nxPreset = require("@nrwl/jest/preset");
const yargs = require("yargs");

let e2eRule;

if ("e2e" in yargs.argv) {
    e2eRule = "e2e\\.(spec|test)";
} else e2eRule = "(?<!\\.e2e\\.)(spec|test)";

module.exports = {
    ...nxPreset,
    testMatch: [`**/+(*.)+(${e2eRule}).+(ts|js)?(x)`],
    globals: {
        "ts-jest": {
            tsconfig: "<rootDir>/tsconfig.spec.json"
        }
    },
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "js"],
    coverageReporters: ["html"],
    setupFilesAfterEnv: ["jest-extended"]
};
