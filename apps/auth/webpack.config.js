module.exports = function (config, context) {
    return {
        ...config,
        entry: {
            ...config.entry,
            bcryptWorker: `${context.options.root}/${context.options.sourceRoot}/app/bcryptWorker.ts`
        },
        output: {
            ...config.output,
            filename: "[name].js"
        }
    };
};
