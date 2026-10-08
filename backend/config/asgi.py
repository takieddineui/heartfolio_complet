"""
ASGI config for config project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application

# See config/wsgi.py for why this defaults to production rather than
# development — same reasoning applies here even though this project's
# actual deploy entrypoint is WSGI (gunicorn), not ASGI.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')

application = get_asgi_application()
