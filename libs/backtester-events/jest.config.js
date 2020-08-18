module.exports = {
    name: "backtester-events",
    preset: "../../jest.config.js",
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "html"],
    coverageDirectory: "../../coverage/libs/backtester-events",
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
