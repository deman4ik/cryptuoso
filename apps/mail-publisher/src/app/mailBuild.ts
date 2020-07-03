//TODO:  расрашить строковые ключи между сервисами
import { TEMPLATE_TYPES, SendProps } from "@cryptuoso/mail";
// types
import {
    SendWelcome,
    signalAlertDataType,
    userExAccErrDataType,
    userRobotStatusDataType,
    userRobotFailedDataType,
    orderErrorDataType,
    NOTIFICATIONS_TYPES
} from "@cryptuoso/mail-publisher-events";
/*====Mail builders utils====*/
// todo: Вынести в общие утилы
const formatMessageHTML = (htmlString: string): string => htmlString.replace(/(?:\r\n|\r|\n)/g, "<br />");

/*====Mail builders====*/

/*Сообщение об успешной регистрации*/
const welcomeMail = ({ email, secretCode, urlData }: SendWelcome) => ({
    to: email,
    subject: "🚀 Welcome to Cryptuoso Platform - Please confirm your email.",
    variables: {
        body: `<p>Greetings!</p>
            <p>Your user account is successfully created!</p>
            <p>Activate your account by confirming your email please click <b><a href="https://cryptuoso.com/auth/activate-account/${urlData}">this link</a></b></p>
            <p>or enter this code <b>${secretCode}</b> manually on confirmation page.</p>`
    },
    tags: ["auth"]
});

/*Билдер   обычных писем*/
const MAIL_TYPES: {
    [key: string]: (data: any) => any;
} = {
    welcome: welcomeMail
};

const mailBuild = (type: string, data: any, templateType?: string): SendProps => ({
    ...MAIL_TYPES[type](data),
    template: TEMPLATE_TYPES[templateType] || TEMPLATE_TYPES.main
});

/*body темплейты*/
const defaultBody = ({ message }: any) => `<div class="mail_item_container">${formatMessageHTML(message)}</div>`;

const signalAlert = ({ code }: signalAlertDataType) =>
    `<div class="mail_item_container"> <h3>🚨 New Signal! 🤖 Robot:#${code}</h3></div>`;

const signalTrade = ({ code }: signalAlertDataType) =>
    `<div class="mail_item_container"> <h3>🚨✅ New Signal Trade! 🤖 Robot:#${code}</h3></div>`;

const userExAccErr = ({ name, error }: userExAccErrDataType) =>
    `<div class="mail_item_container"> ❌ Your API Key 🔐 ${name} is invalid! <br>${error} <br> Please update your API Key information in settings.</h3></div>`;

const userRobotStatuses = ({ status, code, message }: userRobotStatusDataType) =>
    `<div class="mail_item_container">🤖 Robot <b>#${code}</b> is ${status} now! <br>${message}</div>`;

const userRobotFailed = ({ jobType, id, error, code }: userRobotFailedDataType) =>
    `<div class="mail_item_container">❌ Error occurred while processing robot job <b>${jobType}</b>.<br>${error} 🤖 <b>#${code}</b> (${id})<br>Please contact support.</div>`;

const orderError = ({ exId, error, code, id }: orderErrorDataType) =>
    `<div class="mail_item_container">❌ Error occurred while processing order <b>${exId}</b>.${error} <br> 🤖 <b>#${code}</b> (${id}) <br> Please check your API Keys and Robot settings or contact support.`;

const BODY_TYPES: { [key: string]: (data: any) => any } = {
    default: defaultBody,
    [NOTIFICATIONS_TYPES.SIGNAL_ALERT]: signalAlert,
    [NOTIFICATIONS_TYPES.SIGNAL_TRADE]: signalTrade,
    [NOTIFICATIONS_TYPES.USER_EX_ACC_ERROR]: userExAccErr,
    robotStatuses: userRobotStatuses,
    [NOTIFICATIONS_TYPES.USER_ROBOT_FAILED]: userRobotFailed,
    [NOTIFICATIONS_TYPES.ORDER_ERROR]: orderError
};

const emailBodyBuilder = (bodyType: string, data: any): string => BODY_TYPES[bodyType](data);

export { emailBodyBuilder, mailBuild };
