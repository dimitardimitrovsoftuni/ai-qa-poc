"""Page object for the checkout overview (step two) of Swag Labs.

Restored by hand on 2026-08-22 after a harness bug deleted six of its methods. A
reply sent this file as a whole file; the generator is meant to rewrite such a
block as an addition, and it did — but the conversion was a side effect inside the
validator, and the apply path re-parsed the reply from scratch, so the whole file
was written after all. Every selector below comes from the captured page rather
than from memory.
"""

from playwright.sync_api import Page, expect


class CheckoutStepTwoPage:
    """Locators and actions for the checkout overview screen."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.summary_container = page.locator('[data-test="checkout-summary-container"]')
        self.item_name = page.locator('[data-test="inventory-item-name"]')
        self.subtotal_label = page.locator('[data-test="subtotal-label"]')
        self.tax_label = page.locator('[data-test="tax-label"]')
        self.total_label = page.locator('[data-test="total-label"]')
        self.finish_button = page.locator('[data-test="finish"]')
        self.cancel_button = page.locator('[data-test="cancel"]')

    def open(self) -> None:
        self.page.goto("/checkout-step-two.html")

    def expect_url(self, url: str = "/checkout-complete.html") -> None:
        # The default is the page reached AFTER Finish, not this screen's own URL.
        # That reads oddly, and it is what the existing test relies on when it calls
        # expect_url() with no argument, so it is preserved deliberately: restoring
        # a "more sensible" default broke a passing test.
        #
        # Optional parameter because this method name exists on several page objects,
        # some hard-coding a path and some taking one. A default accepts both call
        # styles instead of making a model guess which kind it is looking at.
        expect(self.page).to_have_url(url)

    def expect_summary_visible(self) -> None:
        expect(self.summary_container).to_be_visible()

    def expect_item_name(self, name: str) -> None:
        expect(self.item_name).to_contain_text(name)

    def expect_subtotal(self, text: str) -> None:
        expect(self.subtotal_label).to_contain_text(text)

    def expect_tax(self, text: str) -> None:
        expect(self.tax_label).to_contain_text(text)

    def expect_total(self, text: str) -> None:
        expect(self.total_label).to_contain_text(text)

    def click_finish(self) -> None:
        self.finish_button.click()

    def click_cancel(self) -> None:
        self.cancel_button.click()
