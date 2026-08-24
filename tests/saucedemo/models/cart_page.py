"""Page object for the cart screen of Swag Labs (SauceDemo)."""

from playwright.sync_api import Page, expect


class CartPage:
    """Every locator for this screen lives here and nowhere else."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.cart_list = page.locator('[data-test="cart-list"]')
        self.item_name = page.locator('[data-test="inventory-item-name"]')
        self.remove_backpack_button = page.locator('[data-test="remove-sauce-labs-backpack"]')
        self.shopping_cart_badge = page.locator('[data-test="shopping-cart-badge"]')
        self.checkout_button = page.locator('[data-test="checkout"]')
        self.continue_shopping_button = page.locator('[data-test="continue-shopping"]')
        self.inventory_item = page.locator('[data-test="inventory-item"]')
        self.remove_bike_light_button = page.locator('[data-test="remove-sauce-labs-bike-light"]')

    def open(self) -> None:
        self.page.goto("/cart.html")

    def expect_cart_list_visible(self) -> None:
        expect(self.cart_list).to_be_visible()

    def expect_item_name(self, name: str) -> None:
        expect(self.item_name).to_contain_text(name)

    def expect_remove_button_absent(self) -> None:
        expect(self.remove_backpack_button).to_have_count(0)

    def expect_badge_absent(self) -> None:
        expect(self.shopping_cart_badge).to_have_count(0)

    def expect_badge_visible(self) -> None:
        expect(self.shopping_cart_badge).to_be_visible()

    def expect_badge_count(self, count: str) -> None:
        expect(self.shopping_cart_badge).to_contain_text(count)

    def remove_backpack(self) -> None:
        self.remove_backpack_button.click()

    def click_checkout(self) -> None:
        self.checkout_button.click()

    def click_continue_shopping(self) -> None:
        self.continue_shopping_button.click()

    def expect_inventory_item_count(self, count: int) -> None:
        expect(self.inventory_item).to_have_count(count)

    def remove_bike_light(self) -> None:
        self.remove_bike_light_button.click()

    def expect_remove_bike_light_absent(self) -> None:
        expect(self.remove_bike_light_button).to_have_count(0)

    def expect_url(self, url: str) -> None:
        expect(self.page).to_have_url(url)

    def click_shopping_cart_link(self):
        self.page.click("[data-test='shopping-cart-link']")
