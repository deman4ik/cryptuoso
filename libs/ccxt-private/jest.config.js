module.exports = {
    displayName: "ccxt-private",
    preset: "../../jest.preset.js",
    globals: {
        "ts-jest": {
            tsConfig: "<rootDir>/tsconfig.spec.json"
        }
    },
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
    coverageDirectory: "../../coverage/libs/ccxt-private"
};
