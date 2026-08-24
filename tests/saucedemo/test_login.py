"""Login regression tests for the Swag Labs (SauceDemo) application."""

from playwright.sync_api import Page

from .models.inventory_page import InventoryPage
from .models.login_page import LoginPage


def test_login_success_standard_user(guest: Page) -> None:
    """Standard user can log in and reaches the inventory page."""
    login = LoginPage(guest)
    inventory = InventoryPage(guest)

    login.open()
    login.login("standard_user", "secret_sauce")

    inventory.expect_url()
    inventory.expect_title_visible()


def test_login_failure_locked_out_user(guest: Page) -> None:
    """Locked out user sees an error and remains on the login page."""
    login = LoginPage(guest)

    login.open()
    login.login("locked_out_user", "secret_sauce")

    login.expect_error("Epic sadface: Sorry, this user has been locked out.")
    login.expect_form_still_present()


def test_login_failure_wrong_password(guest: Page) -> None:
    """Valid username with wrong password shows credential error."""
    login = LoginPage(guest)

    login.open()
    login.login("standard_user", "wrong_password")

    login.expect_error("Epic sadface: Username and password do not match any user in this service")
    login.expect_form_still_present()


def test_login_failure_empty_username(guest: Page) -> None:
    """Empty username with valid password shows required field error."""
    login = LoginPage(guest)

    login.open()
    login.login_with_password_only("secret_sauce")

    login.expect_error("Epic sadface: Username is required")
    login.expect_form_still_present()


def test_login_failure_empty_password(guest: Page) -> None:
    """Valid username with empty password shows required field error."""
    login = LoginPage(guest)

    login.open()
    login.login_with_username_only("standard_user")

    login.expect_error("Epic sadface: Password is required")
    login.expect_form_still_present()

