import html
from urllib.parse import quote

from pydantic import EmailStr
from src.db.organizations import OrganizationRead
from src.db.users import UserRead
from src.services.email.utils import send_email


# Inline SVG logo (LearnHouse icon mark + wordmark, scaled down)
LOGO_SVG = """<svg width="140" height="20" viewBox="0 0 1488 218" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M152 37C152 56.96 148.07 76.73 140.43 95.17C132.79 113.61 121.6 130.37 107.48 144.48C93.37 158.6 76.61 169.79 58.17 177.43C39.73 185.07 19.96 189 0 189V115.94C10.37 115.94 20.63 113.9 30.21 109.93C39.79 105.96 48.49 100.15 55.82 92.82C63.15 85.49 68.97 76.79 72.93 67.21C76.9 57.63 78.94 47.37 78.94 37H152Z" fill="black"/>
<path d="M304 189C284.04 189 264.27 185.07 245.83 177.43C227.39 169.79 210.63 158.6 196.52 144.48C182.4 130.37 171.21 113.61 163.57 95.17C155.93 76.73 152 56.96 152 37H225.06C225.06 47.37 227.1 57.63 231.07 67.21C235.03 76.79 240.85 85.49 248.18 92.82C255.51 100.15 264.21 105.96 273.79 109.93C283.37 113.9 293.63 115.94 304 115.94V189Z" fill="black"/>
<path d="M397.2 27.36V191H358.14V27.36H397.2ZM465.94 193.32C453.1 193.32 442.03 190.79 432.7 185.73C423.44 180.61 416.3 173.34 411.29 163.91C406.34 154.43 403.86 143.17 403.86 130.12C403.86 117.44 406.36 106.36 411.37 96.88C416.38 87.34 423.44 79.94 432.54 74.66C441.65 69.34 452.39 66.67 464.75 66.67C473.48 66.67 481.47 68.03 488.72 70.75C495.96 73.47 502.22 77.49 507.49 82.81C512.77 88.14 516.87 94.72 519.8 102.55C522.73 110.33 524.19 119.25 524.19 129.32V139.07H417.52V116.37H487.84C487.78 112.22 486.8 108.52 484.88 105.27C482.96 102.02 480.33 99.49 476.97 97.68C473.67 95.81 469.86 94.88 465.54 94.88C461.18 94.88 457.26 95.87 453.8 97.84C450.34 99.75 447.59 102.39 445.57 105.75C443.55 109.05 442.48 112.8 442.37 117.01V140.1C442.37 145.11 443.36 149.5 445.33 153.29C447.3 157.02 450.1 159.92 453.72 162C457.34 164.07 461.66 165.11 466.66 165.11C470.13 165.11 473.27 164.63 476.09 163.67C478.91 162.72 481.34 161.3 483.36 159.44C485.39 157.58 486.9 155.28 487.92 152.57L523.79 153.61C522.3 161.65 519.02 168.65 513.96 174.62C508.96 180.53 502.38 185.14 494.23 188.44C486.08 191.69 476.65 193.32 465.94 193.32ZM565.24 193.08C557.41 193.08 550.46 191.77 544.39 189.16C538.37 186.5 533.6 182.5 530.09 177.18C526.62 171.8 524.89 165.06 524.89 156.96C524.89 150.14 526.09 144.39 528.49 139.7C530.89 135.02 534.19 131.21 538.4 128.28C542.6 125.35 547.45 123.14 552.94 121.65C558.42 120.1 564.28 119.06 570.52 118.53C577.5 117.89 583.11 117.22 587.38 116.53C591.64 115.79 594.73 114.75 596.64 113.42C598.62 112.03 599.6 110.09 599.6 107.58V107.18C599.6 103.08 598.19 99.91 595.37 97.68C592.54 95.44 588.73 94.32 583.94 94.32C578.77 94.32 574.62 95.44 571.48 97.68C568.33 99.91 566.34 103 565.48 106.95L529.45 105.67C530.51 98.21 533.26 91.55 537.68 85.69C542.15 79.78 548.28 75.14 556.06 71.79C563.88 68.38 573.29 66.67 584.26 66.67C592.09 66.67 599.31 67.61 605.91 69.47C612.52 71.28 618.27 73.95 623.17 77.46C628.07 80.92 631.85 85.19 634.52 90.25C637.23 95.31 638.59 101.08 638.59 107.58V191H601.84V173.9H600.88C598.7 178.06 595.9 181.57 592.49 184.45C589.13 187.32 585.16 189.48 580.58 190.92C576.06 192.36 570.94 193.08 565.24 193.08ZM577.31 167.51C581.52 167.51 585.3 166.66 588.65 164.95C592.06 163.25 594.78 160.9 596.8 157.92C598.83 154.88 599.84 151.37 599.84 147.37V135.71C598.72 136.3 597.36 136.83 595.76 137.31C594.22 137.79 592.52 138.24 590.65 138.66C588.79 139.09 586.87 139.46 584.9 139.78C582.93 140.1 581.04 140.4 579.23 140.66C575.55 141.25 572.41 142.15 569.8 143.38C567.24 144.6 565.27 146.2 563.88 148.17C562.55 150.09 561.89 152.38 561.89 155.05C561.89 159.09 563.33 162.18 566.2 164.31C569.13 166.44 572.83 167.51 577.31 167.51ZM648.98 191V68.27H686.94V90.64H688.21C690.45 82.55 694.1 76.53 699.16 72.59C704.22 68.59 710.11 66.59 716.82 66.59C718.63 66.59 720.49 66.73 722.41 66.99C724.33 67.21 726.11 67.55 727.76 68.03V101.99C725.9 101.35 723.45 100.85 720.41 100.47C717.43 100.1 714.77 99.91 712.42 99.91C707.79 99.91 703.61 100.95 699.88 103.03C696.2 105.05 693.3 107.9 691.17 111.58C689.09 115.2 688.05 119.46 688.05 124.36V191H648.98ZM769.26 121.01V191H730.18V68.27H767.34V90.8H768.7C771.41 83.29 776.05 77.41 782.6 73.15C789.15 68.83 796.96 66.67 806.01 66.67C814.64 66.67 822.12 68.62 828.46 72.51C834.85 76.34 839.81 81.72 843.32 88.65C846.89 95.52 848.65 103.56 848.6 112.78V191H809.53V120.45C809.58 113.63 807.85 108.3 804.33 104.47C800.87 100.63 796.05 98.71 789.87 98.71C785.77 98.71 782.15 99.62 779 101.43C775.91 103.19 773.52 105.72 771.81 109.02C770.16 112.33 769.31 116.32 769.26 121.01ZM898.36 121.01V191H859.29V27.36H897.08V90.8H898.44C901.21 83.24 905.74 77.33 912.02 73.07C918.36 68.81 926.11 66.67 935.27 66.67C943.9 66.67 951.41 68.59 957.8 72.43C964.2 76.21 969.15 81.56 972.67 88.49C976.23 95.41 977.99 103.51 977.94 112.78V191H938.87V120.45C938.92 113.63 937.22 108.3 933.75 104.47C930.29 100.63 925.42 98.71 919.13 98.71C915.03 98.71 911.41 99.62 908.27 101.43C905.18 103.19 902.75 105.72 901 109.02C899.29 112.33 898.41 116.32 898.36 121.01ZM1046.12 193.32C1033.23 193.32 1022.15 190.68 1012.88 185.41C1003.66 180.08 996.55 172.68 991.55 163.2C986.59 153.66 984.12 142.61 984.12 130.04C984.12 117.41 986.59 106.36 991.55 96.88C996.55 87.34 1003.66 79.94 1012.88 74.66C1022.15 69.34 1033.23 66.67 1046.12 66.67C1059.01 66.67 1070.06 69.34 1079.28 74.66C1088.54 79.94 1095.66 87.34 1100.61 96.88C1105.62 106.36 1108.12 117.41 1108.12 130.04C1108.12 142.61 1105.62 153.66 1100.61 163.2C1095.66 172.68 1088.54 180.08 1079.28 185.41C1070.06 190.68 1059.01 193.32 1046.12 193.32ZM1046.36 163.83C1051.04 163.83 1055.01 162.4 1058.26 159.52C1061.51 156.64 1063.99 152.65 1065.69 147.53C1067.45 142.42 1068.33 136.51 1068.33 129.8C1068.33 122.98 1067.45 117.01 1065.69 111.9C1063.99 106.78 1061.51 102.79 1058.26 99.91C1055.01 97.04 1051.04 95.6 1046.36 95.6C1041.51 95.6 1037.41 97.04 1034.05 99.91C1030.75 102.79 1028.22 106.78 1026.46 111.9C1024.76 117.01 1023.91 122.98 1023.91 129.8C1023.91 136.51 1024.76 142.42 1026.46 147.53C1028.22 152.65 1030.75 156.64 1034.05 159.52C1037.41 162.4 1041.51 163.83 1046.36 163.83ZM1193.82 138.03V68.27H1232.81V191H1195.57V168.15H1194.3C1191.58 175.66 1186.95 181.63 1180.39 186.05C1173.9 190.41 1166.04 192.6 1156.82 192.6C1148.46 192.6 1141.11 190.68 1134.77 186.85C1128.43 183.01 1123.5 177.66 1119.99 170.79C1116.47 163.86 1114.69 155.76 1114.64 146.5V68.27H1153.71V138.83C1153.76 145.48 1155.52 150.73 1158.98 154.57C1162.44 158.4 1167.16 160.32 1173.12 160.32C1177.01 160.32 1180.5 159.47 1183.59 157.76C1186.73 156 1189.21 153.47 1191.02 150.17C1192.88 146.82 1193.82 142.77 1193.82 138.03ZM1351.32 105.75L1315.45 106.71C1315.08 104.15 1314.06 101.88 1312.41 99.91C1310.76 97.89 1308.6 96.32 1305.94 95.2C1303.33 94.03 1300.29 93.44 1296.83 93.44C1292.3 93.44 1288.44 94.35 1285.25 96.16C1282.1 97.97 1280.56 100.42 1280.61 103.51C1280.56 105.91 1281.52 107.98 1283.49 109.74C1285.51 111.5 1289.11 112.91 1294.28 113.98L1317.93 118.45C1330.18 120.79 1339.29 124.68 1345.25 130.12C1351.27 135.55 1354.31 142.74 1354.36 151.69C1354.31 160.1 1351.8 167.43 1346.85 173.66C1341.95 179.89 1335.24 184.74 1326.71 188.2C1318.19 191.61 1308.44 193.32 1297.47 193.32C1279.95 193.32 1266.12 189.72 1256 182.53C1245.94 175.29 1240.18 165.59 1238.74 153.45L1277.34 152.49C1278.19 156.96 1280.4 160.37 1283.97 162.72C1287.54 165.06 1292.09 166.23 1297.63 166.23C1302.64 166.23 1306.71 165.3 1309.86 163.43C1313 161.57 1314.6 159.09 1314.65 156C1314.6 153.23 1313.37 151.02 1310.97 149.37C1308.58 147.67 1304.82 146.34 1299.71 145.38L1278.3 141.3C1265.99 139.07 1256.83 134.94 1250.81 128.92C1244.79 122.85 1241.81 115.12 1241.86 105.75C1241.81 97.54 1243.99 90.54 1248.41 84.73C1252.83 78.87 1259.12 74.4 1267.27 71.31C1275.42 68.22 1285.03 66.67 1296.11 66.67C1312.73 66.67 1325.84 70.16 1335.42 77.14C1345.01 84.07 1350.31 93.6 1351.32 105.75ZM1417.47 193.32C1404.63 193.32 1393.55 190.79 1384.23 185.73C1374.96 180.61 1367.82 173.34 1362.81 163.91C1357.86 154.43 1355.38 143.17 1355.38 130.12C1355.38 117.44 1357.89 106.36 1362.89 96.88C1367.9 87.34 1374.96 79.94 1384.07 74.66C1393.18 69.34 1403.91 66.67 1416.27 66.67C1425 66.67 1432.99 68.03 1440.24 70.75C1447.48 73.47 1453.74 77.49 1459.01 82.81C1464.29 88.14 1468.39 94.72 1471.32 102.55C1474.25 110.33 1475.71 119.25 1475.71 129.32V139.07H1369.05V116.37H1439.36C1439.3 112.22 1438.32 108.52 1436.4 105.27C1434.48 102.02 1431.85 99.49 1428.49 97.68C1425.19 95.81 1421.38 94.88 1417.07 94.88C1412.7 94.88 1408.78 95.87 1405.32 97.84C1401.86 99.75 1399.11 102.39 1397.09 105.75C1395.07 109.05 1394 112.8 1393.89 117.01V140.1C1393.89 145.11 1394.88 149.5 1396.85 153.29C1398.82 157.02 1401.62 159.92 1405.24 162C1408.86 164.07 1413.18 165.11 1418.18 165.11C1421.65 165.11 1424.79 164.63 1427.61 163.67C1430.44 162.72 1432.86 161.3 1434.88 159.44C1436.91 157.58 1438.43 155.28 1439.44 152.57L1475.31 153.61C1473.82 161.65 1470.55 168.65 1465.49 174.62C1460.48 180.53 1453.9 185.14 1445.75 188.44C1437.6 191.69 1428.17 193.32 1417.47 193.32Z" fill="black"/>
</svg>"""

