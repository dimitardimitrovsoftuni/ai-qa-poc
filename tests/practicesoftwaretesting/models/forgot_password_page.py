from playwright.sync_api import Page, expect


class ForgotPasswordPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.submit_button = page.locator('[data-test="forgot-password-submit"]')
        self.email_error = page.locator('[data-test="email-error"]')

    def open(self) -> None:
        self.page.goto("/auth/forgot-password")

    def submit(self) -> None:
        self.submit_button.click()

    def expect_email_error_visible(self) -> None:
        expect(self.email_error).to_be_visible()

    def expect_email_error_text(self, text: str) -> None:
        expect(self.email_error).to_contain_text(text)
