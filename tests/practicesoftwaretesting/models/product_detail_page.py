"""Page object for the product detail screen."""

from playwright.sync_api import Page, expect


class ProductDetailPage:
    """Locators and actions for the product detail view."""

    def __init__(self, page: Page) -> None:
        self.page = page
        # The selector matches multiple elements on the page; chain .first so
        # singular assertions do not raise strict-mode violations.
        self.product_name = page.locator('[data-test="product-name"]').first
        self.unit_price = page.locator('[data-test="unit-price"]')
        self.increase_quantity = page.locator('[data-test="increase-quantity"]')
        self.quantity_input = page.locator('[data-test="quantity"]')
        self.add_to_cart = page.locator('[data-test="add-to-cart"]')
        self.add_to_favorites = page.locator('[data-test="add-to-favorites"]')
        self.decrease_quantity = page.locator('[data-test="decrease-quantity"]')
        self.cart_quantity = page.locator('[data-test="cart-quantity"]')
        self.cart_quantity = page.locator('[data-test="cart-quantity"]')

    def expect_product_name_visible(self) -> None:
        expect(self.product_name).to_be_visible()

    def expect_unit_price_visible(self) -> None:
        expect(self.unit_price).to_be_visible()

    def click_increase_quantity(self) -> None:
        self.increase_quantity.click()

    def expect_quantity_value(self, value: str) -> None:
        expect(self.quantity_input).to_have_value(value)

    def click_add_to_cart(self) -> None:
        self.add_to_cart.click()

    def expect_add_to_cart_absent(self) -> None:
        expect(self.add_to_cart).to_have_count(0)

    def expect_add_to_favorites_visible(self) -> None:
        expect(self.add_to_favorites).to_be_visible()

    def click_decrease_quantity(self) -> None:
        self.decrease_quantity.click()

    def expect_cart_quantity_visible(self) -> None:
        expect(self.cart_quantity).to_be_visible()

    def expect_cart_quantity_text(self, value: str) -> None:
        expect(self.cart_quantity).to_contain_text(value)
