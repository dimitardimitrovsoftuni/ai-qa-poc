"""Page object for the inventory page of the Swag Labs (SauceDemo) application."""

from playwright.sync_api import Page, expect


class InventoryPage:
    """Every locator for the inventory screen lives here and nowhere else."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.title = page.locator('[data-test="title"]')
        self.add_to_cart_backpack_button = page.locator('[data-test="add-to-cart-sauce-labs-backpack"]')
        self.shopping_cart_link = page.locator('[data-test="shopping-cart-link"]')
        self.shopping_cart_badge = page.locator('[data-test="shopping-cart-badge"]')
        self.sort_container = page.locator('[data-test="product-sort-container"]')
        self.active_option = page.locator('[data-test="active-option"]')
        self.first_item_name = page.locator('[data-test="inventory-item-name"]').first
        self.add_to_cart_bike_light_button = page.locator('[data-test="add-to-cart-sauce-labs-bike-light"]')
        self.inventory_item = page.locator('[data-test="inventory-item"]')
        self.remove_backpack_button = page.locator('[data-test="remove-sauce-labs-backpack"]')
        self.remove_bike_light_button = page.locator('[data-test="remove-sauce-labs-bike-light"]')

    def open(self) -> None:
        self.page.goto("/inventory.html")

    def expect_url(self, url: str = "/inventory.html") -> None:
        # The parameter is optional so that both call styles work. The same
        # method name existed with two different signatures across these page
        # objects - one taking a path, three hard-coding their own - and a model
        # cannot keep that straight from a list of names. Two repair rounds went
        # on exactly this. A default keeps every existing no-argument caller
        # working while accepting the explicit form.
        expect(self.page).to_have_url(url)

    def expect_title_visible(self) -> None:
        expect(self.title).to_be_visible()

    def add_backpack_to_cart(self) -> None:
        self.add_to_cart_backpack_button.click()

    def click_shopping_cart_link(self) -> None:
        self.shopping_cart_link.click()

    def expect_badge_absent(self) -> None:
        expect(self.shopping_cart_badge).to_have_count(0)

    def expect_badge_visible(self) -> None:
        expect(self.shopping_cart_badge).to_be_visible()

    def expect_badge_count(self, count: str) -> None:
        expect(self.shopping_cart_badge).to_contain_text(count)

    def sort_by(self, value: str) -> None:
        self.sort_container.select_option(value)

    def expect_active_option(self, text: str) -> None:
        expect(self.active_option).to_contain_text(text)

    def expect_first_item_name(self, text: str) -> None:
        expect(self.first_item_name).to_contain_text(text)

    def add_bike_light_to_cart(self) -> None:
        self.add_to_cart_bike_light_button.click()

    def expect_inventory_item_count(self, count: int) -> None:
        expect(self.inventory_item).to_have_count(count)

    def expect_title_text(self, text: str) -> None:
        expect(self.title).to_contain_text(text)

    def expect_sort_container_visible(self) -> None:
        expect(self.sort_container).to_be_visible()

    def expect_remove_backpack_visible(self) -> None:
        expect(self.remove_backpack_button).to_be_visible()

    def expect_remove_bike_light_visible(self) -> None:
        expect(self.remove_bike_light_button).to_be_visible()
