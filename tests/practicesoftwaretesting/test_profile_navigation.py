"""Profile navigation tests."""

from playwright.sync_api import Page

from .models.account_page import AccountPage
from .models.profile_page import ProfilePage


def test_account_nav_profile(app: Page) -> None:
    """Clicking Profile link navigates to Profile page with correct title."""
    account = AccountPage(app)
    profile = ProfilePage(app)

    account.page.goto("/account")
    account.click_nav_profile()
    profile.expect_loaded()
