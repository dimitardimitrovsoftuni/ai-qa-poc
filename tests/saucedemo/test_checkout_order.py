"""Checkout order regression tests for Swag Labs (SauceDemo)."""

from playwright.sync_api import Page

from .models.inventory_page import InventoryPage
from .models.cart_page import CartPage
from .models.checkout_step_one_page import CheckoutStepOnePage
from .models.checkout_step_two_page import CheckoutStepTwoPage


def test_successful_checkout_flow(app: Page) -> None:
    """Complete checkout flow from adding an item to finishing the order."""
    inventory = InventoryPage(app)
    cart = CartPage(app)
    checkout_step_one = CheckoutStepOnePage(app)
    checkout_step_two = CheckoutStepTwoPage(app)

    inventory.open()
    inventory.add_backpack_to_cart()
    inventory.click_shopping_cart_link()

    cart.expect_cart_list_visible()
    cart.expect_item_name("Sauce Labs Backpack")
    cart.click_checkout()

    checkout_step_one.fill_first_name("John")
    checkout_step_one.fill_last_name("Doe")
    checkout_step_one.fill_postal_code("12345")
    checkout_step_one.click_continue()

    checkout_step_two.expect_summary_visible()
    checkout_step_two.expect_item_name("Sauce Labs Backpack")
    checkout_step_two.expect_subtotal("Item total: $29.99")
    checkout_step_two.expect_tax("Tax: $2.40")
    checkout_step_two.expect_total("Total: $32.39")
    checkout_step_two.click_finish()

    checkout_step_two.expect_url()

