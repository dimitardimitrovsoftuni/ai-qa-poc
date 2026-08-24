"""Contact form validation regression tests for the Toolshop application."""

from playwright.sync_api import Page

from .models.contact_page import ContactPage


def test_contact_empty_submission_shows_all_required_errors(guest: Page) -> None:
    """Submitting the contact form empty shows a validation alert for every required field."""
    contact = ContactPage(guest)

    contact.open()
    contact.submit()

    contact.expect_first_name_error_visible()
    contact.expect_first_name_error_text("First name is required")
    contact.expect_last_name_error_visible()
    contact.expect_last_name_error_text("Last name is required")
    contact.expect_email_error_visible()
    contact.expect_email_error_text("Email is required")
    contact.expect_subject_error_visible()
    contact.expect_subject_error_text("Subject is required")
    contact.expect_message_error_visible()
    contact.expect_message_error_text("Message is required")


def test_contact_valid_submission_shows_no_validation_errors(guest: Page) -> None:
    """Submitting the contact form with all required fields filled shows no client-side validation errors."""
    contact = ContactPage(guest)

    contact.open()
    contact.fill_first_name("John")
    contact.fill_last_name("Doe")
    contact.fill_email("john.doe@example.com")
    contact.select_subject("Customer service")
    contact.fill_message("This is a valid test message that meets any length requirement.")
    contact.submit()

    contact.expect_first_name_error_absent()
    contact.expect_last_name_error_absent()
    contact.expect_email_error_absent()
    contact.expect_subject_error_absent()
    contact.expect_message_error_absent()


def test_contact_partial_submission_shows_only_missing_field_errors(guest: Page) -> None:
    """Submitting the contact form with only some required fields filled shows errors only for the missing fields."""
    contact = ContactPage(guest)

    contact.open()
    contact.fill_first_name("Jane")
    contact.fill_last_name("Smith")
    contact.fill_email("jane.smith@example.com")
    contact.submit()

    contact.expect_first_name_error_absent()
    contact.expect_last_name_error_absent()
    contact.expect_email_error_absent()
    contact.expect_subject_error_visible()
    contact.expect_subject_error_text("Subject is required")
    contact.expect_message_error_visible()
    contact.expect_message_error_text("Message is required")

