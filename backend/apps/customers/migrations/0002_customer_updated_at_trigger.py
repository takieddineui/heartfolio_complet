# Adds database-level updated_at maintenance to the existing (Phase 3.2,
# already-approved) `customers` table, per the approved schema note
# "updated_at maintained by trigger". Does not touch the Customer model
# or the original 0001_initial migration in any way — purely additive.

from django.db import migrations

CREATE_TRIGGER_SQL = """
CREATE TRIGGER set_updated_at_customers
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
"""

DROP_TRIGGER_SQL = """
DROP TRIGGER IF EXISTS set_updated_at_customers ON customers;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0001_initial"),
        ("common", "0001_enable_extensions_and_trigger_function"),
    ]

    operations = [
        migrations.RunSQL(
            sql=CREATE_TRIGGER_SQL,
            reverse_sql=DROP_TRIGGER_SQL,
        ),
    ]
