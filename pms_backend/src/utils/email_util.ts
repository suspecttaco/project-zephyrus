import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

export const sendMail = async (to: string, subject: string, html: string): Promise<boolean> => {
    try {
        const status = await transporter.sendMail({
            from: process.env.SMTP_FROM || 'no-reply@pms.com',
            to,
            subject,
            html
        });
        return !!status.messageId;
    } catch (error: any) {
        console.error(`[ERROR] Fallo al enviar email => ${error.message}`);
        return false;
    }
};