# Shared email styles matching the platform's design system
STYLES = {
    "body": "margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "wrapper": "padding: 48px 24px;",
    "container": "max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e5e5;",
    "header": "padding: 48px 48px 0 48px; text-align: center;",
    "content": "padding: 36px 48px 48px 48px; text-align: center;",
    "h1": "margin: 0 0 12px 0; font-size: 22px; font-weight: 900; color: #000000; letter-spacing: -0.02em; line-height: 1.3;",
    "p": "margin: 0 0 20px 0; font-size: 14px; color: rgba(0,0,0,0.45); font-weight: 500; line-height: 1.7;",
    "button": "display: inline-block; padding: 14px 32px; background-color: #000000; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700; line-height: 1;",
    "link_text": "margin: 24px 0 0 0; font-size: 11px; color: rgba(0,0,0,0.2); word-break: break-all; font-weight: 500; line-height: 1.6;",
    "divider": "margin: 28px 0; border: none; border-top: 1px solid #f0f0f0;",
    "footer": "padding: 0 48px 40px 48px; text-align: center;",
    "footer_text": "margin: 0; font-size: 12px; color: rgba(0,0,0,0.2); font-weight: 500; line-height: 1.6;",
    "code": "display: inline-block; padding: 14px 28px; background-color: #fafafa; border: 1px solid #e5e5e5; border-radius: 10px; font-size: 28px; font-weight: 900; letter-spacing: 0.12em; color: #000000; font-family: monospace;",
}


