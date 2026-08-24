"""Registration validation regression tests for the Toolshop practice app."""

from playwright.sync_api import Page

from .models.register_page import RegisterPage


def test_registration_empty_submission_shows_all_errors(guest: Page) -> None:
    """Submitting an empty registration form shows validation alerts for every required field."""
    register = RegisterPage(guest)

    register.open()
    register.submit()

    register.expect_first_name_error_visible()
    register.expect_first_name_error_text("First name is required")
    register.expect_last_name_error_visible()
    register.expect_last_name_error_text("Last name is required")
    register.expect_dob_error_visible()
    register.expect_dob_error_text("Please enter a valid date in YYYY-MM-DD format. Date of Birth is required")
    register.expect_country_error_visible()
    register.expect_country_error_text("Country is required")
    register.expect_postal_code_error_visible()
    register.expect_postal_code_error_text("Postcode is required")
    register.expect_house_number_error_visible()
    register.expect_house_number_error_text("House number is required")
    register.expect_street_error_visible()
    register.expect_street_error_text("Street is required")
    register.expect_city_error_visible()
    register.expect_city_error_text("City is required")
    register.expect_state_error_visible()
    register.expect_state_error_text("State is required")
    register.expect_phone_error_visible()
    register.expect_phone_error_text("Phone is required.")
    register.expect_email_error_visible()
    register.expect_email_error_text("Email is required")
    register.expect_password_error_visible()
    register.expect_password_error_text("Password is required Password must be minimal 6 characters long. Password can not include invalid characters.")


def test_registration_missing_email_shows_email_error(guest: Page) -> None:
    """Submitting a registration with all fields valid except email shows only the email validation alert."""
    register = RegisterPage(guest)

    register.open()
    register.fill_first_name("John")
    register.fill_last_name("Doe")
    register.fill_dob("1990-01-01")
    register.select_country("Albania")
    register.fill_postal_code("1000")
    register.fill_house_number("42")
    register.fill_street("Main Street")
    register.fill_city("Tirana")
    register.fill_state("Tirana County")
    register.fill_phone("0691234567")
    register.fill_password("StrongPass123!")
    register.submit()

    register.expect_email_error_visible()
    register.expect_email_error_text("Email is required")
    register.expect_first_name_error_absent()
    register.expect_last_name_error_absent()
    register.expect_dob_error_absent()
    register.expect_country_error_absent()
    register.expect_postal_code_error_absent()
    register.expect_house_number_error_absent()
    register.expect_street_error_absent()
    register.expect_city_error_absent()
    register.expect_state_error_absent()
    register.expect_phone_error_absent()
    register.expect_password_error_absent()


def test_registration_short_password_shows_password_error(guest: Page) -> None:
    """Submitting a registration with a too-short password shows the password validation alert."""
    register = RegisterPage(guest)

    register.open()
    register.fill_first_name("John")
    register.fill_last_name("Doe")
    register.fill_dob("1990-01-01")
    register.select_country("Albania")
    register.fill_postal_code("1000")
    register.fill_house_number("42")
    register.fill_street("Main Street")
    register.fill_city("Tirana")
    register.fill_state("Tirana County")
    register.fill_phone("0691234567")
    register.fill_email("john.doe@example.com")
    register.fill_password("123")
    register.submit()

    register.expect_password_error_visible()
    register.expect_password_error_text("6 characters")
    register.expect_first_name_error_absent()
    register.expect_last_name_error_absent()
    register.expect_dob_error_absent()
    register.expect_country_error_absent()
    register.expect_postal_code_error_absent()
    register.expect_house_number_error_absent()
    register.expect_street_error_absent()
    register.expect_city_error_absent()
    register.expect_state_error_absent()
    register.expect_phone_error_absent()
    register.expect_email_error_absent()

