from playwright.sync_api import Page, expect


class RegisterPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.first_name_input = page.locator('[data-test="first-name"]')
        self.last_name_input = page.locator('[data-test="last-name"]')
        self.dob_input = page.locator('[data-test="dob"]')
        self.country_input = page.locator('[data-test="country"]')
        self.postal_code_input = page.locator('[data-test="postal_code"]')
        self.house_number_input = page.locator('[data-test="house_number"]')
        self.street_input = page.locator('[data-test="street"]')
        self.city_input = page.locator('[data-test="city"]')
        self.state_input = page.locator('[data-test="state"]')
        self.phone_input = page.locator('[data-test="phone"]')
        self.email_input = page.locator('[data-test="email"]')
        self.password_input = page.locator('[data-test="password"]')
        self.submit_button = page.locator('[data-test="register-submit"]')
        self.first_name_error = page.locator('[data-test="first-name-error"]')
        self.last_name_error = page.locator('[data-test="last-name-error"]')
        self.dob_error = page.locator('[data-test="dob-error"]')
        self.country_error = page.locator('[data-test="country-error"]')
        self.postal_code_error = page.locator('[data-test="postal_code-error"]')
        self.house_number_error = page.locator('[data-test="house_number-error"]')
        self.street_error = page.locator('[data-test="street-error"]')
        self.city_error = page.locator('[data-test="city-error"]')
        self.state_error = page.locator('[data-test="state-error"]')
        self.phone_error = page.locator('[data-test="phone-error"]')
        self.email_error = page.locator('[data-test="email-error"]')
        self.password_error = page.locator('[data-test="password-error"]')

    def open(self) -> None:
        self.page.goto("/auth/register")

    def fill_first_name(self, value: str) -> None:
        self.first_name_input.fill(value)

    def fill_last_name(self, value: str) -> None:
        self.last_name_input.fill(value)

    def fill_dob(self, value: str) -> None:
        self.dob_input.fill(value)

    def select_country(self, value: str) -> None:
        self.country_input.select_option(value)

    def fill_postal_code(self, value: str) -> None:
        self.postal_code_input.fill(value)

    def fill_house_number(self, value: str) -> None:
        self.house_number_input.fill(value)

    def fill_street(self, value: str) -> None:
        self.street_input.fill(value)

    def fill_city(self, value: str) -> None:
        self.city_input.fill(value)

    def fill_state(self, value: str) -> None:
        self.state_input.fill(value)

    def fill_phone(self, value: str) -> None:
        self.phone_input.fill(value)

    def fill_email(self, value: str) -> None:
        self.email_input.fill(value)

    def fill_password(self, value: str) -> None:
        self.password_input.fill(value)

    def submit(self) -> None:
        self.submit_button.click()

    def expect_first_name_error_visible(self) -> None:
        expect(self.first_name_error).to_be_visible()

    def expect_first_name_error_text(self, text: str) -> None:
        expect(self.first_name_error).to_contain_text(text)

    def expect_last_name_error_visible(self) -> None:
        expect(self.last_name_error).to_be_visible()

    def expect_last_name_error_text(self, text: str) -> None:
        expect(self.last_name_error).to_contain_text(text)

    def expect_dob_error_visible(self) -> None:
        expect(self.dob_error).to_be_visible()

    def expect_dob_error_text(self, text: str) -> None:
        expect(self.dob_error).to_contain_text(text)

    def expect_country_error_visible(self) -> None:
        expect(self.country_error).to_be_visible()

    def expect_country_error_text(self, text: str) -> None:
        expect(self.country_error).to_contain_text(text)

    def expect_postal_code_error_visible(self) -> None:
        expect(self.postal_code_error).to_be_visible()

    def expect_postal_code_error_text(self, text: str) -> None:
        expect(self.postal_code_error).to_contain_text(text)

    def expect_house_number_error_visible(self) -> None:
        expect(self.house_number_error).to_be_visible()

    def expect_house_number_error_text(self, text: str) -> None:
        expect(self.house_number_error).to_contain_text(text)

    def expect_street_error_visible(self) -> None:
        expect(self.street_error).to_be_visible()

    def expect_street_error_text(self, text: str) -> None:
        expect(self.street_error).to_contain_text(text)

    def expect_city_error_visible(self) -> None:
        expect(self.city_error).to_be_visible()

    def expect_city_error_text(self, text: str) -> None:
        expect(self.city_error).to_contain_text(text)

    def expect_state_error_visible(self) -> None:
        expect(self.state_error).to_be_visible()

    def expect_state_error_text(self, text: str) -> None:
        expect(self.state_error).to_contain_text(text)

    def expect_phone_error_visible(self) -> None:
        expect(self.phone_error).to_be_visible()

    def expect_phone_error_text(self, text: str) -> None:
        expect(self.phone_error).to_contain_text(text)

    def expect_email_error_visible(self) -> None:
        expect(self.email_error).to_be_visible()

    def expect_email_error_text(self, text: str) -> None:
        expect(self.email_error).to_contain_text(text)

    def expect_password_error_visible(self) -> None:
        expect(self.password_error).to_be_visible()

    def expect_password_error_text(self, text: str) -> None:
        expect(self.password_error).to_contain_text(text)

    def expect_first_name_error_absent(self) -> None:
        expect(self.first_name_error).to_have_count(0)

    def expect_last_name_error_absent(self) -> None:
        expect(self.last_name_error).to_have_count(0)

    def expect_dob_error_absent(self) -> None:
        expect(self.dob_error).to_have_count(0)

    def expect_country_error_absent(self) -> None:
        expect(self.country_error).to_have_count(0)

    def expect_postal_code_error_absent(self) -> None:
        expect(self.postal_code_error).to_have_count(0)

    def expect_house_number_error_absent(self) -> None:
        expect(self.house_number_error).to_have_count(0)

    def expect_street_error_absent(self) -> None:
        expect(self.street_error).to_have_count(0)

    def expect_city_error_absent(self) -> None:
        expect(self.city_error).to_have_count(0)

    def expect_state_error_absent(self) -> None:
        expect(self.state_error).to_have_count(0)

    def expect_phone_error_absent(self) -> None:
        expect(self.phone_error).to_have_count(0)

    def expect_email_error_absent(self) -> None:
        expect(self.email_error).to_have_count(0)

    def expect_password_error_absent(self) -> None:
        expect(self.password_error).to_have_count(0)
