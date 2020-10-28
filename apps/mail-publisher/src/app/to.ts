interface Type {
    [key: string]: Type | string;
}

function makeSubObjOrGet(obj: Type, prop: string) {
    if (!(prop in obj)) obj[prop] = {};

    return obj[prop] as Type;
}

export function toTs(str: string) {
    //str = str.replace(/"/g, "`");

    return str.replace(/:\s*"([^"]+)"/g, (full, text: string) => {
        const entries = text?.match(/\$\{([^\}]+)\}/g)?.map(name => name.slice(2, -1));
        
        if (!entries?.length) return full;

        const types: Type = {};
        
        for (const o of entries) {
            let obj = types;

            o.split('.').forEach((prop, i, { length }) => {
                if (i === length - 1) {
                    obj[prop] = "string";
                    return;
                }

                obj = makeSubObjOrGet(obj, prop);
            });
        }

        return `: ({${Object.keys(types).join(", ")}}: ${JSON.stringify(types).replace(/"/g, "")}) => \`${text}\``;
    });
}
