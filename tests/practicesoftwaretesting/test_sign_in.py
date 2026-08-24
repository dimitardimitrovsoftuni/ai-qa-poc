"""Sign-in regression tests for the Toolshop application."""

from playwright.sync_api import Page

from .models.account_page import AccountPage
from .models.login_page import LoginPage


def test_signin_success_with_seeded_customer(guest: Page) -> None:
    """Signing in with the seeded customer account reaches the account area."""
    login = LoginPage(guest)
    account = AccountPage(guest)

    login.open()
    login.sign_in("customer@practicesoftwaretesting.com", "welcome01")

    account.expect_loaded()


def test_signin_rejects_wrong_password(guest: Page) -> None:
    """Signing in with a wrong password shows an error and stays on the form."""
    login = LoginPage(guest)

    login.open()
    login.sign_in("customer@practicesoftwaretesting.com", "definitely-wrong")

    login.expect_error("Invalid email or password")
    login.expect_still_on_form()
