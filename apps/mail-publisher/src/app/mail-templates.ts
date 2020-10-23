import { TemplateMailType, TemplateMailData } from "@cryptuoso/mail-publisher-events";

export const NOTIFICATIONS_AGGREGATE_SUBJECT = "🔔 Your notifications";

export type stringOrFunction = string | { (data?: any): string };

export function getStringOrFunctionValue(sof: stringOrFunction, data: any) {
    if (typeof sof === "string") return sof;
    if (typeof sof === "function") return sof(data);

    throw new Error(`First argument is bad (${sof})`);
}

export const MAIL_TEMPLATES: {
    [T in TemplateMailType]: {
        subject: string | { (data?: TemplateMailData[T]): string };
        tags: string[];
        body: string | { (data?: TemplateMailData[T]): string };
    };
} = {
    [TemplateMailType.WELCOME]: {
        subject: "🚀 Welcome to Cryptuoso Platform - Please confirm your email.",
        tags: ["auth"],
        body: ({ secretCode, urlData }) => `<p>Greetings!</p>
            <p>Your user account is successfully created!</p>
            <p>Activate your account by confirming your email please click <b><a href="https://cryptuoso.com/auth/activate-account/${urlData}">this link</a></b></p>
            <p>or enter this code <b>${secretCode}</b> manually on confirmation page.</p>`
    },
    [TemplateMailType.USER_ACCOUNT_ACTIVATED]: {
        subject: "🚀 Welcome to Cryptuoso Platform - User Account Activated.",
        tags: ["auth"],
        body: `<p>Congratulations!</p>
        <p>Your user account is successfully activated!</p>
        <p>Now you can login to <b><a href="https://cryptuoso.com/auth/login">your account</a></b> using your email and password.</p>
        <p>Please check out our <b><a href="https://support.cryptuoso.com">Documentation Site</a></b> to get started!</p>`
    },
    [TemplateMailType.PASSWORD_CHANGE_CONFIRMATION]: {
        subject: "🔐 Cryptuoso - Change Password Confirmation.",
        tags: ["auth"],
        body: `
        <p>Your password successfully changed!</p>
        <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    [TemplateMailType.PASSWORD_RESET]: {
        subject: "🔐 Cryptuoso - Password Reset Request.",
        tags: ["auth"],
        body: ({ secretCode, urlData }) => `
        <p>We received a request to reset your password. Please create a new password by clicking <a href="https://cryptuoso.com/auth/confirm-password-reset/${urlData}">this link</a></p>
        <p>or enter this code <b>${secretCode}</b> manually on reset password confirmation page.</p>
        <p>This request will expire in 1 hour.</p>
        <p>If you did not request this change, no changes have been made to your user account.</p>`
    },
    [TemplateMailType.PASSWORD_RESET_CONFIRMATION]: {
        subject: "🔐 Cryptuoso - Reset Password Confirmation.",
        tags: ["auth"],
        body: `
        <p>Your password successfully changed!</p>
        <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    [TemplateMailType.CHANGE_EMAIL]: {
        subject: "🔐 Cryptuoso - Change Email Request.",
        tags: ["auth"],
        body: ({ secretCode }) => `<p>We received a request to change your email.</p>
        <p>Please enter this code <b>${secretCode}</b> to confirm.</p>
        <p>This request will expire in 1 hour.</p>
        <p>If you did not request this change, no changes have been made to your user account.</p>`
    },
    [TemplateMailType.CHANGE_EMAIL_CONFIRMATION]: {
        subject: "🔐 Cryptuoso - Email Change Confirmation.",
        tags: ["auth"],
        body: ({ emailNew }) => `
        <p>Your email successfully changed to ${emailNew}!</p>
        <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    }
};
