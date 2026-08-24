"""Page object for the invoices screen of the application.

Every locator for this screen lives here and nowhere else.

That is what makes the suite healable: when the application changes, one
file needs patching, not every test that happens to touch the screen.
"""

from playwright.sync_api import Page, expect


class InvoicesPage:
    """Every locator for this screen lives here and nowhere else.

    That is what makes the suite healable: when the application changes, one
    file needs patching, not every test that happens to touch the screen.
    """

    def __init__(self, page: Page) -> None:
        self.page = page
        self.page_title = page.locator('[data-test="page-title"]')

    def expect_page_title_visible(self) -> None:
        expect(self.page_title).to_be_visible()

    def expect_page_title_contains(self, text: str) -> None:
        expect(self.page_title).to_contain_text(text)
