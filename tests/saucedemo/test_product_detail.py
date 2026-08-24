"""Product detail tests for SauceDemo."""

from playwright.sync_api import Page

from .models.inventory_page import InventoryPage
from .models.item_detail_page import ItemDetailPage


def test_product_detail_displays_correct_information(app: Page) -> None:
    """Product detail page opens and displays correct name, description, and price."""
    inventory = InventoryPage(app)
    item_detail = ItemDetailPage(app)

    inventory.open()
    item_detail.click_title_link()
    item_detail.expect_name_visible()
    item_detail.expect_name("Sauce Labs Backpack")
    item_detail.expect_description("carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection.")
    item_detail.expect_price("$29.99")
    item_detail.click_back_to_products()
    inventory.expect_title_visible()
    inventory.expect_title_text("Products")


def test_product_detail_add_to_cart_toggles_button(app: Page) -> None:
    """Adding from the detail page replaces the add control with a remove control."""
    inventory = InventoryPage(app)
    item_detail = ItemDetailPage(app)

    inventory.open()
    item_detail.click_title_link()
    item_detail.expect_add_to_cart_visible()
    item_detail.expect_add_to_cart_text("Add to cart")
    item_detail.click_add_to_cart()
    item_detail.expect_remove_visible()
    item_detail.expect_add_to_cart_absent()
    item_detail.click_back_to_products()
    inventory.expect_title_visible()


def test_product_detail_back_button_navigates_to_inventory(app: Page) -> None:
    """Back to products button on detail page returns to inventory list."""
    inventory = InventoryPage(app)
    item_detail = ItemDetailPage(app)

    inventory.open()
    item_detail.click_title_link()
    item_detail.expect_back_to_products_visible()
    item_detail.click_back_to_products()
    inventory.expect_title_visible()
    inventory.expect_title_text("Products")
    inventory.expect_sort_container_visible()
