"""Catalogue sorting tests for Toolshop."""

from playwright.sync_api import Page, expect

from .models.home_page import HomePage


def test_sort_by_name_descending(app: Page) -> None:
    """Sorting by Name (Z-A) reorders products and keeps the same count"""
    home = HomePage(app)
    home.open()
    home.sort_by("name,desc")
    home.expect_product_names_visible()
    home.expect_product_count(9)
    home.expect_first_product_name_to_be("Wood Saw")


def test_sort_by_price_ascending(app: Page) -> None:
    """Sorting by Price (Low-High) reorders products and keeps the same count"""
    home = HomePage(app)
    home.open()
    home.sort_by("price,asc")
    home.expect_product_names_visible()
    home.expect_product_count(9)
    home.expect_first_product_name_to_be("Washers")
