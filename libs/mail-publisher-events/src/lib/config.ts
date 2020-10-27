import { TemplateMailType, MailTags } from "./mail-publisher-events";
import { UserSettings } from "@cryptuoso/user-state";
import dayjs from "@cryptuoso/dayjs";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/* export enum LIST {
    SIGNALS = "signals",
    TRADING = "trading"
} */

class Config {
    private threshold: number;
    private typesByTag = new Map<MailTags, TemplateMailType[]>();
    private tagByType = new Map<TemplateMailType, MailTags>();

    constructor(
        threshold: number,
        typesByTags: {
            [key in MailTags]?: TemplateMailType[];
        }
    ) {
        this.threshold = threshold;

        for (const [tag, types] of Object.entries(typesByTags)) {
            this.typesByTag.set(tag as MailTags, Array.from(types));

            for (const type of types) {
                if (this.tagByType.has(type)) throw new Error(`Type duplication (${type})`);
                this.tagByType.set(type, tag as MailTags);
            }
        }
    }

    getThresholdTimeString() {
        return dayjs.utc(Date.now() - this.threshold).toISOString();
    }

    getTagNameByType(type: TemplateMailType) {
        return this.tagByType.get(type);
    }

    getTypesByTag(tag: MailTags) {
        return Array.from(this.typesByTag.get(tag) || []);
    }

    getTypesByTags(tags: MailTags[]) {
        return tags.reduce((acc: TemplateMailType[], tag) => {
            acc.push(...this.getTypesByTag(tag));
            return acc;
        }, []);
    }

    getImpossibleTypes(userSettings: UserSettings) {
        return Object.entries(userSettings?.notifications || {}).reduce((acc: TemplateMailType[], [tag, info]) => {
            if (info?.email === false) acc.push(...this.getTypesByTag(tag as MailTags));
            return acc;
        }, []);
    }

    checkNotificationType(userSettings: UserSettings, type: TemplateMailType) {
        const tag = this.tagByType.get(type);

        if (!tag) return true;

        /* if (list in userSettings.notifications) {
            return !!userSettings.notifications[list].email
        }
        else return true; */

        return !!(userSettings.notifications as any)[tag].email;
    }
}

export const mailPublisherConfig = new Config(DAY, {
    [MailTags.SIGNALS]: [],
    [MailTags.TRADING]: []
});