def _email_layout(title: str, body_content: str, footer_note: str = "") -> str:
    """Wrap content in the standard email layout."""
    footer_html = ""
    if footer_note:
        footer_html = f"""
        <div style="{STYLES['footer']}">
            <hr style="{STYLES['divider']}" />
            <p style="{STYLES['footer_text']}">{footer_note}</p>
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="{STYLES['body']}">
    <div style="{STYLES['wrapper']}">
        <div style="{STYLES['container']}">
            <div style="{STYLES['header']}">
                {LOGO_SVG}
            </div>
            <div style="{STYLES['content']}">
                {body_content}
            </div>
            {footer_html}
        </div>
    </div>
</body>
</html>"""


def send_account_creation_email(
    user: UserRead,
    email: EmailStr,
):
    safe_username = html.escape(user.username)

    body_content = f"""
        <h1 style="{STYLES['h1']}">Welcome, {safe_username}!</h1>
        <p style="{STYLES['p']}">
            Your LearnHouse account is ready. Get started by creating your own organization or joining one.
        </p>
        <a href="https://university.learnhouse.io" style="{STYLES['button']}">
            Get Started
        </a>
    """

    return send_email(
        to=email,
        subject=f"Welcome to LearnHouse, {safe_username}!",
        body=_email_layout(
            title="Welcome",
            body_content=body_content,
            footer_note="Need help? Visit <a href=\"https://university.learnhouse.io\" style=\"color: rgba(0,0,0,0.35); text-decoration: underline;\">LearnHouse Academy</a> to learn the basics.",
        ),
    )


