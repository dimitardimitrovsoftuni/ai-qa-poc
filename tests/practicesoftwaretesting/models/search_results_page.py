"""Page object for the search results screen of the Toolshop application."""

from playwright.sync_api import Page, expect


class SearchResultsPage:
    """Locators and expectations for the search results screen."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.search_caption = page.locator('[data-test="search-caption"]')
        self.search_term = page.locator('[data-test="search-term"]')
        self.search_result_count = page.locator('[data-test="search-result-count"]')
        self.product_names = page.locator('[data-test="product-name"]')

    def expect_caption_visible(self) -> None:
        expect(self.search_caption).to_be_visible()

    def expect_search_term(self, term: str) -> None:
        expect(self.search_term).to_contain_text(term)

    def expect_result_count(self, count_text: str) -> None:
        expect(self.search_result_count).to_contain_text(count_text)

    def expect_product_count(self, count: int) -> None:
        expect(self.product_names).to_have_count(count)

    def expect_no_products(self) -> None:
        expect(self.product_names).to_have_count(0)

    def expect_caption_absent(self) -> None:
        expect(self.search_caption).to_have_count(0)
