export const MAIL_SUBJECTS = {
    WELCOME: "🚀 Welcome to Cryptuoso Platform - User Account Activated.",
    CHANGE_EMAIL: "🔐 Cryptuoso - Change Email Request.",
    CHANGE_EMAIL_CONFIRM: "🔐 Cryptuoso - Email Change Confirmation.",
    RESET_PASSWORD: "🔐 Cryptuoso - Reset Password Confirmation.",
    RESET_PASSWORD_CONFIRM: "🔐 Cryptuoso - Password Reset Request.",
    CHANGE_PASSWORD_CONFIRM: "🔐 Cryptuoso - Change Password Confirmation.",
    SUPPORT_REPLY: "Message from support from cryptuoso.com",
    SIGNAL_ALERT: "🚨 New Signal!",
    SIGNAL_TRADE: "🚨✅ New Signal Trade!",
    USER_EX_ACC_ERROR: "❌ Error with your API Key",
    ROBOT_CHANGE_STATUS: (status: string): string => `🤖 Robot <b> is ${status}!`,
    ROBOT_FAILED: "❌ Error occurred while processing robot job",
    ROBOT_ORDER_ERROR: "❌ Error occurred while processing order"
};
