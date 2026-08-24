"""Page object for the login screen of the Toolshop application."""

from playwright.sync_api import Page, expect


class LoginPage:
    """Locators and actions for the /auth/login screen."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.email_input = page.locator('[data-test="email"]')
        self.password_input = page.locator('[data-test="password"]')
        self.submit_button = page.locator('[data-test="login-submit"]')
        self.error_banner = page.locator('[data-test="login-error"]')

    def open(self) -> None:
        self.page.goto("/auth/login")

    def sign_in(self, email: str, password: str) -> None:
        self.email_input.fill(email)
        self.password_input.fill(password)
        self.submit_button.click()

    def expect_error(self, text: str) -> None:
        expect(self.error_banner).to_be_visible()
        expect(self.error_banner).to_contain_text(text)

    def expect_still_on_form(self) -> None:
        expect(self.submit_button).to_be_visible()
