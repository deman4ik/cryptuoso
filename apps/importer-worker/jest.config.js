module.exports = {
    name: "importer-worker",
    preset: "../../jest.config.js",
    coverageDirectory: "../../coverage/apps/importer-worker",
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
