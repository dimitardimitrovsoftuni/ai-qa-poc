"""Cancel checkout at step one regression tests for Swag Labs."""

from playwright.sync_api import Page

from .models.inventory_page import InventoryPage
from .models.cart_page import CartPage
from .models.checkout_step_one_page import CheckoutStepOnePage


def test_cancel_checkout_at_step_one(app: Page) -> None:
    """Cancel button on checkout step one returns to cart with item intact"""
    inventory_page = InventoryPage(app)
    inventory_page.open()
    inventory_page.add_backpack_to_cart()
    inventory_page.click_shopping_cart_link()

    cart_page = CartPage(app)
    cart_page.click_checkout()

    checkout_step_one_page = CheckoutStepOnePage(app)
    checkout_step_one_page.click_cancel()

    cart_page.expect_url("/cart.html")
    cart_page.expect_cart_list_visible()
    cart_page.expect_item_name("Sauce Labs Backpack")
