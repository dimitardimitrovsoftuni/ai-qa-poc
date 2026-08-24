from playwright.sync_api import Page, expect


class ItemDetailPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.title_link = page.locator('[data-test="item-4-title-link"]')
        self.inventory_item_name = page.locator('[data-test="inventory-item-name"]')
        self.inventory_item_desc = page.locator('[data-test="inventory-item-desc"]')
        self.inventory_item_price = page.locator('[data-test="inventory-item-price"]')
        self.add_to_cart_button = page.locator('[data-test="add-to-cart"]')
        self.back_to_products_button = page.locator('[data-test="back-to-products"]')
        self.remove_button = page.locator('[data-test="remove"]')

    def open(self) -> None:
        self.page.goto("/inventory.html")

    def click_title_link(self) -> None:
        self.title_link.click()

    def expect_name_visible(self) -> None:
        expect(self.inventory_item_name).to_be_visible()

    def expect_name(self, name: str) -> None:
        expect(self.inventory_item_name).to_contain_text(name)

    def expect_description(self, desc: str) -> None:
        expect(self.inventory_item_desc).to_contain_text(desc)

    def expect_price(self, price: str) -> None:
        expect(self.inventory_item_price).to_contain_text(price)

    def expect_add_to_cart_visible(self) -> None:
        expect(self.add_to_cart_button).to_be_visible()

    def expect_add_to_cart_text(self, text: str) -> None:
        expect(self.add_to_cart_button).to_contain_text(text)

    def click_add_to_cart(self) -> None:
        self.add_to_cart_button.click()

    def expect_back_to_products_visible(self) -> None:
        expect(self.back_to_products_button).to_be_visible()

    def click_back_to_products(self) -> None:
        self.back_to_products_button.click()

    def expect_url(self, url: str = "/inventory.html") -> None:
        # The parameter is optional so that both call styles work. The same
        # method name existed with two different signatures across these page
        # objects - one taking a path, three hard-coding their own - and a model
        # cannot keep that straight from a list of names. Two repair rounds went
        # on exactly this. A default keeps every existing no-argument caller
        # working while accepting the explicit form.
        expect(self.page).to_have_url(url)

    def expect_remove_visible(self) -> None:
        expect(self.remove_button).to_be_visible()

    def expect_add_to_cart_absent(self) -> None:
        expect(self.add_to_cart_button).to_have_count(0)
