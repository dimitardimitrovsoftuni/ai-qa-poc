"""Page object for the contact form screen of the Toolshop application."""

from playwright.sync_api import Page, expect


class ContactPage:
    """Every locator for the contact form lives here and nowhere else."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.first_name_input = page.locator('[data-test="first-name"]')
        self.last_name_input = page.locator('[data-test="last-name"]')
        self.email_input = page.locator('[data-test="email"]')
        self.subject_select = page.locator('[data-test="subject"]')
        self.message_textarea = page.locator('[data-test="message"]')
        self.submit_button = page.locator('[data-test="contact-submit"]')
        self.first_name_error = page.locator('[data-test="first-name-error"]')
        self.last_name_error = page.locator('[data-test="last-name-error"]')
        self.email_error = page.locator('[data-test="email-error"]')
        self.subject_error = page.locator('[data-test="subject-error"]')
        self.message_error = page.locator('[data-test="message-error"]')

    def open(self) -> None:
        self.page.goto("/contact")

    def fill_first_name(self, value: str) -> None:
        self.first_name_input.fill(value)

    def fill_last_name(self, value: str) -> None:
        self.last_name_input.fill(value)

    def fill_email(self, value: str) -> None:
        self.email_input.fill(value)

    def select_subject(self, value: str) -> None:
        self.subject_select.select_option(value)

    def fill_message(self, value: str) -> None:
        self.message_textarea.fill(value)

    def submit(self) -> None:
        self.submit_button.click()

    def expect_on_contact(self) -> None:
        expect(self.page).to_have_url("/contact")

    def expect_first_name_visible(self) -> None:
        expect(self.first_name_input).to_be_visible()

    def expect_last_name_visible(self) -> None:
        expect(self.last_name_input).to_be_visible()

    def expect_email_visible(self) -> None:
        expect(self.email_input).to_be_visible()

    def expect_subject_visible(self) -> None:
        expect(self.subject_select).to_be_visible()

    def expect_message_visible(self) -> None:
        expect(self.message_textarea).to_be_visible()

    def expect_first_name_error_visible(self) -> None:
        expect(self.first_name_error).to_be_visible()

    def expect_first_name_error_text(self, text: str) -> None:
        expect(self.first_name_error).to_contain_text(text)

    def expect_last_name_error_visible(self) -> None:
        expect(self.last_name_error).to_be_visible()

    def expect_last_name_error_text(self, text: str) -> None:
        expect(self.last_name_error).to_contain_text(text)

    def expect_email_error_visible(self) -> None:
        expect(self.email_error).to_be_visible()

    def expect_email_error_text(self, text: str) -> None:
        expect(self.email_error).to_contain_text(text)

    def expect_subject_error_visible(self) -> None:
        expect(self.subject_error).to_be_visible()

    def expect_subject_error_text(self, text: str) -> None:
        expect(self.subject_error).to_contain_text(text)

    def expect_message_error_visible(self) -> None:
        expect(self.message_error).to_be_visible()

    def expect_message_error_text(self, text: str) -> None:
        expect(self.message_error).to_contain_text(text)

    def expect_first_name_error_absent(self) -> None:
        expect(self.first_name_error).to_have_count(0)

    def expect_last_name_error_absent(self) -> None:
        expect(self.last_name_error).to_have_count(0)

    def expect_email_error_absent(self) -> None:
        expect(self.email_error).to_have_count(0)

    def expect_subject_error_absent(self) -> None:
        expect(self.subject_error).to_have_count(0)

    def expect_message_error_absent(self) -> None:
        expect(self.message_error).to_have_count(0)
