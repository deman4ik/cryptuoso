module.exports = function (config, context) {
    return {
        ...config,
        entry: {
            ...config.entry,
            worker: `${context.options.root}/${context.options.sourceRoot}/app/worker.ts`
        },
        output: {
            ...config.output,
            filename: "[name].js"
        }
    };
};
