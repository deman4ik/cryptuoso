const yargs = require("yargs");

let e2eRule;

if ("e2e" in yargs.argv) {
    e2eRule = "e2e\\.(spec|test)";
} else e2eRule = "(?<!\\.e2e\\.)(spec|test)";

module.exports = {
    testMatch: [`**/+(*.)+(${e2eRule}).+(ts|js)?(x)`],
    transform: {
        "^.+\\.(ts|js|html)$": "ts-jest"
    },
    resolver: "@nrwl/jest/plugins/resolver",
    moduleFileExtensions: ["ts", "js", "html"],
    coverageReporters: ["html"],
    setupFilesAfterEnv: ["jest-extended"]
};
