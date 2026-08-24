from playwright.sync_api import Page

from .models.inventory_page import InventoryPage


def test_sort_by_price_high_to_low(app: Page) -> None:
    """Sorting by price high to low updates active option and shows most expensive product first."""
    inventory = InventoryPage(app)

    inventory.open()
    inventory.sort_by("hilo")
    inventory.expect_active_option("Price (high to low)")
    inventory.expect_first_item_name("Sauce Labs Fleece Jacket")


def test_sort_by_price_low_to_high(app: Page) -> None:
    """Sorting by price low to high updates active option and shows least expensive product first."""
    inventory = InventoryPage(app)

    inventory.open()
    inventory.sort_by("lohi")
    inventory.expect_active_option("Price (low to high)")
    inventory.expect_first_item_name("Sauce Labs Onesie")


def test_sort_by_name_z_to_a(app: Page) -> None:
    """Sorting by name Z to A updates active option and shows last product alphabetically first."""
    inventory = InventoryPage(app)

    inventory.open()
    inventory.sort_by("za")
    inventory.expect_active_option("Name (Z to A)")
    inventory.expect_first_item_name("Test.allTheThings() T-Shirt (Red)")
