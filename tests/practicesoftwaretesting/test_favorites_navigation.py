"""Test for favorites navigation from the account page."""

from playwright.sync_api import Page

from .models.account_page import AccountPage
from .models.favorites_page import FavoritesPage


def test_account_nav_favorites(app: Page) -> None:
    """Clicking Favorites link navigates to Favorites page with correct title."""
    account = AccountPage(app)
    account.open()
    account.click_nav_favorites()
    favorites = FavoritesPage(app)
    favorites.expect_page_title_visible()
    favorites.expect_page_title_contains("Favorites")
