from playwright.sync_api import Page

from .models.forgot_password_page import ForgotPasswordPage


def test_forgot_password_empty_email_shows_required_error(guest: Page) -> None:
    """Submitting the forgot-password form with an empty email shows the required-field alert."""
    forgot_password = ForgotPasswordPage(guest)

    forgot_password.open()
    forgot_password.submit()

    forgot_password.expect_email_error_visible()
    forgot_password.expect_email_error_text("Email is required")

