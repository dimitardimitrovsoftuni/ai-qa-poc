from playwright.sync_api import Page

from .models.cart_page import CartPage
from .models.inventory_page import InventoryPage


def test_add_multiple_items_to_cart(app: Page) -> None:
    """Adding multiple items updates the cart badge and shows each item in the cart."""
    inventory = InventoryPage(app)
    cart = CartPage(app)

    inventory.open()
    inventory.add_backpack_to_cart()
    inventory.add_bike_light_to_cart()
    inventory.expect_badge_count("2")
    inventory.click_shopping_cart_link()
    cart.expect_badge_count("2")
    cart.expect_inventory_item_count(2)


def test_remove_one_item_from_cart(app: Page) -> None:
    """Removing one item from cart decreases badge count and row count."""
    inventory = InventoryPage(app)
    cart = CartPage(app)

    inventory.open()
    inventory.add_backpack_to_cart()
    inventory.add_bike_light_to_cart()
    inventory.click_shopping_cart_link()
    cart.remove_backpack()
    cart.expect_badge_count("1")
    cart.expect_inventory_item_count(1)


def test_remove_all_items_from_cart(app: Page) -> None:
    """Removing all items makes the badge disappear and leaves an empty cart."""
    inventory = InventoryPage(app)
    cart = CartPage(app)

    inventory.open()
    inventory.add_backpack_to_cart()
    inventory.add_bike_light_to_cart()
    inventory.click_shopping_cart_link()
    cart.remove_backpack()
    cart.remove_bike_light()
    cart.expect_badge_absent()
    cart.expect_inventory_item_count(0)
