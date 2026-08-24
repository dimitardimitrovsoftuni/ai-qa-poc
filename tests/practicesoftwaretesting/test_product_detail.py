"""Product detail tests for the Toolshop application."""

from playwright.sync_api import Page

from .models.home_page import HomePage
from .models.product_detail_page import ProductDetailPage


def test_product_detail_add_to_cart_success(app: Page) -> None:
    """Add to cart and favorites work on product detail."""
    home = HomePage(app)
    product = ProductDetailPage(app)

    home.open()
    home.click_first_product()
    product.expect_product_name_visible()
    product.expect_unit_price_visible()
    product.click_increase_quantity()
    product.expect_quantity_value("2")
    product.click_add_to_cart()
    product.expect_cart_quantity_visible()
    product.expect_cart_quantity_text("2")
    product.expect_add_to_favorites_visible()


def test_product_detail_quantity_decrease_edge(app: Page) -> None:
    """Decreasing quantity below minimum leaves it unchanged."""
    home = HomePage(app)
    product = ProductDetailPage(app)

    home.open()
    home.click_first_product()
    product.expect_quantity_value("1")
    product.click_decrease_quantity()
    product.expect_quantity_value("1")
