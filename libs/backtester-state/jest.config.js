module.exports = {
    name: "backtester-state",
    preset: "../../jest.config.js",
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "html"],
    coverageDirectory: "../../coverage/libs/backtester-state",
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
