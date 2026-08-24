"""Product search regression tests for the Toolshop application."""

from playwright.sync_api import Page

from .models.home_page import HomePage
from .models.search_results_page import SearchResultsPage


def test_search_returns_matching_products(guest: Page) -> None:
    """Searching for a substring returns matching products with correct count."""
    home = HomePage(guest)
    results = SearchResultsPage(guest)

    home.open()
    home.search("pliers")

    results.expect_caption_visible()
    results.expect_search_term("pliers")
    results.expect_result_count("4 products found for 'pliers'")
    results.expect_product_count(4)


def test_search_no_results_shows_zero_count(guest: Page) -> None:
    """Searching for a non-existent term shows zero results and no product cards."""
    home = HomePage(guest)
    results = SearchResultsPage(guest)

    home.open()
    home.search("xyz123nonexistent")

    results.expect_caption_visible()
    results.expect_search_term("xyz123nonexistent")
    results.expect_result_count("0 products found for 'xyz123nonexistent'")
    results.expect_product_count(0)
    results.expect_no_products()


def test_search_case_insensitive(guest: Page) -> None:
    """Search is case-insensitive and returns same results for uppercase query."""
    home = HomePage(guest)
    results = SearchResultsPage(guest)

    home.open()
    home.search("PLIERS")

    results.expect_caption_visible()
    results.expect_search_term("PLIERS")
    results.expect_result_count("4 products found for 'PLIERS'")
    results.expect_product_count(4)


def test_search_reset_clears_results(guest: Page) -> None:
    """Clicking the reset button clears the search and restores the full catalogue."""
    home = HomePage(guest)
    results = SearchResultsPage(guest)

    home.open()
    home.search("pliers")

    results.expect_caption_visible()
    results.expect_product_count(4)

    home.reset_search()

    results.expect_caption_absent()
    results.expect_product_count(9)

