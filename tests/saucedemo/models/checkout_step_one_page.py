from playwright.sync_api import Page, expect


class CheckoutStepOnePage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.first_name_input = page.locator('[data-test="firstName"]')
        self.last_name_input = page.locator('[data-test="lastName"]')
        self.postal_code_input = page.locator('[data-test="postalCode"]')
        self.continue_button = page.locator('[data-test="continue"]')
        self.cancel_button = page.locator('[data-test="cancel"]')

    def open(self) -> None:
        self.page.goto("/checkout-step-one.html")

    def fill_first_name(self, value: str) -> None:
        self.first_name_input.fill(value)

    def fill_last_name(self, value: str) -> None:
        self.last_name_input.fill(value)

    def fill_postal_code(self, value: str) -> None:
        self.postal_code_input.fill(value)

    def click_continue(self) -> None:
        self.continue_button.click()

    def click_cancel(self) -> None:
        self.cancel_button.click()
