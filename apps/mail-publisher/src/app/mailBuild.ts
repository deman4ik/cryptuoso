// libs
import { TEMPLATE_TYPES, SendProps } from "@cryptuoso/mail";
// types
import { SendWelcome } from "@cryptuoso/mail-publisher-events";

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

/*Типы сообщений*/
const MAIL_TYPES: {
    [key: string]: (data: any) => any;
} = {
    welcome: welcomeMail
};

const mailBuild = (type: string, data: any, templateType?: string): SendProps => ({
    ...MAIL_TYPES[type](data),
    template: TEMPLATE_TYPES[templateType] || TEMPLATE_TYPES.main
});

export default mailBuild;