def send_password_reset_email(
    generated_reset_code: str,
    user: UserRead,
    organization: OrganizationRead,
    email: EmailStr,
    base_url: str,
):
    safe_username = html.escape(user.username)
    safe_code = html.escape(generated_reset_code)
    safe_email = quote(str(email), safe='')
    safe_code_param = quote(generated_reset_code, safe='')
    reset_url = f"{base_url}/reset?email={safe_email}&amp;resetCode={safe_code_param}"

    body_content = f"""
        <h1 style="{STYLES['h1']}">Reset your password</h1>
        <p style="{STYLES['p']}">
            Hi {safe_username}, we received a request to reset your password. Use the code below or click the button.
        </p>
        <div style="margin: 28px 0;">
            <span style="{STYLES['code']}">{safe_code}</span>
        </div>
        <a href="{reset_url}" style="{STYLES['button']}">
            Reset Password
        </a>
    """

    return send_email(
        to=email,
        subject="Reset your password",
        body=_email_layout(
            title="Reset Password",
            body_content=body_content,
            footer_note="If you didn't request a password reset, you can safely ignore this email. This link will expire shortly.",
        ),
    )


def send_password_reset_email_platform(
    generated_reset_code: str,
    user: UserRead,
    email: EmailStr,
    base_url: str,
):
    safe_username = html.escape(user.username)
    safe_code = html.escape(generated_reset_code)
    safe_email = quote(str(email), safe='')
    safe_code_param = quote(generated_reset_code, safe='')
    reset_url = f"{base_url}/reset-password?email={safe_email}&amp;resetCode={safe_code_param}"

    body_content = f"""
        <h1 style="{STYLES['h1']}">Reset your password</h1>
        <p style="{STYLES['p']}">
            Hi {safe_username}, we received a request to reset your password. Use the code below or click the button.
        </p>
        <div style="margin: 28px 0;">
            <span style="{STYLES['code']}">{safe_code}</span>
        </div>
        <a href="{reset_url}" style="{STYLES['button']}">
            Reset Password
        </a>
    """

    return send_email(
        to=email,
        subject="Reset your password",
        body=_email_layout(
            title="Reset Password",
            body_content=body_content,
            footer_note="If you didn't request a password reset, you can safely ignore this email. This link will expire in 1 hour.",
        ),
    )


