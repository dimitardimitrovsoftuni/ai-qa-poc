"""Sign-in regression tests for an example application.

Reference sample handed to the generator as a few-shot example. Note what it
does NOT do: no logging in, no state cleanup, no sleeps, and no assertions
written inline — the fixtures handle session state and the page object owns
both the locators and the assertions.
"""

from playwright.sync_api import Page

from .models.example_page import ExamplePage


def test_signin_rejects_wrong_password(guest: Page) -> None:
    """Signing in with a wrong password shows an error and stays on the form."""
    # `guest` is logged out in its own browser context — the right fixture for
    # tests of the sign-in flow itself.
    example = ExamplePage(guest)

    example.open()
    example.example("user@example.com", "definitely-wrong")

    example.expect_error("do not match")
    example.expect_still_on_form()


def test_signin_reaches_the_dashboard(app: Page) -> None:
    """A signed-in user lands on the dashboard under their own name."""
    # `app` arrives logged in and in a clean state, so a test that is not about
    # signing in never spends steps getting there.
    example = ExamplePage(app)

    example.expect_signed_in_as("Ada Lovelace")
