"""
WSGI config for config project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

# Unlike manage.py (whose development-settings default is the correct,
# convenience-friendly choice for local commands), this is the module a
# production WSGI server (gunicorn) actually imports. If
# DJANGO_SETTINGS_MODULE were ever missing from the deploy environment —
# a typo'd variable name in the deploy environment (compose file, env
# file or host dashboard), a misconfigured deploy
# — defaulting to development here would mean silently serving with
# DEBUG=True, insecure cookies, and MockPaymentProvider/mock storage
# defaults instead of failing to start. Defaulting to production instead
# means a missing/misconfigured environment fails loudly at startup
# (production.py has no defaults for SECRET_KEY/ALLOWED_HOSTS/etc.),
# which is the correct failure mode for a deployment entrypoint.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')

application = get_wsgi_application()
