const tsFileStruct = require("ts-file-parser");
const fs = require("fs");

const filePath = "./index.d.ts";
const decls = fs.readFileSync(filePath).toString();
const jsonStructure = tsFileStruct.parseStruct(decls, {}, filePath);

const items = [
    ...jsonStructure.functions.map((t) => t.name),
    ...jsonStructure.classes.map((t) => t.name),
    ...jsonStructure.enumDeclarations.map((t) => t.name)
];

let fileContents = `
const nativeBinding = require("./rs-api.node");

const { ${items.join(", ")} } = nativeBinding;

${items.map((item) => `module.exports.${item} = ${item};`).join("\n")}

`;

fs.writeFile("index.js", fileContents, function (err) {
    if (err) {
        console.error(err);
        throw err;
    }
});
