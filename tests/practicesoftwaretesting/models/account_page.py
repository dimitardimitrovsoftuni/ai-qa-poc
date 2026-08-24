"""Page object for the account screen reached after a successful sign-in."""

from playwright.sync_api import Page, expect


class AccountPage:
    """Locators and actions for the /account screen."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.page_title = page.locator('[data-test="page-title"]')
        self.nav_favorites = page.locator('[data-test="nav-favorites"]')
        self.nav_profile = page.locator('[data-test="nav-profile"]')

    def expect_loaded(self) -> None:
        expect(self.page).to_have_url("/account")
        expect(self.page_title).to_be_visible()

    def click_nav_favorites(self) -> None:
        self.nav_favorites.click()

    def click_nav_profile(self) -> None:
        self.nav_profile.click()

    def click_nav_invoices(self) -> None:
        self.page.locator('[data-test="nav-invoices"]').first.click()

    def open(self) -> None:
        self.page.goto("/account")