def send_email_verification_email(
    token: str,
    user: UserRead,
    organization: OrganizationRead | None,
    email: EmailStr,
    base_url: str,
):
    """
    Send email verification email with verification link.

    Args:
        token: Verification token
        user: User receiving the email
        organization: Organization context (can be None for no-org signups)
        email: Email address to send to
        base_url: Base URL for constructing the verification link

    Returns:
        Boolean indicating if email was sent successfully
    """
    safe_username = html.escape(user.username)
    safe_token = quote(token, safe='')
    safe_user_uuid = quote(user.user_uuid, safe='')
    org_uuid = organization.org_uuid if organization else "none"
    safe_org_uuid = quote(org_uuid, safe='')
    verification_url = f"{base_url}/verify-email?token={safe_token}&amp;user={safe_user_uuid}&amp;org={safe_org_uuid}"

    body_content = f"""
        <h1 style="{STYLES['h1']}">Verify your email</h1>
        <p style="{STYLES['p']}">
            Hi {safe_username}, welcome to LearnHouse! Click the button below to verify your email address and activate your account.
        </p>
        <a href="{verification_url}" style="{STYLES['button']}">
            Verify Email Address
        </a>
        <p style="{STYLES['link_text']}">
            Or copy and paste this link:<br />{verification_url}
        </p>
    """

    return send_email(
        to=email,
        subject="Verify your email address",
        body=_email_layout(
            title="Verify Email",
            body_content=body_content,
            footer_note="This link expires in 1 hour. If you didn't create a LearnHouse account, you can safely ignore this email.",
        ),
    )
