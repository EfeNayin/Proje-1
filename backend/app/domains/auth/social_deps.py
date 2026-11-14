"""The Google/Apple collaborators, built once from settings and injected into the routes.

Tests replace `get_social` with a fake provider pair (tests/support/fake_social.py).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from app.core.config import settings
from app.core.secretbox import SecretBox
from app.domains.auth.social import Social
from app.domains.auth.social_providers import LiveSocialProviders, social_config_from_settings


@lru_cache
def _live() -> Social:
    key = settings.SOCIAL_TOKEN_ENCRYPTION_KEY
    return Social(
        providers=LiveSocialProviders(social_config_from_settings(settings)),
        box=SecretBox(key.get_secret_value()) if key is not None else None,
    )


def get_social() -> Social:
    return _live()


SocialDep = Annotated[Social, Depends(get_social)]
