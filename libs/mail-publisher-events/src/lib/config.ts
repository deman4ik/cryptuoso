import { TemplateMailType } from "./mail-publisher-events";
import { UserSettings } from "@cryptuoso/user-state";
import dayjs from "@cryptuoso/dayjs";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export enum LIST {
    SIGNALS = "signals",
    TRADING = "trading"
}

class Config {
    private threshold: number;
    private typesByList = new Map<LIST, TemplateMailType[]>();
    private listByType = new Map<TemplateMailType, LIST>();

    constructor(
        threshold: number,
        typesByLists: {
            [key in LIST]?: TemplateMailType[];
        }
    ) {
        this.threshold = threshold;

        for (const [list, types] of Object.entries(typesByLists)) {
            this.typesByList.set(list as LIST, Array.from(types));

            for (const type of types) {
                if (this.listByType.has(type)) throw new Error(`Type duplication (${type})`);
                this.listByType.set(type, list as LIST);
            }
        }
    }

    getThresholdTimeString() {
        return dayjs.utc(Date.now() - this.threshold).toISOString();
    }

    getListNameByType(type: TemplateMailType) {
        return this.listByType.get(type);
    }

    getTypesByList(list: LIST) {
        return Array.from(this.typesByList.get(list) || []);
    }

    getTypesByLists(lists: LIST[]) {
        return lists.reduce((acc: TemplateMailType[], list) => {
            acc.push(...this.getTypesByList(list));
            return acc;
        }, []);
    }

    getImpossibleTypes(userSettings: UserSettings) {
        return Object.entries(userSettings?.notifications || {})
            .reduce((acc: TemplateMailType[], [list, info]) => {
                if (info?.email === false)
                    acc.push(...this.getTypesByList(list as LIST));
                return acc;
            }, []);
    }

    checkNotification(userSettings: UserSettings, notification: { type: TemplateMailType /* , createdAt?: string */ }) {
        const list = this.listByType.get(notification.type);

        if (!list) return true;

        return !!userSettings.notifications[list].email;
    }
}

export const mailPublisherConfig = new Config(DAY, {
    [LIST.SIGNALS]: [],
    [LIST.TRADING]: []
});
