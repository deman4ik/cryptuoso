// libs
import { TEMPLATE_TYPES, SendProps } from "@cryptuoso/mail";
import { formatHTML } from "@cryptuoso/helpers";
// types
import {
    SendWelcome,
    SendChangeEmail,
    SendChangeEmailConfirm,
    SendPasswordReset,
    SendPasswordChangeConfirm,
    SendPasswordResetConfirm,
    signalAlertDataType,
    userExAccErrDataType,
    userRobotStatusDataType,
    userRobotFailedDataType,
    orderErrorDataType,
    NOTIFICATIONS_TYPES
} from "@cryptuoso/mail-publisher-events";
// local constants
import { MAIL_SUBJECTS } from "./constants";

/*Щаблоны для обычных писем*/
const welcomeMail = ({ email, secretCode, urlData }: SendWelcome) => ({
    to: email,
    subject: MAIL_SUBJECTS.WELCOME,
    variables: {
        body: `<p>Greetings!</p>
            <p>Your user account is successfully created!</p>
            <p>Activate your account by confirming your email please click <b><a href="https://cryptuoso.com/auth/activate-account/${urlData}">this link</a></b></p>
            <p>or enter this code <b>${secretCode}</b> manually on confirmation page.</p>`
    },
    tags: ["auth"]
});

const changeEmail = ({ email, secretCode }: SendChangeEmail) => ({
    to: email,
    subject: MAIL_SUBJECTS.CHANGE_EMAIL,
    variables: {
        body: `<p>We received a request to change your email.</p>
          <p>Please enter this code <b>${secretCode}</b> to confirm.</p>
          <p>This request will expire in 1 hour.</p>
          <p>If you did not request this change, no changes have been made to your user account.</p>`
    },
    tags: ["auth"]
});

const changeEmailConfirm = ({ email, emailNew }: SendChangeEmailConfirm) => ({
    to: email,
    subject: MAIL_SUBJECTS.CHANGE_EMAIL_CONFIRM,
    variables: {
        body: `
            <p>Your email successfully changed to ${emailNew}!</p>
            <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    tags: ["auth"]
});

const passwordReset = ({ email, secretCode, urlData }: SendPasswordReset) => ({
    to: email,
    subject: MAIL_SUBJECTS.RESET_PASSWORD,
    variables: {
        body: `
            <p>We received a request to reset your password. Please create a new password by clicking <a href="https://cryptuoso.com/auth/confirm-password-reset/${urlData}">this link</a></p>
            <p>or enter this code <b>${secretCode}</b> manually on reset password confirmation page.</p>
            <p>This request will expire in 1 hour.</p>
            <p>If you did not request this change, no changes have been made to your user account.</p>`
    },
    tags: ["auth"]
});

const passwordChangeConfirm = ({ email }: SendPasswordChangeConfirm) => ({
    to: email,
    subject: MAIL_SUBJECTS.CHANGE_PASSWORD_CONFIRM,
    variables: {
        body: `
            <p>Your password successfully changed!</p>
            <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    tags: ["auth"]
});

const passwordResetConfirm = ({ email }: SendPasswordResetConfirm) => ({
    to: email,
    subject: MAIL_SUBJECTS.RESET_PASSWORD_CONFIRM,
    variables: {
        body: `
            <p>Your password successfully changed!</p>
            <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    tags: ["auth"]
});

const MAIL_TYPES: {
    [key: string]: (data: any) => any;
} = {
    welcome: welcomeMail,
    changeEmail,
    changeEmailConfirm,
    passwordReset,
    passwordChangeConfirm,
    passwordResetConfirm
};

/*Функция билда обычных писем*/
const mailBuild = (type: string, data: any, templateType?: string): SendProps => ({
    ...MAIL_TYPES[type](data),
    template: TEMPLATE_TYPES[templateType] || TEMPLATE_TYPES.main
});

/*Шаблоны body для email писем с нотифиткациями*/
const defaultBody = ({ message }: any) => `<div class="mail_item_container">${formatHTML(message)}</div>`;

const signalAlert = ({ code }: signalAlertDataType) =>
    `<div class="mail_item_container"> 🚨 New Signal! 🤖 Robot:#${code}</div>`;

const signalTrade = ({ code }: signalAlertDataType) =>
    `<div class="mail_item_container"> 🚨✅ New Signal Trade! 🤖 Robot:#${code}</div>`;

const userExAccErr = ({ name, error }: userExAccErrDataType) =>
    `<div class="mail_item_container">
      <div class="mail_item_text">❌ Your API Key 🔐 <b>#${name}</b> is invalid!</div>
      <div class="error mail_item_text">${error}</div> 
      Please update your API Key information in settings
    </div>`;

const userRobotStatuses = ({ status, code, message }: userRobotStatusDataType) =>
    `<div class="mail_item_container"> 
        <div class="mail_item_text">🤖 Robot <b>#${code}</b> is ${status} now! </div>
         <div class="mail_item_text">${message}</div>
     </div>`;

const userRobotFailed = ({ jobType, id, error, code }: userRobotFailedDataType) =>
    `<div class="mail_item_container">
        <div class="mail_item_text">
            ❌ Error occurred while processing robot job
            <b>${jobType}</b>.
        </div>
        <div class="mail_item_text error">${error}</div> 
        <div class="mail_item_text">🤖<b>#${code}</b> (${id})<br>Please contact support.</div>
     </div>`;

const orderError = ({ exId, error, code, id }: orderErrorDataType) =>
    `<div class="mail_item_container">
        <div class="mail_item_text">
          ❌ Error occurred while processing order
          <b>${exId}</b>.
        </div>
        <div class="mail_item_text error">${error}</div>
        <div class="mail_item_text">🤖<b>#${code}</b> (${id})<br>Please check your API Keys and Robot settings or contact support.</div>
     </div>`;

const BODY_TYPES: { [key: string]: (data: any) => any } = {
    default: defaultBody,
    [NOTIFICATIONS_TYPES.SIGNAL_ALERT]: signalAlert,
    [NOTIFICATIONS_TYPES.SIGNAL_TRADE]: signalTrade,
    [NOTIFICATIONS_TYPES.USER_EX_ACC_ERROR]: userExAccErr,
    robotStatuses: userRobotStatuses,
    [NOTIFICATIONS_TYPES.USER_ROBOT_FAILED]: userRobotFailed,
    [NOTIFICATIONS_TYPES.ORDER_ERROR]: orderError
};

/*Билдер  шаблонов body для нотификаций*/
const emailBodyBuilder = (bodyType: string, data: any): string => BODY_TYPES[bodyType](data);

export { emailBodyBuilder, mailBuild };
