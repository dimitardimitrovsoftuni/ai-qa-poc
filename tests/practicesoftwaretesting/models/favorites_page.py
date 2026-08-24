"""Page object for the favorites screen."""

from playwright.sync_api import Page, expect


class FavoritesPage:
    """Locators and actions for the Favorites page."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.page_title = page.locator('[data-test="page-title"]')

    def expect_page_title_visible(self) -> None:
        """Ensure the page title is visible."""
        expect(self.page_title).to_be_visible()

    def expect_page_title_contains(self, text: str) -> None:
        """Ensure the page title contains the expected text."""
        expect(self.page_title).to_contain_text(text)

