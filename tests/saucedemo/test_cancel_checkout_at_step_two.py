"""Cancel button on checkout step two returns to inventory with cart unchanged"""

from playwright.sync_api import Page, expect

from .models.inventory_page import InventoryPage
from .models.cart_page import CartPage
from .models.checkout_step_one_page import CheckoutStepOnePage
from .models.checkout_step_two_page import CheckoutStepTwoPage


def test_cancel_checkout_at_step_two(app: Page) -> None:
    inventory = InventoryPage(app)
    inventory.open()
    inventory.add_backpack_to_cart()

    cart = CartPage(app)
    cart.click_shopping_cart_link()

    cart.click_checkout()

    checkout = CheckoutStepOnePage(app)
    checkout.fill_first_name("John")
    checkout.fill_last_name("Doe")
    checkout.fill_postal_code("12345")
    checkout.click_continue()

    checkout_step_two = CheckoutStepTwoPage(app)
    checkout_step_two.click_cancel()

    inventory.expect_url("/inventory.html")
    inventory.expect_badge_visible()
    inventory.expect_badge_count("1")
