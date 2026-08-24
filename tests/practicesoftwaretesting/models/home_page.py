"""Page object for the home screen of the Toolshop application."""

from playwright.sync_api import Page, expect


class HomePage:
    """Locators and actions for the home screen."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.search_query = page.locator('[data-test="search-query"]')
        self.search_submit = page.locator('[data-test="search-submit"]')
        self.search_reset = page.locator('[data-test="search-reset"]')
        self.product_names = page.locator('[data-test="product-name"]')
        self.sort_select = page.locator('[data-test="sort"]')

    def open(self) -> None:
        self.page.goto("/")

    def search(self, term: str) -> None:
        self.search_query.fill(term)
        self.search_submit.click()

    def reset_search(self) -> None:
        self.search_reset.click()

    def expect_product_names_visible(self) -> None:
        expect(self.product_names.first).to_be_visible()

    def expect_product_count(self, count: int) -> None:
        expect(self.product_names).to_have_count(count)

    def sort_by(self, value: str) -> None:
        self.sort_select.select_option(value)

    def expect_first_product_name_to_be(self, text: str) -> None:
        expect(self.product_names.first).to_have_text(text)

    def click_first_product(self) -> None:
        self.product_names.first.click()
