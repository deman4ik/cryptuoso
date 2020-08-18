module.exports = {
    name: "postgres",
    preset: "../../jest.config.js",
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "html"],
    coverageDirectory: "../../coverage/libs/postgres",
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
