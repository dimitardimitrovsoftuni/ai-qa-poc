"""Site binding for this suite: the shared fixtures in ../conftest.py read
everything else from config/sites/practicesoftwaretesting.json."""

import pytest


@pytest.fixture(scope="session")
def site_id() -> str:
    return "practicesoftwaretesting"
