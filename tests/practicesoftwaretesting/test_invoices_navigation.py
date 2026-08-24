"""Invoices navigation tests for the practice application."""

from playwright.sync_api import Page

from .models.account_page import AccountPage
from .models.invoices_page import InvoicesPage


def test_account_nav_invoices(app: Page) -> None:
    """Clicking Invoices link navigates to Invoices page with correct title."""
    account_page = AccountPage(app)
    account_page.open()
    account_page.click_nav_invoices()

    invoices_page = InvoicesPage(app)
    invoices_page.expect_page_title_visible()
    invoices_page.expect_page_title_contains("Invoices")
