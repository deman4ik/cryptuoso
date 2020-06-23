module.exports = function (config, context) {
    return {
        ...config,
        entry: {
            ...config.entry,
            importerUtilsWorker: `${context.options.root}/${context.options.sourceRoot}/app/importerUtilsWorker.ts`
        },
        output: {
            ...config.output,
            filename: "[name].js"
        }
    };
};
