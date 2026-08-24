"""Page object for the profile screen."""

from playwright.sync_api import Page, expect


class ProfilePage:
    """Locators and actions for the Profile page."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.page_title = page.locator('[data-test="page-title"]')

    def expect_loaded(self) -> None:
        expect(self.page_title).to_be_visible()
        expect(self.page_title).to_contain_text("Profile")

