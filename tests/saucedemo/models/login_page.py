"""Page object for the login screen of the Swag Labs (SauceDemo) application."""

from playwright.sync_api import Page, expect


class LoginPage:
    """Every locator for the login screen lives here and nowhere else."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.username_input = page.locator('[data-test="username"]')
        self.password_input = page.locator('[data-test="password"]')
        self.login_button = page.locator('[data-test="login-button"]')
        self.error_banner = page.locator('[data-test="error"]')

    def open(self) -> None:
        self.page.goto("/")

    def login(self, username: str, password: str) -> None:
        self.username_input.fill(username)
        self.password_input.fill(password)
        self.login_button.click()

    def login_with_password_only(self, password: str) -> None:
        self.password_input.fill(password)
        self.login_button.click()

    def login_with_username_only(self, username: str) -> None:
        self.username_input.fill(username)
        self.login_button.click()

    def expect_error(self, text: str) -> None:
        expect(self.error_banner).to_be_visible()
        expect(self.error_banner).to_contain_text(text)

    def expect_form_still_present(self) -> None:
        expect(self.login_button).to_be_visible()
