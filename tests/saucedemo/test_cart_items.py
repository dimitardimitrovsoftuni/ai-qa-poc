"""Cart item tests for Swag Labs (SauceDemo)."""

from playwright.sync_api import Page, expect

from .models.inventory_page import InventoryPage
from .models.cart_page import CartPage


def test_cart_remove_all_items_badge_disappears(app: Page) -> None:
    """Removing all items from cart makes the badge disappear entirely"""
    inventory = InventoryPage(app)
    inventory.open()
    inventory.add_backpack_to_cart()
    inventory.add_bike_light_to_cart()
    inventory.click_shopping_cart_link()
    cart = CartPage(app)
    cart.remove_backpack()
    cart.remove_bike_light()
    cart.expect_badge_absent()
    cart.expect_remove_button_absent()
    cart.expect_remove_bike_light_absent()


def test_cart_continue_shopping_returns_to_inventory_with_cart_preserved(app: Page) -> None:
    """Continue Shopping returns to inventory page and preserves cart contents"""
    inventory = InventoryPage(app)
    inventory.open()
    inventory.add_backpack_to_cart()
    inventory.add_bike_light_to_cart()
    inventory.click_shopping_cart_link()
    cart = CartPage(app)
    cart.click_continue_shopping()
    cart.expect_url("/inventory.html")
    inventory.expect_badge_count("2")
    inventory.expect_remove_backpack_visible()
    inventory.expect_remove_bike_light_visible()
