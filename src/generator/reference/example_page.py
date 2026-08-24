"""Page object for the sign-in screen of an example application.

Reference sample handed to the generator as a few-shot example. It is not part
of any suite and is never executed — it exists to show the exact shape the
generated files must take.
"""

from playwright.sync_api import Page, expect


class ExamplePage:
    """Every locator for this screen lives here and nowhere else.

    That is what makes the suite healable: when the application changes, one
    file needs patching, not every test that happens to touch the screen.
    """

    def __init__(self, page: Page) -> None:
        self.page = page
        self.email_input = page.locator("#email")
        self.password_input = page.locator("#password")
        self.submit_button = page.locator("#submit")
        self.error_banner = page.locator('[data-test="error"]')
        self.user_name = page.locator('[data-test="user-name"]')
        # A selector matching many elements is chained where it is defined, so a
        # singular assertion on it cannot raise a strict-mode violation.
        self.first_row = page.locator('[data-test="row"]').first

    def open(self) -> None:
        self.page.goto("/")

    def example(self, email: str, password: str) -> None:
        self.email_input.fill(email)
        self.password_input.fill(password)
        self.submit_button.click()

    def expect_error(self, text: str) -> None:
        expect(self.error_banner).to_be_visible()
        expect(self.error_banner).to_contain_text(text)

    def expect_still_on_form(self) -> None:
        expect(self.submit_button).to_be_visible()

    def expect_signed_in_as(self, name: str) -> None:
        expect(self.page).to_have_url("/dashboard")
        expect(self.user_name).to_contain_text(name)
