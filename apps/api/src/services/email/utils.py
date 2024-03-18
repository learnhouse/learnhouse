from pydantic import EmailStr
import resend
from config.config import get_learnhouse_config


def send_email(to: EmailStr, subject: str, body: str):
    lh_config = get_learnhouse_config()
    params = {
        "from": "LearnHouse <" + lh_config.mailing_config.system_email_address + ">",
        "to": [to],
        "subject": subject,
        "html": body,
    }

    resend.api_key = lh_config.mailing_config.resend_api_key
    email = resend.Emails.send(params)

    return email
        
