interface Type {
    [key: string]: Type | string;
}

function makeSubObjOrGet(obj: Type, prop: string) {
    if (!(prop in obj)) obj[prop] = {};

    return obj[prop] as Type;
}

// TODO: check
export function toTs(str: string) {
    //str = str.replace(/"/g, "`");

    return str.replace(/:\s*"([^"]+)"/g, (full, text: string) => {
        const entries = text?.match(/\${([^}]+)}/g)?.map((name) => name.slice(2, -1));

        if (!entries?.length) return full;

        const types: Type = {};

        for (const o of entries) {
            let obj = types;

            o.split(".").forEach((prop, i, { length }) => {
                prop = prop.trim();

                if (i === length - 1) {
                    obj[prop] = "any";
                    return;
                }

                obj = makeSubObjOrGet(obj, prop);
            });
        }

        return `: ({${Object.keys(types).join(", ")}}: ${JSON.stringify(types).replace(/"/g, "")}) => \`${text}\``;
    });
}

// NOTE: textified objects only
export function fromTSStringToJSON(str: string) {
    return str
        .replace(/:(?!\s*{)[^`"]*`([^`]+)`/g, (full, text: string) => {
            return `: ${JSON.stringify(text)}`;
        })
        .replace(/:\s*"([^"]+)"/g, (full, text) => {
            return `: "${text}"`;
        })
        .replace(/\\\\/g, "\\");
}

function _toJSON(obj: { [key: string]: string | { (): string } }) {
    const res: any = {};

    for (const [key, val] of Object.entries(obj)) {
        let computedVal: any = 0;

        if (typeof val === "string") computedVal = val;
        else if (typeof val === "function") {
            const res = /`.*`/.exec(val.toString());

            if (res?.length) computedVal = res[1];
        }

        res[key] = computedVal;
    }

    return res;
}

export function toJSON(obj: any) {
    JSON.stringify(_toJSON(obj));
}
