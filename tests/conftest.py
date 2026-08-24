"""Shared pytest fixtures for every generated suite.

Site-agnostic on purpose: everything specific to a target comes from its
descriptor in `config/sites/<id>.json`. A new target needs a descriptor plus a
three-line `conftest.py` in its own directory that overrides `site_id` — no
change here, and no change in the generator.

The login and reset-state action lists in the descriptor are executed here by
`run_actions`, mirroring the TypeScript executor used during capture, so the
browser state a test starts from is exactly the state the planner saw.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterator

import pytest
from dotenv import load_dotenv
from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# HEADLESS=0 to watch a run. Off by default so CI and demos behave the same.
HEADLESS = os.getenv("HEADLESS", "1") != "0"
VIEWPORT = {"width": 1440, "height": 900}
DEFAULT_TIMEOUT_MS = 15_000


@pytest.fixture(scope="session")
def site_id() -> str:
    raise NotImplementedError(
        "Each site directory must provide a conftest.py overriding the site_id fixture."
    )


@pytest.fixture(scope="session")
def site(site_id: str) -> dict[str, Any]:
    descriptor = ROOT / "config" / "sites" / f"{site_id}.json"
    if not descriptor.exists():
        raise FileNotFoundError(f"No site descriptor at {descriptor}")
    return json.loads(descriptor.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def base_url(site: dict[str, Any]) -> str:
    return str(site["baseUrl"]).rstrip("/")


@pytest.fixture(scope="session")
def credentials(site: dict[str, Any]) -> dict[str, str]:
    names = site["auth"]["credentials"]
    user, password = os.getenv(names["user"]), os.getenv(names["password"])
    if not user or not password:
        raise RuntimeError(
            f"Set {names['user']} and {names['password']} in .env for site '{site['id']}'"
        )
    return {"user": user, "password": password}


def run_actions(
    page: Page, actions: list[dict[str, Any]], creds: dict[str, str]
) -> None:
    """Execute the descriptor action DSL: goto / fill / click / select / press / wait."""
    for step in actions:
        action = step.get("action")
        selector = step.get("selector")
        raw = step.get("value")
        value = creds["user"] if raw == "$user" else creds["password"] if raw == "$password" else raw

        if step.get("optional") and selector and page.locator(selector).count() == 0:
            continue

        if action == "goto":
            page.goto(step.get("path", "/"), wait_until="domcontentloaded")
        elif action == "fill":
            page.fill(selector, value or "")
        elif action == "click":
            page.click(selector)
        elif action == "select":
            page.select_option(selector, value)
        elif action == "press":
            page.press(selector, step.get("key", "Enter"))
        elif action == "wait":
            if selector:
                page.wait_for_selector(selector, state="visible")
            else:
                page.wait_for_timeout(step.get("ms", 1000))
        elif action == "removeStorage":
            # Named keys only, never a blanket clear. This site keeps its cart in
            # sessionStorage (cart_quantity, cart_id) and its auth token there too
            # once signed in, so wiping everything would log the run out.
            keys = [k.strip() for k in (value or "").split(",") if k.strip()]
            page.evaluate(
                "keys => keys.forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); })",
                keys,
            )
        else:
            raise ValueError(f"Unknown descriptor action: {action!r}")


@pytest.fixture(scope="session")
def playwright_instance() -> Iterator[Playwright]:
    with sync_playwright() as playwright:
        yield playwright


@pytest.fixture(scope="session")
def browser(playwright_instance: Playwright) -> Iterator[Browser]:
    instance = playwright_instance.chromium.launch(headless=HEADLESS)
    yield instance
    instance.close()


def _new_page(browser: Browser, base_url: str) -> tuple[BrowserContext, Page]:
    # base_url on the context is what lets tests call page.goto("/cart.html").
    context = browser.new_context(base_url=base_url, viewport=VIEWPORT)
    page = context.new_page()
    page.set_default_timeout(DEFAULT_TIMEOUT_MS)
    return context, page


@pytest.fixture(scope="session")
def _authenticated_page(
    browser: Browser, site: dict[str, Any], base_url: str, credentials: dict[str, str]
) -> Iterator[Page]:
    """One logged-in session shared by the whole run — logging in per test would
    triple the runtime for no extra coverage."""
    context, page = _new_page(browser, base_url)
    page.goto(site["auth"].get("loginPath", "/"), wait_until="domcontentloaded")
    run_actions(page, site["auth"]["steps"], credentials)
    ready = site["auth"].get("readySelector")
    if ready:
        page.wait_for_selector(ready, state="visible", timeout=30_000)
    yield page
    context.close()


@pytest.fixture
def app(
    _authenticated_page: Page, site: dict[str, Any], credentials: dict[str, str]
) -> Page:
    """A logged-in page in a known-clean state.

    The session is shared, so without the descriptor's resetState the leftovers
    of one test silently change what the next one sees.
    """
    reset = site.get("resetState") or []
    if reset:
        run_actions(_authenticated_page, reset, credentials)
    return _authenticated_page


@pytest.fixture
def guest(browser: Browser, site: dict[str, Any], base_url: str) -> Iterator[Page]:
    """A logged-out page in its own context — for tests of the sign-in flow itself."""
    context, page = _new_page(browser, base_url)
    page.goto(site["auth"].get("loginPath", "/"), wait_until="domcontentloaded")
    yield page
    context.close()
