module.exports = {
    name: "trade-statistics",
    preset: "../../jest.config.js",
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "html"],
    coverageDirectory: "../../coverage/libs/trade-statistics",
    verbose: true,
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
