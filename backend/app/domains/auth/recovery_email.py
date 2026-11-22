"""The two messages password recovery sends. Plain text, English like the rest of the app.

Neither contains a password, a link or the address of anyone but the recipient. The
code is shown in two groups of four (OWASP: spaces make PINs easier to read and copy);
the service accepts it with or without the space.
"""

from app.core.config import settings


def code_message(code: str) -> tuple[str, str]:
    minutes = settings.PASSWORD_RESET_CODE_TTL_SECONDS // 60
    spaced = f"{code[:4]} {code[4:]}"
    return (
        "Your BodyTrack password reset code",
        "Use this code to choose a new BodyTrack password:\n\n"
        f"    {spaced}\n\n"
        f"It works once and expires in {minutes} minutes. Asking for another code "
        "cancels this one.\n\n"
        "If you did not ask to reset your password, you can ignore this email: nothing "
        "changes unless the code is used. Never share it with anyone; BodyTrack will "
        "never ask you for it.\n",
    )


def password_changed_message() -> tuple[str, str]:
    return (
        "Your BodyTrack password was changed",
        "The password of your BodyTrack account was just changed using a reset code, "
        "and you were signed out on every device.\n\n"
        "If this was you, there is nothing to do. If it was not, someone with access to "
        "this email address reset your password: reset it again from the sign-in screen "
        "and secure this mailbox.\n",
    )
