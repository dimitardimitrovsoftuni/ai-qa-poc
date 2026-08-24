"""Cart regression tests for Swag Labs (SauceDemo)."""

from playwright.sync_api import Page

from .models.cart_page import CartPage
from .models.inventory_page import InventoryPage


def test_remove_item_from_cart(app: Page) -> None:
    """Removing an item empties the cart and hides the badge."""
    inventory = InventoryPage(app)
    cart = CartPage(app)

    inventory.open()
    inventory.add_backpack_to_cart()
    inventory.click_shopping_cart_link()

    cart.expect_cart_list_visible()
    cart.remove_backpack()
    cart.expect_remove_button_absent()
    cart.expect_badge_absent()
    cart.click_continue_shopping()

    inventory.expect_url()


def test_cart_badge_updates_on_add_remove(app: Page) -> None:
    """Cart badge appears when adding an item and disappears when removing it."""
    inventory = InventoryPage(app)
    cart = CartPage(app)

    inventory.open()
    inventory.expect_badge_absent()
    inventory.add_backpack_to_cart()
    inventory.expect_badge_visible()
    inventory.expect_badge_count("1")
    inventory.click_shopping_cart_link()

    cart.remove_backpack()
    cart.click_continue_shopping()

    inventory.expect_url()
    inventory.expect_badge_absent()

